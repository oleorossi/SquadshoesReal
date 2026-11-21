-- motor_conferencia_completa_20270101052300
-- Somente leitura. Não liga auto_motor_enabled, não grava OC, reserva nem trava.
-- Não toca PV-00249, PV-00250 nem LOTE-00004.
-- Desligar, se um dia estiver ligada:
--   UPDATE public.atelier_settings SET auto_motor_enabled = false WHERE id = 1;

SET LOCAL statement_timeout = '180s';

DO $conferencia_completa$
DECLARE
  v_snap jsonb;
  v_text text;
  v_pos integer;
  v_len integer;
  v_chunk integer := 1500;
  v_key boolean;
  v_urgent boolean;
  v_cap numeric;
  v_row record;
  v_pv249 integer;
  v_terminal integer;
  v_apagado integer;
  v_motor_po integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  SELECT s.auto_motor_enabled, s.urgent_release_without_material, s.weekly_purchase_cap_brl
    INTO v_key, v_urgent, v_cap
    FROM public.atelier_settings s
   WHERE s.id = 1;
  RAISE NOTICE 'motor_chave enabled=% urgent_release=% teto=%', v_key, v_urgent, v_cap;

  SELECT count(*)::integer
    INTO v_pv249
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
   WHERE so.order_number = 'PV-00249'
     AND so.deleted_at IS NULL
     AND so.status IN ('Aprovado', 'Em Produção')
     AND soi.production_excluded_at IS NULL
     AND COALESCE(soi.quantity, 0) > 0;
  RAISE NOTICE 'motor_pv249 %', v_pv249;

  SELECT count(*)::integer
    INTO v_terminal
    FROM public.sale_orders so
   WHERE so.deleted_at IS NULL
     AND so.status IN (
       'Faturado', 'Concluído', 'Concluido', 'Finalizado s/ NF', 'Finalizado',
       'Cancelado', 'Expedido', 'Entregue'
     )
     AND so.id IN (
       SELECT (item ->> 'sale_order_id')::uuid
         FROM jsonb_array_elements(COALESCE(public.list_cabedal_motor_purchase_snapshot() -> 'items', '[]'::jsonb)) item
     );
  RAISE NOTICE 'motor_terminal_no_snapshot %', v_terminal;

  SELECT count(*)::integer
    INTO v_apagado
    FROM public.sale_orders so
   WHERE so.deleted_at IS NOT NULL
     AND so.status IN ('Aprovado', 'Em Produção')
     AND so.order_number IS DISTINCT FROM 'PV-00249';
  RAISE NOTICE 'motor_apagados_em_producao_ou_aprovado %', v_apagado;

  SELECT count(*)::integer
    INTO v_motor_po
    FROM public.purchase_orders po
   WHERE COALESCE(po.idempotency_key, '') LIKE 'motor:%'
     AND po.cancelled_at IS NULL
     AND po.status IN ('pending', 'approved', 'sent', 'parcial');
  RAISE NOTICE 'motor_oc_aberta_com_chave %', v_motor_po;

  FOR v_row IN
    SELECT so.order_number,
           so.status,
           count(DISTINCT po.id)::integer AS ocs
      FROM public.sale_orders so
      LEFT JOIN public.purchase_orders po
        ON so.id = ANY (COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[]))
       AND po.cancelled_at IS NULL
       AND po.status IN ('pending', 'approved', 'sent', 'parcial')
     WHERE so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
       AND so.order_number IS DISTINCT FROM 'PV-00249'
     GROUP BY so.order_number, so.status
     ORDER BY so.order_number
  LOOP
    RAISE NOTICE 'motor_oc_ligada % status=% ocs_abertas=%', v_row.order_number, v_row.status, v_row.ocs;
  END LOOP;

  SELECT COALESCE(sum(mr.quantity_reserved), 0)::text
    INTO v_text
    FROM public.material_reservations mr
   WHERE mr.status = 'reserved';
  RAISE NOTICE 'motor_reserva_total %', v_text;

  v_snap := public.list_cabedal_motor_purchase_snapshot();
  v_text := v_snap::text;
  v_len := length(v_text);
  RAISE NOTICE 'motor_snapshot_chars %', v_len;
  v_pos := 1;
  WHILE v_pos <= v_len LOOP
    RAISE NOTICE 'motor_snapshot_part %', substr(v_text, v_pos, v_chunk);
    v_pos := v_pos + v_chunk;
  END LOOP;

  IF v_key IS TRUE THEN
    RAISE NOTICE 'motor_recusa chave ja estava ligada';
  END IF;
END;
$conferencia_completa$;
