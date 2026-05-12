-- ════════════════════════════════════════════════════════════════════
-- Cálculo automático de peso por PV (aplicada via MCP em 2026-05-13)
-- (1) technical_sheets.weight_per_pair_kg + box_weight_kg
-- (2) RPC calculate_sale_order_weight com warning de items sem peso
--
-- Substitui os 4 inputs manuais de peso espalhados em /manifests, /nfe
-- (edge function), /mdfe e /entregas por uma fonte única calculada a
-- partir da ficha técnica de cada item do PV. Quando uma ficha está sem
-- peso cadastrado, retorna a lista no campo `incomplete_items` pra UI
-- mostrar warning sem bloquear a operação.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE technical_sheets
  ADD COLUMN IF NOT EXISTS weight_per_pair_kg numeric(6,3),
  ADD COLUMN IF NOT EXISTS box_weight_kg numeric(6,3);

COMMENT ON COLUMN technical_sheets.weight_per_pair_kg IS
  'Peso do par do produto acabado em kg (cabedal+forro+solado+ferragens montados). Usado em NF-e, romaneio, MDF-e e rota.';
COMMENT ON COLUMN technical_sheets.box_weight_kg IS
  'Peso da caixinha individual de 1 par. Soma ao peso bruto da NF-e quando informado.';

CREATE OR REPLACE FUNCTION calculate_sale_order_weight(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_pairs int := 0;
  v_net_weight numeric := 0;
  v_box_weight numeric := 0;
  v_collective_box_weight numeric := 0;
  v_gross_weight numeric := 0;
  v_incomplete jsonb := '[]'::jsonb;
BEGIN
  WITH items AS (
    SELECT
      soi.id, soi.quantity, soi.reference_id,
      ts.code, ts.name, ts.weight_per_pair_kg, ts.box_weight_kg
    FROM sale_order_items soi
    LEFT JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = p_sale_order_id
  )
  SELECT
    COALESCE(SUM(quantity), 0),
    COALESCE(SUM(quantity * weight_per_pair_kg), 0),
    COALESCE(SUM(quantity * box_weight_kg), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'reference_id', reference_id,
      'code', code,
      'name', name,
      'pairs', quantity
    )) FILTER (WHERE weight_per_pair_kg IS NULL), '[]'::jsonb)
  INTO v_total_pairs, v_net_weight, v_box_weight, v_incomplete
  FROM items;

  v_gross_weight := v_net_weight + v_box_weight + v_collective_box_weight;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'total_pairs', v_total_pairs,
    'net_weight_kg', ROUND(v_net_weight, 3),
    'box_weight_kg', ROUND(v_box_weight, 3),
    'gross_weight_kg', ROUND(v_gross_weight, 3),
    'incomplete_items', v_incomplete,
    'is_complete', jsonb_array_length(v_incomplete) = 0
  );
END $$;

REVOKE EXECUTE ON FUNCTION calculate_sale_order_weight(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION calculate_sale_order_weight(uuid) TO authenticated, service_role;
