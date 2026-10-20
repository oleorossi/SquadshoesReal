-- =============================================================================
-- Demanda de tira some quando o PV fecha (grill Hub Demandas 19–20/10/2026)
-- =============================================================================
-- Sinal = CLOSED_SALE_ORDER_STATUSES (Faturado / Expedido / Concluído /
-- Finalizado s/ NF / Cancelado). Soft-cancel via event_type='cancelled' (mesmo
-- processador). View operacional exclui PV fechado (cinto). Backfill enfileira
-- cancelled para o legado (~277 abertas em Faturado). Stock floor intacto.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_closed_sale_order_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(coalesce(p_status, '')) IN (
    'Faturado',
    'Expedido',
    'Concluído',
    'Finalizado s/ NF',
    'Cancelado',
    'Cancelada'
  );
$$;

COMMENT ON FUNCTION public.is_closed_sale_order_status(text) IS
  'Espelho de CLOSED_SALE_ORDER_STATUSES (+ Cancelada): PV fechado nao puxa demanda de tira.';

REVOKE ALL ON FUNCTION public.is_closed_sale_order_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_closed_sale_order_status(text)
  TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. Trigger: qualquer fechamento enfileira cancelled
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_sale_order_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
BEGIN
  -- Save documental (writer atomic) nao re-enfileira demanda.
  IF EXISTS (
    SELECT 1
      FROM public.sale_order_atomic_writer_contexts context
     WHERE context.backend_pid = pg_backend_pid()
       AND context.transaction_id = txid_current()
       AND context.operation = 'update'
       AND context.sale_order_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('Aprovado', 'Em Produção')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_event := CASE WHEN NEW.status = 'Em Produção'
      THEN 'direct_production' ELSE 'approved' END;
    PERFORM public.enqueue_sale_order_strap_demands(
      NEW.id, v_event, gen_random_uuid());
  ELSIF public.is_closed_sale_order_status(NEW.status)
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      NEW.id, 'cancelled', gen_random_uuid());
  ELSIF NEW.status IN ('Aprovado', 'Em Produção')
     AND (
       NEW.billing_week IS DISTINCT FROM OLD.billing_week
       OR NEW.delivery_month IS DISTINCT FROM OLD.delivery_month
       OR NEW.delivery_week IS DISTINCT FROM OLD.delivery_week
       OR NEW.delivery_deadline IS DISTINCT FROM OLD.delivery_deadline
     ) THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      NEW.id, 'schedule_changed', gen_random_uuid());
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enqueue_strap_demands_on_sale_order_confirm()
  FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Guarda no processador: PV fechado + evento ≠ cancel → no-op
--    (injeta no corpo vivo; cancelled continua rodando antes desta guarda)
-- -----------------------------------------------------------------------------
DO $patch_process$
DECLARE
  v_def text;
  v_needle text := $n$v_result:=jsonb_build_object('cancelled',true,'variants',to_jsonb(v_affected));
    ELSE$n$;
  v_insert text := $n$v_result:=jsonb_build_object('cancelled',true,'variants',to_jsonb(v_affected));
    ELSIF public.is_closed_sale_order_status((
            SELECT so.status FROM public.sale_orders so WHERE so.id = v_job.source_id
          )) THEN
      -- Job atrasado (approved/schedule) de PV ja fechado: nao recria demanda.
      v_result := jsonb_build_object(
        'no_op', true,
        'reason', 'pv_fechado',
        'sale_order_id', v_job.source_id,
        'event_type', v_job.event_type
      );
    ELSE$n$;
BEGIN
  v_def := pg_get_functiondef('public.process_strap_demand_job(uuid,text)'::regprocedure);

  IF position('reason'', ''pv_fechado''' IN v_def) > 0
     OR position('''pv_fechado''' IN v_def) > 0 THEN
    RAISE NOTICE 'process_strap_demand_job ja contem guarda pv_fechado — skip';
    RETURN;
  END IF;

  IF position(v_needle IN v_def) = 0 THEN
    RAISE EXCEPTION
      'process_strap_demand_job: ponto de injecao cancelled→ELSE nao encontrado';
  END IF;

  v_def := replace(v_def, v_needle, v_insert);
  EXECUTE v_def;
END;
$patch_process$;

-- -----------------------------------------------------------------------------
-- 3. View: braço PV exclui status fechado; stock_floor intacto
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_strap_demands_operational
WITH (security_invoker = false)
AS
SELECT
  d.id,
  'sale_order'::text AS origin_type,
  d.sale_order_id,
  d.sale_order_item_id,
  d.technical_strap_line_id,
  d.strap_variant_id,
  d.recipe_id,
  d.base_product_id,
  d.finished_product_id,
  d.source_mode,
  d.gross_required_m AS required_m,
  d.fulfilled_m,
  d.finished_stock_reserved_m,
  d.committed_finished_inbound_m,
  d.replenishment_required_m,
  d.base_required_m,
  d.base_reserved_m,
  d.base_inbound_allocated_m,
  d.base_shortage_m,
  d.required_at AS needed_at,
  d.main_production_start,
  d.target_week,
  d.schedule_revision,
  d.billing_anchor,
  d.billing_year,
  d.billing_month,
  d.billing_fortnight,
  d.status,
  CASE
    WHEN d.gross_required_m - d.fulfilled_m - d.cancelled_m <= 0 THEN 'Normal'
    WHEN current_date > d.strap_deadline THEN 'Urgente'
    WHEN current_date > d.strap_start THEN 'Atrasada'
    ELSE 'Normal'
  END AS criticality,
  so.order_number AS origin_label,
  d.correlation_id,
  d.created_at,
  d.updated_at
FROM public.sale_order_strap_demands d
JOIN public.sale_orders so ON so.id = d.sale_order_id
WHERE d.is_current
  AND public.is_approved_user()
  AND NOT public.is_closed_sale_order_status(so.status)
UNION ALL
SELECT
  f.id,
  'stock_floor'::text,
  NULL::uuid,
  NULL::uuid,
  NULL::uuid,
  f.strap_variant_id,
  f.recipe_id,
  f.base_product_id,
  f.finished_product_id,
  f.source_mode,
  f.required_m,
  f.fulfilled_m,
  0::numeric,
  f.committed_finished_inbound_m,
  f.replenishment_required_m,
  f.base_required_m,
  f.base_reserved_m,
  f.base_inbound_allocated_m,
  f.base_shortage_m,
  f.needed_at,
  NULL::date,
  date_trunc('week', f.needed_at)::date,
  f.schedule_revision,
  f.billing_anchor,
  f.billing_year,
  f.billing_month,
  f.billing_fortnight,
  f.status,
  CASE
    WHEN f.required_m - f.fulfilled_m <= 0 THEN 'Normal'
    WHEN current_date > f.needed_at THEN 'Urgente'
    ELSE 'Normal'
  END,
  'Reposicao de estoque minimo'::text,
  f.correlation_id,
  f.created_at,
  f.updated_at
FROM public.strap_stock_floor_contributions f
WHERE f.is_current AND public.is_approved_user();

COMMENT ON VIEW public.v_strap_demands_operational IS
  'Demandas operacionais de tira: PV aberto + reposicao. PV fechado nao aparece.';

GRANT SELECT ON public.v_strap_demands_operational TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Backfill legado
--    Soft-cancel = mesmo UPDATE do ramo cancelled do process_strap_demand_job
--    (cancelled_m = gross − fulfilled). Reconcile por variante vai pra fila
--    (source_type=strap_variant) — o job cancelled completo estoura timeout
--    com dezenas de PVs; o trigger prospectivo continua enfileirando cancelled.
-- -----------------------------------------------------------------------------
DO $backfill$
DECLARE
  v_corr uuid := gen_random_uuid();
  v_demands integer := 0;
  v_variants integer := 0;
  v_variant uuid;
  v_job uuid;
BEGIN
  -- Marca jobs cancelled de backfill anterior (se houver) como completed no-op
  -- pra nao disputar com o soft-cancel direto abaixo.
  UPDATE public.strap_demand_jobs
     SET status = 'completed',
         result = jsonb_build_object(
           'no_op', true,
           'reason', 'superseded_by_direct_closed_pv_backfill'
         ),
         completed_at = now(),
         locked_at = NULL,
         locked_by = NULL
   WHERE payload->>'reason' = 'pv_fechado_legado'
     AND status IN ('queued', 'retry', 'processing');

  WITH targets AS (
    SELECT d.id, d.strap_variant_id
      FROM public.sale_order_strap_demands d
      JOIN public.sale_orders so ON so.id = d.sale_order_id
     WHERE d.is_current
       AND d.status NOT IN ('fulfilled', 'cancelled', 'superseded')
       AND public.is_closed_sale_order_status(so.status)
  ), updated AS (
    UPDATE public.sale_order_strap_demands d
       SET cancelled_m = greatest(0, d.gross_required_m - d.fulfilled_m),
           status = 'cancelled',
           correlation_id = v_corr,
           updated_at = now()
      FROM targets t
     WHERE d.id = t.id
    RETURNING d.strap_variant_id
  )
  SELECT count(*)::integer,
         count(DISTINCT strap_variant_id)::integer
    INTO v_demands, v_variants
    FROM updated;

  FOR v_variant IN
    SELECT DISTINCT d.strap_variant_id
      FROM public.sale_order_strap_demands d
     WHERE d.correlation_id = v_corr
       AND d.status = 'cancelled'
  LOOP
    v_job := public.enqueue_strap_demand_job(
      'strap_variant',
      v_variant,
      0,
      0,
      'sale_order_cancelled',
      jsonb_build_object(
        'strap_variant_id', v_variant,
        'reason', 'pv_fechado_legado_reconcile',
        'correlation_id', v_corr
      ),
      format('strap_variant:%s:closed-pv-backfill:%s', v_variant, v_corr),
      v_corr
    );
  END LOOP;

  RAISE NOTICE
    'strap-demand-cancel-on-closed-pv: soft-cancel % demanda(s), % variante(s) enfileirada(s) p/ reconcile',
    v_demands, v_variants;
END;
$backfill$;
