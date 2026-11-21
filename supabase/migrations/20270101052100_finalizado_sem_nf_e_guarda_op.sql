-- finalizado_sem_nf_e_guarda_op_20270101052100
--
-- O #710 (20270101050800) rodou e não gravou. O log foi:
--   finalizado_sem_nf_nao_aplicado achei 0
--   pv_estado PV-00236 status=Em Produção apagado=t
--   pv_estado PV-2026-00083 status=Em Produção apagado=t
-- Não foi "usuário não aprovado". Esse erro foi o promote do PV-00255,
-- no #711, porque o psql não tem JWT. Aqui os dois pedidos estão
-- apagados (deleted_at) e mesmo assim com status Em Produção, e o #710
-- exigia deleted_at nulo.
--
-- Esta gravação muda só o status dos dois, mesmo apagados, para
-- 'Finalizado s/ NF'. Não limpa deleted_at, não reescreve OP, não toca
-- PV-00142, PV-00249, PV-00250 nem LOTE-00004.
-- Nota: Encerrado como Finalizado s/ NF a pedido do Leonardo em 21/11/2026
-- — faturado externamente há tempo; sem efeitos de estoque/financeiro.
--
-- A promoção para Em Produção sem OP já falha dentro de
-- promote_sale_order_atomic_internal (marca promocao_sem_op_20270101050600).
-- O worker grava esse texto em sale_orders.command_error. O gatilho abaixo
-- é a segunda porta: qualquer UPDATE/INSERT de status para Em Produção
-- sem OP viva do item produzível levanta a mesma recusa, visível.

SET LOCAL statement_timeout = '180s';

CREATE OR REPLACE FUNCTION public.tg_block_em_producao_sem_op()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id uuid;
  v_code text;
  v_color text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'Em Produção' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'Em Produção' THEN
    RETURN NEW;
  END IF;

  SELECT soi.id,
         COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), '?'),
         COALESCE(NULLIF(btrim(soi.color), ''), '—')
    INTO v_item_id, v_code, v_color
    FROM public.sale_order_items soi
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = NEW.id
     AND soi.reference_id IS NOT NULL
     AND soi.production_excluded_at IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.orders o
        WHERE o.sale_order_item_id = soi.id
          AND o.deleted_at IS NULL
          AND COALESCE(o.status, '') NOT IN (
            'Cancelada', 'Cancelado', 'cancelled',
            'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
            'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
            'Faturado', 'Rascunho'
          )
     )
   ORDER BY soi.id
   LIMIT 1;

  IF v_item_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Promoção recusada: o item % / % ficou sem OP (%). O pedido % não entra em Em Produção.',
      v_code, v_color, v_item_id, COALESCE(NEW.order_number, NEW.id::text)
      USING ERRCODE = 'PZ108';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_block_em_producao_sem_op() IS
  'Entrada em Em Produção sem OP viva do item produzível falha com texto visível. Pedido que já está em Em Produção não é reescrito.';

REVOKE ALL ON FUNCTION public.tg_block_em_producao_sem_op()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_block_em_producao_sem_op ON public.sale_orders;
CREATE TRIGGER trg_block_em_producao_sem_op
  BEFORE INSERT OR UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_em_producao_sem_op();

DO $encerra_legado_apagado$
DECLARE
  v_ids uuid[];
  v_before text;
  v_after text;
  v_ops_before text;
  v_ops_after text;
  v_updated integer;
  v_nfe_required boolean;
  v_trigger text;
  v_row record;
  v_guard integer;
  v_res_before text;
  v_res_after text;
  v_po_before integer;
  v_po_after integer;
  v_month text;
  v_week integer;
  v_first date;
  v_dow integer;
  v_start date;
  v_ready date;
  v_pv249 integer;
  v_semana_vazia integer := 0;
  v_inicio_depois integer := 0;
  v_key boolean;
  v_urgent boolean;
BEGIN
  SELECT pg_catalog.strpos(
           pg_catalog.pg_get_functiondef(
             'public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure
           ),
           'promocao_sem_op_20270101050600'
         )
    INTO v_guard;
  IF v_guard = 0 THEN
    RAISE EXCEPTION 'A promoção oficial perdeu a recusa de Em Produção sem OP.';
  END IF;
  RAISE NOTICE 'promote_recusa_sem_op viva';

  FOR v_row IN
    SELECT so.order_number, so.status, so.deleted_at IS NOT NULL AS apagado
      FROM public.sale_orders so
     WHERE so.order_number IN ('PV-00236', 'PV-2026-00083', 'PV-00142', 'PV-00249', 'PV-00250')
     ORDER BY so.order_number
  LOOP
    RAISE NOTICE 'legado_linha % status=% apagado=%',
      v_row.order_number, v_row.status, v_row.apagado;
  END LOOP;

  SELECT COALESCE(array_agg(so.id ORDER BY so.order_number), ARRAY[]::uuid[])
    INTO v_ids
    FROM public.sale_orders so
   WHERE so.order_number IN ('PV-00236', 'PV-2026-00083')
     AND so.status = 'Em Produção';

  IF cardinality(v_ids) = 0
     AND (
       SELECT count(*)
         FROM public.sale_orders so
        WHERE so.order_number IN ('PV-00236', 'PV-2026-00083')
          AND so.status = 'Finalizado s/ NF'
     ) = 2
  THEN
    RAISE NOTICE 'legado_ja_finalizado';
  ELSIF cardinality(v_ids) <> 2 THEN
    RAISE EXCEPTION 'Esperava 2 PVs Em Produção (PV-00236 e PV-2026-00083), achei %',
      cardinality(v_ids);
  ELSE
    SELECT COALESCE(bool_and(COALESCE(so.nfe_required, true) = false), false)
      INTO v_nfe_required
      FROM public.sale_orders so
     WHERE so.deleted_at IS NULL
       AND so.status = 'Finalizado s/ NF'
       AND so.order_number NOT IN ('PV-00236', 'PV-2026-00083');

    SELECT COALESCE(string_agg(format('%s:%s', fonte, qty), ',' ORDER BY fonte), '')
      INTO v_before
      FROM (
        SELECT 'financial_entries' AS fonte, count(*)::integer AS qty
          FROM public.financial_entries fe
         WHERE fe.reference_id IN (
                SELECT x::text FROM unnest(v_ids) AS x
                UNION
                SELECT o.id::text FROM public.orders o WHERE o.sale_order_id = ANY (v_ids)
              )
        UNION ALL
        SELECT 'accounts_receivable', count(*)::integer
          FROM public.accounts_receivable ar
         WHERE ar.sale_order_id = ANY (v_ids)
        UNION ALL
        SELECT 'stock_movements', count(*)::integer
          FROM public.stock_movements sm
         WHERE sm.order_id IN (SELECT o.id FROM public.orders o WHERE o.sale_order_id = ANY (v_ids))
        UNION ALL
        SELECT 'outbox', count(*)::integer
          FROM public.sale_order_command_outbox ob
         WHERE ob.sale_order_id = ANY (v_ids)
        UNION ALL
        SELECT 'commission_value_cents', COALESCE(round(sum(so.commission_value) * 100), 0)::integer
          FROM public.sale_orders so
         WHERE so.id = ANY (v_ids)
        UNION ALL
        SELECT 'reservas', count(*)::integer
          FROM public.material_reservations mr
         WHERE mr.sale_order_id = ANY (v_ids)
            OR mr.order_id IN (SELECT o.id FROM public.orders o WHERE o.sale_order_id = ANY (v_ids))
      ) c;

    SELECT COALESCE(string_agg(format('%s:%s:%s', o.order_number, o.status, o.deleted_at IS NOT NULL), ',' ORDER BY o.order_number), '')
      INTO v_ops_before
      FROM public.orders o
     WHERE o.sale_order_id = ANY (v_ids);

    SELECT count(*)::integer
      INTO v_po_before
      FROM public.purchase_orders;

    SELECT count(*)::text || ':' || COALESCE(sum(mr.quantity_reserved), 0)::text
      INTO v_res_before
      FROM public.material_reservations mr
     WHERE mr.sale_order_id = ANY (v_ids)
        OR mr.order_id IN (SELECT o.id FROM public.orders o WHERE o.sale_order_id = ANY (v_ids));

    FOREACH v_trigger IN ARRAY ARRAY[
      'trg_finalize_orders_on_sale_order_billed',
      'trg_sale_order_creates_cmv',
      'trg_record_passive_sale_order_command',
      'trg_enqueue_strap_demands_on_sale_order_confirm',
      'trg_refresh_faturado_op_integrity',
      'trg_remove_pv_from_waves_on_status_change',
      'trg_cancel_orders_on_pv_cancel',
      'trg_cancel_so_on_pv_cancel',
      'trg_release_pv_commitments_on_cancel',
      'trg_ensure_production_queue_on_sale_status',
      'tg_sale_orders_resync_queue_due'
    ]
    LOOP
      IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
         WHERE tgname = v_trigger
           AND tgrelid = 'public.sale_orders'::regclass
           AND NOT tgisinternal
      ) THEN
        EXECUTE format('ALTER TABLE public.sale_orders DISABLE TRIGGER %I', v_trigger);
      END IF;
    END LOOP;

    PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
    PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

    UPDATE public.sale_orders so
       SET status = 'Finalizado s/ NF',
           nfe_required = CASE WHEN v_nfe_required THEN false ELSE so.nfe_required END,
           updated_at = pg_catalog.now()
     WHERE so.id = ANY (v_ids)
       AND so.status = 'Em Produção'
       AND so.order_number IN ('PV-00236', 'PV-2026-00083');
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    FOREACH v_trigger IN ARRAY ARRAY[
      'trg_finalize_orders_on_sale_order_billed',
      'trg_sale_order_creates_cmv',
      'trg_record_passive_sale_order_command',
      'trg_enqueue_strap_demands_on_sale_order_confirm',
      'trg_refresh_faturado_op_integrity',
      'trg_remove_pv_from_waves_on_status_change',
      'trg_cancel_orders_on_pv_cancel',
      'trg_cancel_so_on_pv_cancel',
      'trg_release_pv_commitments_on_cancel',
      'trg_ensure_production_queue_on_sale_status',
      'tg_sale_orders_resync_queue_due'
    ]
    LOOP
      IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
         WHERE tgname = v_trigger
           AND tgrelid = 'public.sale_orders'::regclass
           AND NOT tgisinternal
      ) THEN
        EXECUTE format('ALTER TABLE public.sale_orders ENABLE TRIGGER %I', v_trigger);
      END IF;
    END LOOP;

    IF v_updated <> 2 THEN
      RAISE EXCEPTION 'Atualizei % PVs, esperava 2.', v_updated;
    END IF;

    SELECT COALESCE(string_agg(format('%s:%s', fonte, qty), ',' ORDER BY fonte), '')
      INTO v_after
      FROM (
        SELECT 'financial_entries' AS fonte, count(*)::integer AS qty
          FROM public.financial_entries fe
         WHERE fe.reference_id IN (
                SELECT x::text FROM unnest(v_ids) AS x
                UNION
                SELECT o.id::text FROM public.orders o WHERE o.sale_order_id = ANY (v_ids)
              )
        UNION ALL
        SELECT 'accounts_receivable', count(*)::integer
          FROM public.accounts_receivable ar
         WHERE ar.sale_order_id = ANY (v_ids)
        UNION ALL
        SELECT 'stock_movements', count(*)::integer
          FROM public.stock_movements sm
         WHERE sm.order_id IN (SELECT o.id FROM public.orders o WHERE o.sale_order_id = ANY (v_ids))
        UNION ALL
        SELECT 'outbox', count(*)::integer
          FROM public.sale_order_command_outbox ob
         WHERE ob.sale_order_id = ANY (v_ids)
        UNION ALL
        SELECT 'commission_value_cents', COALESCE(round(sum(so.commission_value) * 100), 0)::integer
          FROM public.sale_orders so
         WHERE so.id = ANY (v_ids)
        UNION ALL
        SELECT 'reservas', count(*)::integer
          FROM public.material_reservations mr
         WHERE mr.sale_order_id = ANY (v_ids)
            OR mr.order_id IN (SELECT o.id FROM public.orders o WHERE o.sale_order_id = ANY (v_ids))
      ) c;

    SELECT COALESCE(string_agg(format('%s:%s:%s', o.order_number, o.status, o.deleted_at IS NOT NULL), ',' ORDER BY o.order_number), '')
      INTO v_ops_after
      FROM public.orders o
     WHERE o.sale_order_id = ANY (v_ids);

    SELECT count(*)::integer INTO v_po_after FROM public.purchase_orders;

    SELECT count(*)::text || ':' || COALESCE(sum(mr.quantity_reserved), 0)::text
      INTO v_res_after
      FROM public.material_reservations mr
     WHERE mr.sale_order_id = ANY (v_ids)
        OR mr.order_id IN (SELECT o.id FROM public.orders o WHERE o.sale_order_id = ANY (v_ids));

    RAISE NOTICE 'contagem_antes %', v_before;
    RAISE NOTICE 'contagem_depois %', v_after;
    RAISE NOTICE 'ops_antes %', v_ops_before;
    RAISE NOTICE 'ops_depois %', v_ops_after;
    RAISE NOTICE 'reservas_antes % reservas_depois % ocs_antes % ocs_depois %',
      v_res_before, v_res_after, v_po_before, v_po_after;

    IF v_before IS DISTINCT FROM v_after
       OR v_ops_before IS DISTINCT FROM v_ops_after
       OR v_res_before IS DISTINCT FROM v_res_after
    THEN
      RAISE EXCEPTION 'Efeito colateral detectado. antes=% depois=% ops_antes=% ops_depois=% reservas % -> %',
        v_before, v_after, v_ops_before, v_ops_after, v_res_before, v_res_after;
    END IF;
    IF v_po_before IS DISTINCT FROM v_po_after THEN
      RAISE NOTICE 'ocs_mudaram_fora_destes_pedidos % -> %', v_po_before, v_po_after;
    END IF;

    INSERT INTO public.audit_logs (action, resource, resource_id, old_data, new_data, success, error_message)
    SELECT 'status_regularization',
           'sale_orders',
           so.id::text,
           jsonb_build_object('status', 'Em Produção', 'deleted_at', so.deleted_at),
           jsonb_build_object(
             'status', so.status,
             'nfe_required', so.nfe_required,
             'deleted_at', so.deleted_at
           ),
           true,
           'Encerrado como Finalizado s/ NF a pedido do Leonardo em 21/11/2026 — faturado externamente há tempo; sem efeitos de estoque/financeiro'
      FROM public.sale_orders so
     WHERE so.id = ANY (v_ids);
  END IF;

  -- Conferência somente leitura. Não liga a chave.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  SELECT s.auto_motor_enabled, s.urgent_release_without_material
    INTO v_key, v_urgent
    FROM public.atelier_settings s
   WHERE s.id = 1;
  RAISE NOTICE 'motor_chave enabled=% urgent_release=% desligar=UPDATE public.atelier_settings SET auto_motor_enabled = false WHERE id = 1',
    v_key, v_urgent;

  SELECT count(*)::integer
    INTO v_pv249
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
   WHERE so.order_number = 'PV-00249'
     AND so.deleted_at IS NULL
     AND so.status IN ('Aprovado', 'Em Produção')
     AND soi.production_excluded_at IS NULL
     AND COALESCE(soi.quantity, 0) > 0;
  RAISE NOTICE 'motor_pv249_na_leitura %', v_pv249;

  FOR v_row IN
    SELECT so.order_number,
           so.status,
           so.order_type,
           so.billing_week,
           count(soi.id)::integer AS itens,
           COALESCE(sum(soi.quantity), 0)::numeric AS pares,
           bool_or(EXISTS (
             SELECT 1
               FROM public.atelier_complex_references acr
              WHERE acr.reference_id = soi.reference_id
                AND acr.active IS TRUE
                AND acr.sector IN ('costura_cabedal', 'aviamento')
           )) AS complexo,
           MAX((
             SELECT MAX(acr.prep_business_days)
               FROM public.atelier_complex_references acr
              WHERE acr.reference_id = soi.reference_id
                AND acr.active IS TRUE
                AND acr.prep_business_days > 0
           )) AS prep
      FROM public.sale_orders so
      JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     WHERE so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
       AND soi.production_excluded_at IS NULL
       AND COALESCE(soi.quantity, 0) > 0
     GROUP BY so.order_number, so.status, so.order_type, so.billing_week
     ORDER BY so.order_number
  LOOP
    v_start := NULL;
    v_ready := NULL;
    IF v_row.billing_week ~ '^[0-9]{4}-[0-9]{2}-S[0-9]{1,2}$' THEN
      v_month := substring(v_row.billing_week FROM 1 FOR 7);
      v_week := substring(v_row.billing_week FROM 'S([0-9]+)')::integer;
      v_first := to_date(v_month || '-01', 'YYYY-MM-DD');
      v_dow := EXTRACT(DOW FROM v_first)::integer;
      v_start := v_first - ((v_dow + 6) % 7);
      v_start := v_start + (v_week - 1) * 7;
      IF v_start < v_first THEN
        v_start := v_first;
      END IF;
      v_ready := v_start - COALESCE(
        (SELECT s.ready_before_billing_days FROM public.atelier_settings s WHERE s.id = 1),
        7
      );
      IF v_ready > v_start THEN
        v_inicio_depois := v_inicio_depois + 1;
      END IF;
    ELSE
      v_semana_vazia := v_semana_vazia + 1;
    END IF;
    RAISE NOTICE 'motor_pv % status=% tipo=% semana=% inicio_semana=% material_em=% prep=% complexo=% itens=% pares=%',
      v_row.order_number, v_row.status, v_row.order_type, v_row.billing_week,
      v_start, v_ready, v_row.prep, v_row.complexo, v_row.itens, v_row.pares;
  END LOOP;

  RAISE NOTICE 'motor_checagem inicio_depois_faturamento=% semana_vazia=% pv249=% chave_continua_desligada=true oc_so_no_clique=true',
    v_inicio_depois, v_semana_vazia, v_pv249;
END;
$encerra_legado_apagado$;
