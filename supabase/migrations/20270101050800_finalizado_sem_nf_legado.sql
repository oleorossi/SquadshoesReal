-- finalizado_sem_nf_legado_20270101050800
--
-- PV-00236 e PV-2026-00083 passam a 'Finalizado s/ NF', o status dos
-- pedidos informais já gravados. Sem estoque, CR, CMV, comissão, expedição,
-- compra de cabedal ou dublagem.
--
-- O cron sync-ar só varre v_faturado_sem_ar (status = 'Faturado').
-- 'Finalizado s/ NF' não entra nessa fila. syncFinancialRecords, se um dia
-- for chamado, sai no começo e não cria parcela.
--
-- Nesta gravação os gatilhos que escreveriam efeito são desligados e
-- religados. As OPs apagadas não têm o status reescrito.
-- Nota: Encerrado como Finalizado s/ NF a pedido do Leonardo em 21/11/2026
-- — faturado externamente há tempo; sem efeitos de estoque/financeiro.
-- Não toca PV-00249, PV-00250 nem LOTE-00004.

SET LOCAL statement_timeout = '120s';

DO $encerra_legado$
DECLARE
  v_ids uuid[];
  v_before text;
  v_after text;
  v_ops_before text;
  v_ops_after text;
  v_updated integer;
  v_modelo text;
  v_nfe_required boolean;
  v_trigger text;
BEGIN
  SELECT COALESCE(array_agg(so.id ORDER BY so.order_number), ARRAY[]::uuid[])
    INTO v_ids
    FROM public.sale_orders so
   WHERE so.order_number IN ('PV-00236', 'PV-2026-00083')
     AND so.deleted_at IS NULL
     AND so.status = 'Em Produção'
     AND so.order_number NOT IN ('PV-00249', 'PV-00250');

  IF cardinality(v_ids) <> 2 THEN
    RAISE NOTICE 'finalizado_sem_nf_nao_aplicado achei % com status Em Produção e número exato', cardinality(v_ids);
    RETURN;
  END IF;

  SELECT COALESCE(string_agg(
           format(
             '%s nfe_required=%s nfe_external=%s shipped=%s',
             so.order_number,
             COALESCE(so.nfe_required, true),
             COALESCE(so.nfe_external, false),
             so.shipped_at IS NOT NULL
           ),
           ' | ' ORDER BY so.order_number
         ), 'nenhum')
    INTO v_modelo
    FROM public.sale_orders so
   WHERE so.deleted_at IS NULL
     AND so.status = 'Finalizado s/ NF';
  RAISE NOTICE 'modelo_finalizado_sem_nf %', v_modelo;

  SELECT COALESCE(bool_and(COALESCE(so.nfe_required, true) = false), false)
    INTO v_nfe_required
    FROM public.sale_orders so
   WHERE so.deleted_at IS NULL
     AND so.status = 'Finalizado s/ NF';
  -- v_nfe_required aqui significa "os existentes estão todos sem NF obrigatória".

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
    ) c;

  SELECT COALESCE(string_agg(format('%s:%s:%s', o.order_number, o.status, o.deleted_at IS NOT NULL), ',' ORDER BY o.order_number), '')
    INTO v_ops_before
    FROM public.orders o
   WHERE o.sale_order_id = ANY (v_ids);

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

  UPDATE public.sale_orders so
     SET status = 'Finalizado s/ NF',
         nfe_required = CASE WHEN v_nfe_required THEN false ELSE so.nfe_required END,
         updated_at = pg_catalog.now()
   WHERE so.id = ANY (v_ids)
     AND so.status = 'Em Produção';
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
    RAISE EXCEPTION 'Atualizei % PVs, esperava 2. Nada deve permanecer.', v_updated;
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
    ) c;

  SELECT COALESCE(string_agg(format('%s:%s:%s', o.order_number, o.status, o.deleted_at IS NOT NULL), ',' ORDER BY o.order_number), '')
    INTO v_ops_after
    FROM public.orders o
   WHERE o.sale_order_id = ANY (v_ids);

  RAISE NOTICE 'contagem_antes %', v_before;
  RAISE NOTICE 'contagem_depois %', v_after;
  RAISE NOTICE 'ops_antes %', v_ops_before;
  RAISE NOTICE 'ops_depois %', v_ops_after;

  IF v_before IS DISTINCT FROM v_after OR v_ops_before IS DISTINCT FROM v_ops_after THEN
    RAISE EXCEPTION 'Efeito colateral detectado. antes=% depois=% ops_antes=% ops_depois=%',
      v_before, v_after, v_ops_before, v_ops_after;
  END IF;

  INSERT INTO public.audit_logs (action, resource, resource_id, old_data, new_data, success, error_message)
  SELECT 'status_regularization',
         'sale_orders',
         so.id::text,
         jsonb_build_object('status', 'Em Produção'),
         jsonb_build_object(
           'status', so.status,
           'nfe_required', so.nfe_required,
           'nfe_external', so.nfe_external,
           'shipped_at', so.shipped_at
         ),
         true,
         'Encerrado como Finalizado s/ NF a pedido do Leonardo em 21/11/2026 — faturado externamente há tempo; sem efeitos de estoque/financeiro'
    FROM public.sale_orders so
   WHERE so.id = ANY (v_ids);

  SELECT count(*)::integer
    INTO v_updated
    FROM public.orders o
   WHERE o.sale_order_id = '5c14d390-7965-493c-8bdf-c1fdbe7420f7'
     AND o.deleted_at IS NULL;
  RAISE NOTICE 'pv255_ops_vivas %', v_updated;
END;
$encerra_legado$;
