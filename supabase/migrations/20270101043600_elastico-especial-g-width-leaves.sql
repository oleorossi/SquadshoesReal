-- Piloto: ELÁSTICO ESPECIAL G vira família; folhas 20MM/25MM/30MM por bitola.
-- Preço padrão por folha: product_groups.default_unit_price (override em products.unit_price).
-- Ordem: criar folha 25MM → mover itens/refs → marcar família → vincular filhos → criar 20/30.

ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS default_unit_price numeric;

COMMENT ON COLUMN public.product_groups.default_unit_price IS
  'Preço padrão (R$) da bitola/folha; aplicado a cores novas. SKU pode divergir (override por cor).';

DO $$
DECLARE
  v_family_id uuid := 'c5b1b9c0-7c52-4776-958f-fb49e7835911';
  v_leaf_25 uuid := 'a25b0000-7c52-4776-958f-fb49e7835925';
  v_leaf_20 uuid := 'a20b0000-7c52-4776-958f-fb49e7835920';
  v_leaf_30 uuid := 'a30b0000-7c52-4776-958f-fb49e7835930';
  v_family record;
  v_default_price numeric;
BEGIN
  SELECT * INTO v_family
  FROM public.product_groups
  WHERE id = v_family_id
    AND name = 'ELÁSTICO ESPECIAL G'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE NOTICE 'ELÁSTICO ESPECIAL G não encontrado — migration no-op';
    RETURN;
  END IF;

  -- Já convertido (idempotente).
  IF coalesce(v_family.is_family, false)
     AND EXISTS (
       SELECT 1 FROM public.product_groups
       WHERE parent_group_id = v_family_id AND name = '25MM'
     )
  THEN
    RAISE NOTICE 'ELÁSTICO ESPECIAL G já é família com folha 25MM — no-op';
    RETURN;
  END IF;

  IF coalesce(v_family.is_family, false) THEN
    RAISE EXCEPTION 'ELÁSTICO ESPECIAL G já é família sem folha 25MM esperada — abortando';
  END IF;

  SELECT avg(p.unit_price) INTO v_default_price
  FROM public.products p
  WHERE p.group_id = v_family_id
    AND p.active IS DISTINCT FROM false;

  -- 1) Folha 25MM (ainda sem parent — família ainda tem itens).
  INSERT INTO public.product_groups (
    id, name, description, sector,
    is_family, parent_group_id, shared_specs, consumption_unit,
    dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit,
    auto_component_sheet, is_color_agnostic, is_bom_color_source, is_artisanal_strap,
    default_unit_price
  ) VALUES (
    v_leaf_25,
    '25MM',
    'Bitola 25 mm de ELÁSTICO ESPECIAL G',
    v_family.sector,
    false,
    NULL,
    true,
    coalesce(v_family.consumption_unit, 'm'),
    coalesce(v_family.dimensions_length, 0),
    25,
    coalesce(v_family.dimensions_thickness, 0),
    coalesce(nullif(v_family.dimensions_unit, ''), 'mm'),
    coalesce(v_family.auto_component_sheet, false),
    coalesce(v_family.is_color_agnostic, false),
    coalesce(v_family.is_bom_color_source, false),
    coalesce(v_family.is_artisanal_strap, false),
    v_default_price
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.product_groups WHERE id = v_leaf_25) THEN
    -- Nome pode já existir sob outro id (colisão de name unique).
    SELECT id INTO v_leaf_25 FROM public.product_groups WHERE lower(trim(name)) = '25mm' LIMIT 1;
    IF v_leaf_25 IS NULL THEN
      RAISE EXCEPTION 'Não foi possível criar/localizar a folha 25MM';
    END IF;
  END IF;

  -- 2) Mover SKUs e fichas de componente.
  UPDATE public.products
  SET group_id = v_leaf_25
  WHERE group_id = v_family_id;

  UPDATE public.component_sheets
  SET group_id = v_leaf_25
  WHERE group_id = v_family_id;

  -- 3) Remap fichas / variantes / BOM que pinavam o grupo antigo.
  UPDATE public.technical_sheets
  SET upper_material_group_id = v_leaf_25,
      upper_material = CASE
        WHEN upper_material ILIKE '%ESPECIAL G%' OR upper_material = 'ELÁSTICO ESPECIAL G'
          THEN '25MM'
        ELSE upper_material
      END
  WHERE upper_material_group_id = v_family_id;

  UPDATE public.technical_sheets
  SET strap_base_group_id = v_leaf_25
  WHERE strap_base_group_id = v_family_id;

  UPDATE public.reference_material_variants
  SET upper_material_group_id = v_leaf_25
  WHERE upper_material_group_id = v_family_id;

  UPDATE public.reference_material_variants
  SET lining_material_group_id = v_leaf_25
  WHERE lining_material_group_id = v_family_id;

  UPDATE public.reference_material_variants
  SET main_material_group_id = v_leaf_25
  WHERE main_material_group_id = v_family_id;

  UPDATE public.reference_material_variants
  SET insole_material_group_id = v_leaf_25
  WHERE insole_material_group_id = v_family_id;

  UPDATE public.sheet_materials
  SET group_id = v_leaf_25
  WHERE group_id = v_family_id;

  UPDATE public.group_suppliers
  SET group_id = v_leaf_25
  WHERE group_id = v_family_id;

  UPDATE public.group_supplier_materials
  SET group_id = v_leaf_25
  WHERE group_id = v_family_id;

  UPDATE public.group_colors
  SET group_id = v_leaf_25
  WHERE group_id = v_family_id;

  -- 4) Transformar o cadastro original em família (sem itens).
  UPDATE public.product_groups
  SET is_family = true,
      parent_group_id = null,
      shared_specs = false,
      consumption_unit = null,
      dimensions_width = 0,
      dimensions_length = 0,
      dimensions_thickness = 0,
      default_unit_price = null,
      description = coalesce(
        nullif(btrim(description), ''),
        'Família ELÁSTICO ESPECIAL G — bitolas em grupos-folha (20/25/30 mm).'
      )
  WHERE id = v_family_id;

  -- 5) Vincular 25MM e criar 20/30 vazios.
  UPDATE public.product_groups
  SET parent_group_id = v_family_id,
      sector = v_family.sector,
      shared_specs = true,
      consumption_unit = coalesce(consumption_unit, 'm'),
      dimensions_width = 25,
      dimensions_unit = coalesce(nullif(dimensions_unit, ''), 'mm')
  WHERE id = v_leaf_25;

  INSERT INTO public.product_groups (
    id, name, description, sector,
    is_family, parent_group_id, shared_specs, consumption_unit,
    dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit,
    auto_component_sheet, is_color_agnostic, is_bom_color_source, is_artisanal_strap,
    default_unit_price
  ) VALUES
    (
      v_leaf_20, '20MM', 'Bitola 20 mm de ELÁSTICO ESPECIAL G', v_family.sector,
      false, v_family_id, true, 'm',
      0, 20, 0, 'mm',
      false, false, false, false,
      null
    ),
    (
      v_leaf_30, '30MM', 'Bitola 30 mm de ELÁSTICO ESPECIAL G', v_family.sector,
      false, v_family_id, true, 'm',
      0, 30, 0, 'mm',
      false, false, false, false,
      null
    )
  ON CONFLICT (id) DO UPDATE
  SET parent_group_id = EXCLUDED.parent_group_id,
      sector = EXCLUDED.sector,
      dimensions_width = EXCLUDED.dimensions_width,
      dimensions_unit = EXCLUDED.dimensions_unit,
      shared_specs = true,
      consumption_unit = coalesce(public.product_groups.consumption_unit, 'm');
END $$;
