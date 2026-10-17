-- Kit apply gravava consumption_sector = '' e quebrava
-- sheet_materials_consumption_sector_check (só NULL ou setor canônico).
-- Efeito: ficha nova Rasteirinha nascia sem linhas na Precificação.

CREATE OR REPLACE FUNCTION public.apply_base_material_kit_to_sheet(p_sheet_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
  v_kit_id uuid;
  v_inserted int := 0;
BEGIN
  IF p_sheet_id IS NULL THEN
    RAISE EXCEPTION 'sheet_id é obrigatório';
  END IF;

  IF NOT public.is_approved_user() AND NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'Sem permissão para aplicar kit de materiais base';
  END IF;

  SELECT shoe_category INTO v_category
    FROM public.technical_sheets
   WHERE id = p_sheet_id;

  IF v_category IS NULL OR nullif(btrim(v_category), '') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT id INTO v_kit_id
    FROM public.base_material_kits
   WHERE shoe_category = v_category
     AND active IS TRUE
   LIMIT 1;

  IF v_kit_id IS NULL THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sheet_materials
     WHERE sheet_id = p_sheet_id AND from_kit_item_id IS NOT NULL
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.sheet_materials (
    sheet_id,
    product_id,
    group_id,
    quantity_per_unit,
    part_name,
    draft_name,
    line_kind,
    cost_mode,
    cost_per_pair,
    estimated_unit_price,
    is_active,
    include_in_consumption,
    from_kit_item_id,
    consumption_sector,
    color, width, weight, supplier, notes, sizes
  )
  SELECT
    p_sheet_id,
    ki.product_id,
    ki.group_id,
    COALESCE(ki.quantity_per_unit, 1),
    ki.description,
    CASE WHEN ki.product_id IS NULL THEN ki.description ELSE NULL END,
    ki.line_kind,
    ki.cost_mode,
    ki.cost_per_pair,
    CASE
      WHEN ki.product_id IS NULL AND ki.line_kind = 'material'
        THEN COALESCE(ki.estimated_unit_price, ki.cost_per_pair)
      ELSE ki.estimated_unit_price
    END,
    ki.is_active,
    false,
    ki.id,
    NULL, -- NUNCA '' — CHECK só aceita NULL ou setor canônico
    NULL, NULL, NULL, NULL, NULL, NULL
  FROM public.base_material_kit_items ki
  WHERE ki.kit_id = v_kit_id
  ORDER BY ki.sort_order, ki.created_at;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_base_material_kit_to_sheet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_base_material_kit_to_sheet(uuid) TO authenticated, service_role;
