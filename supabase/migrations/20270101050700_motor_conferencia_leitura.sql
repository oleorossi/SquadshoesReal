-- motor_conferencia_leitura_20270101050700
-- Somente leitura. Não liga a chave, não grava OC, reserva, trava nem pedido.
-- Não toca PV-00249, PV-00236, PV-2026-00083.
-- Desligar, se um dia estiver ligada:
--   UPDATE public.atelier_settings SET auto_motor_enabled = false WHERE id = 1;

SET LOCAL statement_timeout = '180s';

DO $conferencia$
DECLARE
  v_snap jsonb;
  v_text text;
  v_pos integer;
  v_len integer;
  v_chunk integer := 1800;
  v_ops integer;
  v_key boolean;
  v_urgent boolean;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  SELECT count(*)::integer
    INTO v_ops
    FROM public.orders o
   WHERE o.sale_order_id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
     AND o.deleted_at IS NULL;
  RAISE NOTICE 'pv255_ops_vivas %', v_ops;

  SELECT s.auto_motor_enabled, s.urgent_release_without_material
    INTO v_key, v_urgent
    FROM public.atelier_settings s
   WHERE s.id = 1;
  RAISE NOTICE 'motor_chave enabled=% urgent_release=%', v_key, v_urgent;

  SELECT COALESCE(string_agg(format('%s=%s', COALESCE(n.status, 'sem_pv'), n.qty), ', ' ORDER BY n.status), '')
    INTO v_text
    FROM (
      SELECT so.status, count(*)::integer AS qty
        FROM public.production_queue q
        JOIN public.orders o ON o.id = q.order_id
        LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
       GROUP BY so.status
    ) n;
  RAISE NOTICE 'fila_por_status_pv %', v_text;

  SELECT count(*)::integer
    INTO v_ops
    FROM public.sale_orders so
   WHERE so.deleted_at IS NULL
     AND so.status IN ('Aprovado', 'Em Produção');
  RAISE NOTICE 'pvs_ativos %', v_ops;

  v_snap := public.list_cabedal_motor_purchase_snapshot();
  v_text := v_snap::text;
  v_len := length(v_text);
  RAISE NOTICE 'motor_snapshot_chars %', v_len;
  v_pos := 1;
  WHILE v_pos <= v_len LOOP
    RAISE NOTICE 'motor_snapshot_part %', substr(v_text, v_pos, v_chunk);
    v_pos := v_pos + v_chunk;
  END LOOP;
END;
$conferencia$;
