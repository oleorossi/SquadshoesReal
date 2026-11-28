-- =============================================================================
-- Demanda de tira some quando o PV é soft-deleted (completa 46000)
-- =============================================================================
-- Regra do dono (28/11/2026): se o pedido foi encerrado, a demanda foi
-- encerrada; se faturado, a tira já foi executada. 44400 já cobre status
-- fechado. Soft-delete mantém Aprovado/Em Produção + deleted_at — a view
-- operacional (só status) e o trigger (só UPDATE OF status) deixavam a
-- demanda fantasma no Resumo da Central de Tiras. 46000 parou a regeneração
-- mas deixou as linhas correntes de propósito; agora cancela + esconde.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trigger: soft-delete enfileira cancelled; undelete reabre se status vivo
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

  -- Soft-delete ≡ encerrar demanda (mesmo cancelled do PV fechado).
  IF NEW.deleted_at IS NOT NULL
     AND OLD.deleted_at IS NULL THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      NEW.id, 'cancelled', gen_random_uuid());
    RETURN NEW;
  END IF;

  -- Restore: volta a puxar demanda se o status ainda é operacional.
  IF NEW.deleted_at IS NULL
     AND OLD.deleted_at IS NOT NULL
     AND NEW.status IN ('Aprovado', 'Em Produção') THEN
    v_event := CASE WHEN NEW.status = 'Em Produção'
      THEN 'direct_production' ELSE 'approved' END;
    PERFORM public.enqueue_sale_order_strap_demands(
      NEW.id, v_event, gen_random_uuid());
    RETURN NEW;
  END IF;

  -- PV ainda na lixeira: nao reagenda por status/agenda.
  IF NEW.deleted_at IS NOT NULL THEN
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

DROP TRIGGER IF EXISTS trg_enqueue_strap_demands_on_sale_order_confirm ON public.sale_orders;
CREATE TRIGGER trg_enqueue_strap_demands_on_sale_order_confirm
  AFTER UPDATE OF status, billing_week, delivery_month, delivery_week,
                  delivery_deadline, deleted_at
  ON public.sale_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_demands_on_sale_order_confirm();

COMMENT ON FUNCTION public.tg_enqueue_strap_demands_on_sale_order_confirm() IS
  'Enfileira demanda de tira em aprovacao/producao/agenda; cancelled em status fechado OU soft-delete; restore reabre se status vivo.';

-- -----------------------------------------------------------------------------
-- 2. View: exclui PV soft-deleted (cinto imediato, mesmo antes do job)
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
  AND so.deleted_at IS NULL
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
  'Demandas operacionais de tira: PV vivo (nao fechado, nao soft-deleted) + reposicao.';

GRANT SELECT ON public.v_strap_demands_operational TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Backfill: soft-cancela demanda aberta de PV ja na lixeira
-- -----------------------------------------------------------------------------
DO $backfill$
DECLARE
  v_corr uuid := gen_random_uuid();
  v_demands integer := 0;
  v_variant uuid;
  v_job uuid;
BEGIN
  WITH targets AS (
    SELECT d.id, d.strap_variant_id
      FROM public.sale_order_strap_demands d
      JOIN public.sale_orders so ON so.id = d.sale_order_id
     WHERE d.is_current
       AND d.status NOT IN ('fulfilled', 'cancelled', 'superseded')
       AND so.deleted_at IS NOT NULL
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
  SELECT count(*)::integer INTO v_demands FROM updated;

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
        'reason', 'pv_soft_deleted_legado_reconcile',
        'correlation_id', v_corr
      ),
      format('strap_variant:%s:soft-deleted-pv-backfill:%s', v_variant, v_corr),
      v_corr
    );
  END LOOP;

  RAISE NOTICE
    'strap soft-delete backfill: soft-cancel % demanda(s) (corr=%)',
    v_demands, v_corr;
END;
$backfill$;
