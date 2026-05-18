-- =============================================================================
-- Fallback inteligente de peso: média do solado quando ficha sem weight cadastrado
-- =============================================================================
--
-- 📋 Pedido do usuário: quando alguém esquece de preencher
--    technical_sheets.weight_per_pair_kg de uma ficha, NÃO usar o fallback
--    cego de 0,5 kg/par. Em vez disso, usar a MÉDIA do peso de OUTRAS
--    fichas que compartilham o MESMO SOLADO (mesmo sole_group_id).
--    O peso do calçado é dominado por solado + cabedal — fichas com mesmo
--    solado têm peso similar, então a média é uma estimativa muito mais
--    realista do que 0,5 cego.
--
-- ✅ Implementação:
--
-- 1) NOVA RPC `estimate_weight_per_pair_kg(p_sheet_id)`:
--    - Pega ts.sole_group_id da ficha; tenta AVG das OUTRAS fichas no mesmo
--      grupo com peso cadastrado.
--    - Se sole_group_id nulo OU AVG=NULL, tenta o mesmo via primary_sole_id.
--    - Se ainda assim nada, retorna NULL — caller decide o que fazer.
--    - Sempre exclui a própria ficha do AVG (evita auto-referência).
--
-- 2) REPLACE `calculate_sale_order_weight(p_sale_order_id)`:
--    - Pra cada item, COALESCE(ts.weight_per_pair_kg, estimate_weight_...).
--    - Soma no net_weight_kg total (mesmo agregado de antes, mas agora maior).
--    - Adiciona campos extras no retorno:
--        net_weight_real_kg       — só itens com peso PRÓPRIO cadastrado
--        net_weight_estimated_kg  — soma dos itens estimados via solado
--    - incomplete_items ganha campos extras:
--        estimated_kg_per_pair    — o valor estimado (ou null)
--        estimate_source          — 'sole_group_avg' | 'sole_id_avg' | null
--    - is_complete continua false se HÁ qualquer item sem peso próprio (pra
--      UI ainda incentivar o user a cadastrar), mesmo que estimativa exista.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.estimate_weight_per_pair_kg(p_sheet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sole_group_id uuid;
  v_primary_sole_id uuid;
  v_avg numeric;
  v_source text;
BEGIN
  IF p_sheet_id IS NULL THEN
    RETURN jsonb_build_object('avg_kg', NULL, 'source', NULL);
  END IF;

  SELECT sole_group_id, primary_sole_id
    INTO v_sole_group_id, v_primary_sole_id
    FROM technical_sheets
   WHERE id = p_sheet_id;

  -- Tentativa 1: AVG dentro do mesmo sole_group_id (excluindo a própria ficha)
  IF v_sole_group_id IS NOT NULL THEN
    SELECT AVG(weight_per_pair_kg)::numeric INTO v_avg
      FROM technical_sheets
     WHERE sole_group_id = v_sole_group_id
       AND id <> p_sheet_id
       AND weight_per_pair_kg IS NOT NULL
       AND weight_per_pair_kg > 0;
    IF v_avg IS NOT NULL AND v_avg > 0 THEN
      RETURN jsonb_build_object('avg_kg', ROUND(v_avg, 3), 'source', 'sole_group_avg');
    END IF;
  END IF;

  -- Tentativa 2: AVG dentro do mesmo primary_sole_id (solado específico)
  IF v_primary_sole_id IS NOT NULL THEN
    SELECT AVG(weight_per_pair_kg)::numeric INTO v_avg
      FROM technical_sheets
     WHERE primary_sole_id = v_primary_sole_id
       AND id <> p_sheet_id
       AND weight_per_pair_kg IS NOT NULL
       AND weight_per_pair_kg > 0;
    IF v_avg IS NOT NULL AND v_avg > 0 THEN
      RETURN jsonb_build_object('avg_kg', ROUND(v_avg, 3), 'source', 'sole_id_avg');
    END IF;
  END IF;

  RETURN jsonb_build_object('avg_kg', NULL, 'source', NULL);
END $$;

COMMENT ON FUNCTION public.estimate_weight_per_pair_kg(uuid) IS
  'Estima weight_per_pair_kg via AVG das outras fichas com mesmo sole_group_id (fallback primary_sole_id). '
  'Retorna {avg_kg, source} ou {NULL, NULL} se não conseguir estimar.';

REVOKE EXECUTE ON FUNCTION public.estimate_weight_per_pair_kg(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estimate_weight_per_pair_kg(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- calculate_sale_order_weight passa a integrar a estimativa por solado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_sale_order_weight(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_pairs int := 0;
  v_net_real numeric := 0;
  v_net_estimated numeric := 0;
  v_net_weight numeric := 0;
  v_box_weight numeric := 0;
  v_gross_weight numeric := 0;
  v_incomplete jsonb := '[]'::jsonb;
BEGIN
  WITH items AS (
    SELECT
      soi.id, soi.quantity, soi.reference_id,
      ts.id AS sheet_id, ts.code, ts.name,
      ts.weight_per_pair_kg, ts.box_weight_kg
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
    COALESCE(SUM(quantity * box_weight_kg), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'reference_id', reference_id,
      'code', code,
      'name', name,
      'pairs', quantity,
      'estimated_kg_per_pair', (estimate->>'avg_kg')::numeric,
      'estimate_source', estimate->>'source'
    )) FILTER (WHERE weight_per_pair_kg IS NULL), '[]'::jsonb)
  INTO v_total_pairs, v_net_real, v_net_estimated, v_box_weight, v_incomplete
  FROM enriched;

  v_net_weight := v_net_real + v_net_estimated;
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
