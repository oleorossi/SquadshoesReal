-- ════════════════════════════════════════════════════════════════════════════
-- Auditoria NF-e/embalagem 2026-06-11 — peso bruto por CAMADA de caixa
-- ════════════════════════════════════════════════════════════════════════════
-- ANTES: peso da embalagem = SUM(quantity × technical_sheets.box_weight_kg) —
-- modelo POR PAR (cada par carrega uma fração do peso da caixa). Errado pra
-- caixa coletiva: 12 pares num master adicionavam 12× a tara por-par em vez do
-- peso de UMA caixa.
--
-- AGORA: peso bruto = peso líquido + Σ(nº de caixas × empty_weight_kg), usando
-- o nº de caixas do compute_sale_order_box_breakdown (fonte única, caixa mista).
-- Backward-compat: bucket cuja caixa NÃO tem empty_weight_kg cai no modelo
-- legado por-par (legacy_box_weight_kg = Σ pares × box_weight_kg). Assim a
-- transição é incremental — conforme as caixas ganham empty_weight_kg, o peso
-- migra pro modelo correto, sem quebrar o que já funciona.
--
-- Peso LÍQUIDO (par real/estimado via estimate_weight_per_pair_kg) inalterado.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.calculate_sale_order_weight(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_pairs   int := 0;
  v_net_real      numeric := 0;
  v_net_estimated numeric := 0;
  v_net_weight    numeric := 0;
  v_box_weight    numeric := 0;
  v_gross_weight  numeric := 0;
  v_incomplete    jsonb := '[]'::jsonb;
BEGIN
  -- Peso LÍQUIDO (por par: real cadastrado ou estimado pela média do solado).
  WITH items AS (
    SELECT
      soi.id, soi.quantity, soi.reference_id,
      ts.id AS sheet_id, ts.code, ts.name,
      ts.weight_per_pair_kg
    FROM sale_order_items soi
    LEFT JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = p_sale_order_id
  ),
  enriched AS (
    SELECT
      i.*,
      CASE
        WHEN i.weight_per_pair_kg IS NULL AND i.sheet_id IS NOT NULL
          THEN public.estimate_weight_per_pair_kg(i.sheet_id)
        ELSE NULL
      END AS estimate
    FROM items i
  )
  SELECT
    COALESCE(SUM(quantity), 0),
    COALESCE(SUM(quantity * weight_per_pair_kg) FILTER (WHERE weight_per_pair_kg IS NOT NULL), 0),
    COALESCE(SUM(quantity * COALESCE((estimate->>'avg_kg')::numeric, 0))
             FILTER (WHERE weight_per_pair_kg IS NULL), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'reference_id', reference_id,
      'code', code,
      'name', name,
      'pairs', quantity,
      'estimated_kg_per_pair', (estimate->>'avg_kg')::numeric,
      'estimate_source', estimate->>'source'
    )) FILTER (WHERE weight_per_pair_kg IS NULL), '[]'::jsonb)
  INTO v_total_pairs, v_net_real, v_net_estimated, v_incomplete
  FROM enriched;

  -- Peso da EMBALAGEM por camada: Σ(nº de caixas × empty_weight_kg) quando a
  -- caixa tem tara cadastrada; senão fallback legado por-par (legacy_box_weight_kg).
  SELECT COALESCE(SUM(
    CASE WHEN b.empty_weight_kg IS NOT NULL
         THEN b.boxes * b.empty_weight_kg
         ELSE b.legacy_box_weight_kg
    END), 0)
  INTO v_box_weight
  FROM public.compute_sale_order_box_breakdown(p_sale_order_id) b;

  v_net_weight   := v_net_real + v_net_estimated;
  v_gross_weight := v_net_weight + v_box_weight;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'total_pairs', v_total_pairs,
    'net_weight_kg', ROUND(v_net_weight, 3),
    'net_weight_real_kg', ROUND(v_net_real, 3),
    'net_weight_estimated_kg', ROUND(v_net_estimated, 3),
    'box_weight_kg', ROUND(v_box_weight, 3),
    'gross_weight_kg', ROUND(v_gross_weight, 3),
    'incomplete_items', v_incomplete,
    'is_complete', jsonb_array_length(v_incomplete) = 0
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.calculate_sale_order_weight(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_sale_order_weight(uuid) TO authenticated, service_role;
