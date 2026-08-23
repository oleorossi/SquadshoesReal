-- O grupo canonico das tiras sem cabedal passou a seguir a Forracao na 08500.
-- Este segundo resolvedor decide se existe um SKU EXATO pinado dentro daquele
-- grupo. Ele precisa obedecer a mesma cascata; caso contrario um pin antigo do
-- slot Cabedal pode contradizer o grupo correto ou o pin da propria Forracao
-- pode ser descartado pela base derivada da ficha.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_strap_pinned_base_product_id(
  p_reference_id uuid,
  p_material_variant_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_variant_upper_group_id uuid;
  v_variant_upper_product_id uuid;
  v_variant_lining_group_id uuid;
  v_variant_lining_product_id uuid;
  v_variant_main_group_id uuid;
  v_straps_follow_lining boolean := false;
BEGIN
  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT rmv.upper_material_group_id,
         rmv.upper_material_product_id,
         rmv.lining_material_group_id,
         rmv.lining_material_product_id,
         rmv.main_material_group_id
    INTO v_variant_upper_group_id,
         v_variant_upper_product_id,
         v_variant_lining_group_id,
         v_variant_lining_product_id,
         v_variant_main_group_id
    FROM public.reference_material_variants rmv
   WHERE rmv.id = p_material_variant_id
     AND rmv.reference_id = p_reference_id
     AND coalesce(rmv.active, true);

  v_straps_follow_lining := coalesce(v_sheet.has_straps, false)
    AND nullif(btrim(v_sheet.upper_material), '') IS NULL
    AND v_sheet.upper_material_group_id IS NULL
    AND v_sheet.upper_material_product_id IS NULL;

  IF v_straps_follow_lining THEN
    RETURN CASE
      -- Excecao explicita do slot Forracao sempre vence.
      WHEN v_variant_lining_product_id IS NOT NULL
        THEN v_variant_lining_product_id
      WHEN v_variant_lining_group_id IS NOT NULL THEN NULL
      -- O principal so substitui a Forracao quando a ficha delegou esse slot.
      WHEN coalesce(v_sheet.variant_drives_lining, false)
           AND v_variant_main_group_id IS NOT NULL THEN NULL
      -- Sem override efetivo da variante, preserva o pin exato da Forracao.
      WHEN v_sheet.lining_material_product_id IS NOT NULL
        THEN v_sheet.lining_material_product_id
      WHEN v_sheet.strap_base_group_id IS NOT NULL THEN NULL
      ELSE NULL
    END;
  END IF;

  -- Demais modelos preservam integralmente a precedencia anterior.
  RETURN CASE
    WHEN v_variant_upper_product_id IS NOT NULL THEN v_variant_upper_product_id
    WHEN v_variant_upper_group_id IS NOT NULL THEN NULL
    WHEN v_variant_lining_product_id IS NOT NULL THEN v_variant_lining_product_id
    WHEN v_variant_lining_group_id IS NOT NULL THEN NULL
    WHEN v_variant_main_group_id IS NOT NULL THEN NULL
    WHEN v_sheet.upper_material_product_id IS NOT NULL
      THEN v_sheet.upper_material_product_id
    WHEN v_sheet.upper_material_group_id IS NOT NULL THEN NULL
    WHEN v_sheet.strap_base_group_id IS NOT NULL THEN NULL
    WHEN v_sheet.lining_material_product_id IS NOT NULL
      THEN v_sheet.lining_material_product_id
    ELSE NULL
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_strap_pinned_base_product_id(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.resolve_strap_pinned_base_product_id(uuid, uuid) IS
  'Resolve somente pin de SKU compativel com o grupo da tira. Em tiras sem cabedal, ignora o slot Cabedal e espelha a Forracao efetiva e sua trava variant_drives_lining.';

COMMIT;
