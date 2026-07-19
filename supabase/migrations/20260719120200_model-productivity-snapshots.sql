-- =============================================================================
-- ENGINE DE CAPACIDADE & PRODUTIVIDADE POR MODELO (specs/produtividade-por-modelo.md)
-- PARTE 3/3: banco de custos por referência (aditivo da aprovação).
--
--   • model_productivity_snapshots — congela o resultado calculado (pares/dia,
--     gargalo, custos dos 2 métodos, parâmetros e breakdown) por ficha, com data.
--     Semântica de FREEZE (igual order_costs/reference_sector_pricing): corrigir
--     a ficha depois NÃO altera snapshots antigos.
--   • save_model_productivity_snapshot(uuid) — ÚNICA via de escrita (SECURITY
--     DEFINER + guard is_approved_user, padrão production_pointings): recalcula
--     server-side via get_model_productivity — cliente nunca envia números.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.model_productivity_snapshots (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technical_sheet_id       uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  sheet_name               text NOT NULL,
  pairs_per_day            numeric NULL,
  bottleneck_sector        text NULL,
  mo_per_pair              numeric NULL,
  overhead_per_pair        numeric NULL,
  total_cost_minute        numeric NULL,
  bottleneck_cost_per_pair numeric NULL,
  params                   jsonb NOT NULL,
  sectors                  jsonb NOT NULL,
  created_by               uuid NULL DEFAULT auth.uid(),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_prod_snapshots_sheet
  ON public.model_productivity_snapshots (technical_sheet_id, created_at DESC);

ALTER TABLE public.model_productivity_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approved_select_model_prod_snapshots ON public.model_productivity_snapshots;
CREATE POLICY approved_select_model_prod_snapshots
  ON public.model_productivity_snapshots FOR SELECT USING (public.is_approved_user());
DROP POLICY IF EXISTS approved_delete_model_prod_snapshots ON public.model_productivity_snapshots;
CREATE POLICY approved_delete_model_prod_snapshots
  ON public.model_productivity_snapshots FOR DELETE USING (public.is_approved_user());
-- Sem policy de INSERT/UPDATE: escrita só via RPC SECURITY DEFINER abaixo
-- (impede snapshot forjado pelo cliente com números inventados).

CREATE OR REPLACE FUNCTION public.save_model_productivity_snapshot(p_sheet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_calc  jsonb;
  v_model jsonb;
  v_id    uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'não autorizado';
  END IF;
  IF p_sheet_id IS NULL THEN
    RAISE EXCEPTION 'p_sheet_id obrigatório';
  END IF;

  v_calc := public.get_model_productivity(ARRAY[p_sheet_id]);
  v_model := v_calc->'models'->0;

  IF v_model IS NULL THEN
    RAISE EXCEPTION 'Ficha % não encontrada', p_sheet_id;
  END IF;
  IF coalesce((v_model->>'incomplete')::boolean, true) THEN
    RAISE EXCEPTION 'Ficha % está incompleta (sem tempo em nenhum setor) — cadastre os tempos antes de salvar custos',
      v_model->>'name';
  END IF;

  INSERT INTO public.model_productivity_snapshots
    (technical_sheet_id, sheet_name, pairs_per_day, bottleneck_sector,
     mo_per_pair, overhead_per_pair, total_cost_minute, bottleneck_cost_per_pair,
     params, sectors)
  VALUES
    (p_sheet_id,
     v_model->>'name',
     (v_model->>'pairs_per_day')::numeric,
     v_model->>'bottleneck_sector',
     (v_model->'costs'->>'mo_per_pair')::numeric,
     (v_model->'costs'->>'overhead_per_pair')::numeric,
     (v_model->'costs'->>'total_cost_minute_method')::numeric,
     (v_model->'costs'->>'bottleneck_cost_per_pair')::numeric,
     v_calc->'params',
     v_model->'sectors')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'model', v_model, 'params', v_calc->'params');
END;
$$;

REVOKE ALL ON FUNCTION public.save_model_productivity_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_model_productivity_snapshot(uuid) TO authenticated, service_role;
