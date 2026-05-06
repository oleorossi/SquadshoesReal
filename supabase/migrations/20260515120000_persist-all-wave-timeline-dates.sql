-- =============================================================================
-- Persiste todas as datas do cronograma em production_waves e expõe-as na
-- view v_wave_detail.
--
-- Problema: compute_wave_timeline() calcula montagem_start_date,
-- acabamento_start_date e mesa_start_date mas update_wave_timeline() não
-- escrevia essas colunas (mesa/montagem/acabamento_start_date não existiam
-- na tabela). Resultado: WaveDetailPanel e ProductionWavesPage exibiam NULL
-- para essas datas mesmo após salvar a onda.
--
-- Esta migration:
--   1) ADD COLUMN IF NOT EXISTS para as 3 datas faltantes.
--   2) Recria update_wave_timeline() gravando todas as 8 datas de início de
--      setor + as 3 datas de timeline (purchase_deadline, material_ready_date,
--      earliest_deadline).
--   3) Recria v_wave_detail expondo todas as datas para que o frontend as
--      receba sem precisar de JOIN extra.
-- =============================================================================

-- ── 1) Adiciona colunas faltantes ────────────────────────────────────────────
ALTER TABLE public.production_waves
  ADD COLUMN IF NOT EXISTS mesa_start_date      date,
  ADD COLUMN IF NOT EXISTS montagem_start_date  date,
  ADD COLUMN IF NOT EXISTS acabamento_start_date date;

-- ── 2) Recria update_wave_timeline() ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.update_wave_timeline(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_order_ids uuid[];
  v_tl             record;
BEGIN
  SELECT array_agg(DISTINCT sale_order_id)
    INTO v_sale_order_ids
    FROM public.orders
   WHERE wave_id = p_wave_id;

  IF v_sale_order_ids IS NULL OR array_length(v_sale_order_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_tl
    FROM public.compute_wave_timeline(v_sale_order_ids)
   LIMIT 1;

  UPDATE public.production_waves
     SET earliest_deadline          = v_tl.earliest_deadline,
         purchase_deadline          = v_tl.purchase_deadline,
         material_ready_date        = v_tl.material_ready_date,
         corte_palmilha_start_date  = v_tl.corte_palmilha_start_date,
         corte_forracao_start_date  = v_tl.corte_forracao_start_date,
         mesa_start_date            = v_tl.mesa_start_date,
         silk_start_date            = v_tl.silk_start_date,
         colagem_start_date         = v_tl.colagem_start_date,
         montagem_start_date        = v_tl.montagem_start_date,
         solagem_start_date         = v_tl.solagem_start_date,
         acabamento_start_date      = v_tl.acabamento_start_date,
         updated_at                 = now()
   WHERE id = p_wave_id;
END;
$$;

-- ── 3) Recria v_wave_detail expondo todas as datas ───────────────────────────
DROP VIEW IF EXISTS public.v_wave_detail CASCADE;
CREATE OR REPLACE VIEW public.v_wave_detail AS
SELECT
  w.id                         AS wave_id,
  w.code,
  w.week_start,
  w.week_end,
  w.status                     AS wave_status,
  w.current_stage,
  w.total_pairs,
  w.total_items,
  -- timeline dates
  w.earliest_deadline,
  w.purchase_deadline,
  w.material_ready_date,
  w.corte_palmilha_start_date,
  w.corte_forracao_start_date,
  w.mesa_start_date,
  w.silk_start_date,
  w.colagem_start_date,
  w.montagem_start_date,
  w.solagem_start_date,
  w.acabamento_start_date,
  -- stages array
  (SELECT jsonb_agg(jsonb_build_object(
       'stage',        s.stage,
       'status',       s.status,
       'progress_pct', s.progress_pct,
       'started_at',   s.started_at,
       'finished_at',  s.finished_at
     ) ORDER BY stage_order(s.stage))
   FROM production_wave_stages s WHERE s.wave_id = w.id) AS stages,
  -- items array
  (SELECT jsonb_agg(jsonb_build_object(
       'item_id',        wi.id,
       'reference_id',   wi.reference_id,
       'reference_name', ts.name,
       'sole_product_id', wi.sole_product_id,
       'sole_name',      p_sole.name,
       'color',          wi.color,
       'total_quantity', wi.total_quantity,
       'grade',          wi.grade
     ) ORDER BY p_sole.name NULLS LAST, ts.name, wi.color)
   FROM production_wave_items wi
   LEFT JOIN technical_sheets ts      ON ts.id      = wi.reference_id
   LEFT JOIN products          p_sole ON p_sole.id  = wi.sole_product_id
   WHERE wi.wave_id = w.id) AS items
FROM production_waves w;

GRANT SELECT ON public.v_wave_detail TO authenticated;
