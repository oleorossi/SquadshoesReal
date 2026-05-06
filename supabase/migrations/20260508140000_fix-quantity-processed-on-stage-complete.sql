-- =============================================================================
-- Audit-2 Batch K: ensure quantity_processed = quantity_total on stage completion
-- =============================================================================
--
-- Problem (audit Kanban #1): when a stage is marked as 'concluido' the writer
-- only updates `status` and `completed_at` — `quantity_processed` is left at
-- whatever value it had before (typically 0). This is wrong because:
--   * OrderStagesPipeline / OrderDetailsModal render `{processed}/{total}`,
--     so a fully concluded stage shows "0/100 concluído";
--   * CapacityPlanning computes `remaining = total - processed`, treating
--     completed stages as still pending capacity (sectors look overloaded);
--   * Any KPI / report depending on processed counts is silently inflated.
--
-- Two writers have this bug:
--   1. `finalize_production_sector(uuid, text)` SQL RPC — used by every normal
--      "advance to next sector" call.
--   2. `jumpToSector` in ProductionKanban.tsx — direct UPDATE skipping stages.
--
-- This migration:
--   * Recreates `finalize_production_sector` with the missing assignment.
--   * Adds a new RPC `complete_order_stages_bulk(uuid, text[])` so the TS
--     layer can mark several skipped stages atomically with the same fix.
--   * Backfills existing concluído rows where processed=0 (safe: only touches
--     completed stages whose processed counter was never written).
-- =============================================================================

-- ── 1. Recreate finalize_production_sector with quantity_processed assignment ─
DROP FUNCTION IF EXISTS public.finalize_production_sector(p_order_id uuid, p_current_sector text) CASCADE;
CREATE OR REPLACE FUNCTION public.finalize_production_sector(p_order_id uuid, p_current_sector text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 AS $function$
DECLARE
  v_next_sector TEXT;
  v_result JSONB;
  v_started_at TIMESTAMPTZ;
  v_actual_minutes NUMERIC;
  v_current_stage_order INTEGER;
BEGIN
  SELECT started_at, stage_order
    INTO v_started_at, v_current_stage_order
  FROM public.order_stages
  WHERE order_id = p_order_id AND stage_name = p_current_sector;

  IF v_started_at IS NOT NULL THEN
    v_actual_minutes := EXTRACT(EPOCH FROM (NOW() - v_started_at)) / 60;
  ELSE
    v_actual_minutes := 0;
  END IF;

  -- Mark current stage as completed.
  -- Set quantity_processed = quantity_total so reports & capacity planning
  -- recognise the work as done. If a previous partial-update set processed
  -- to a higher value (impossible by current UI but tolerated), keep that.
  UPDATE public.order_stages
  SET
    status = 'concluido',
    completed_at = NOW(),
    actual_time_minutes = v_actual_minutes,
    quantity_processed = GREATEST(quantity_processed, quantity_total),
    updated_at = NOW()
  WHERE order_id = p_order_id
    AND stage_name = p_current_sector
    AND status != 'concluido';

  SELECT stage_name INTO v_next_sector
  FROM public.order_stages
  WHERE order_id = p_order_id
    AND stage_order > COALESCE(v_current_stage_order, -1)
    AND status NOT IN ('concluido', 'cancelado')
  ORDER BY stage_order ASC
  LIMIT 1;

  IF v_next_sector IS NOT NULL THEN
    UPDATE public.orders
    SET
      status = 'Em Produção',
      production_step = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.production_orders
    SET
      current_sector = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    INSERT INTO public.notifications (sector, message)
    VALUES (v_next_sector, 'Nova carga de trabalho disponível: OP #' || p_order_id);

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', v_next_sector,
      'status', 'Em Produção',
      'actual_time_minutes', v_actual_minutes
    );
  ELSE
    UPDATE public.orders
    SET
      status = 'Pronto',
      production_step = 'Pronto',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.production_orders
    SET
      status = 'Pronto',
      current_sector = 'Pronto',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', NULL,
      'status', 'Pronto',
      'actual_time_minutes', v_actual_minutes
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- ── 2. Bulk completion RPC for jumpToSector and similar callers ──────────────
DROP FUNCTION IF EXISTS public.complete_order_stages_bulk(
  p_order_id uuid,
  p_stage_names text[]
) CASCADE;
CREATE OR REPLACE FUNCTION public.complete_order_stages_bulk(
  p_order_id uuid,
  p_stage_names text[]
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
  v_now   timestamptz := now();
BEGIN
  UPDATE public.order_stages
     SET status              = 'concluido',
         quantity_processed  = GREATEST(quantity_processed, quantity_total),
         completed_at        = COALESCE(completed_at, v_now),
         started_at          = COALESCE(started_at, v_now),
         updated_at          = v_now
   WHERE order_id = p_order_id
     AND stage_name = ANY(p_stage_names)
     AND status <> 'concluido';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_order_stages_bulk(uuid, text[]) TO authenticated;

COMMENT ON FUNCTION public.complete_order_stages_bulk(uuid, text[]) IS
  'Marks the listed order_stages as concluded and sets quantity_processed=quantity_total '
  'in a single statement. Used by the Kanban jump-to-sector path so multiple skipped '
  'stages get consistent processed counts.';

-- ── 3. Backfill: stages already concluído with processed = 0 ─────────────────
-- Only touches rows where the completion was clearly written by the buggy path
-- (status concluído but processed never incremented). Skips rows where someone
-- manually set processed to a partial value via SectorStageDialog.
UPDATE public.order_stages
   SET quantity_processed = quantity_total,
       updated_at         = now()
 WHERE status = 'concluido'
   AND COALESCE(quantity_processed, 0) = 0
   AND COALESCE(quantity_total, 0)     > 0;
