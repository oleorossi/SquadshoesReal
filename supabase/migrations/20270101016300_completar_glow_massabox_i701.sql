-- Cadastro autorizado pelo dono para a variante Glow Metallic da I701:
-- Cabedal = GLOW METALIC + MASSABOX; Forração = GLOW METALIC.
-- O composto acabado custa R$ 2/m acima do NAPA SOFT + MASSABOX e tem
-- as mesmas dimensões. Base conferida: R$ 43,54/m e 1370 × 1000 × 1 mm.
-- Saldo inicial zero. Não recalcula pedidos, reservas, snapshots ou consumos.
-- A composição é cadastral: MASSABOX não ganha débito separado no BOM.

BEGIN;

DO $catalog$
DECLARE
  v_base_id constant uuid := 'd2e718c8-aeb9-4706-be19-fd34b7fcc158';
  v_main_id constant uuid := 'e0673b80-546f-467a-9022-b288b7abdcda';
  v_sheet_id constant uuid := '049cef09-f46f-4017-b9c7-e927b52b8632';
  v_variant_id constant uuid := '864fd0f1-8445-439c-97de-1213fdd59975';
  v_name constant text := 'GLOW METALIC + MASSABOX';
  v_colors constant text[] := ARRAY['CHAMPAGNE', 'COBRE', 'OURO LIGHT', 'PRATA'];
  v_base public.product_groups%ROWTYPE;
  v_main public.product_groups%ROWTYPE;
  v_group public.product_groups%ROWTYPE;
  v_sheet public.technical_sheets%ROWTYPE;
  v_variant public.reference_material_variants%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_group_id uuid;
  v_candidates uuid[];
  v_color text;
  v_sku text;
  v_cost numeric;
  v_count integer;
  v_before_variant jsonb;
  v_group_created boolean := false;
BEGIN
  -- A mesma trava é utilizada pelo cadastro de composições e pelos guards.
  PERFORM pg_advisory_xact_lock(hashtextextended('composite-upper-structure-writes', 0));
  SELECT * INTO STRICT v_sheet FROM public.technical_sheets
   WHERE id = v_sheet_id FOR UPDATE;
  SELECT * INTO STRICT v_variant FROM public.reference_material_variants
   WHERE id = v_variant_id FOR UPDATE;
  SELECT * INTO STRICT v_base FROM public.product_groups WHERE id = v_base_id FOR SHARE;
  SELECT * INTO STRICT v_main FROM public.product_groups WHERE id = v_main_id FOR SHARE;

  IF v_sheet.name IS DISTINCT FROM 'I701'
     OR v_sheet.retired_at IS NOT NULL
     OR v_sheet.upper_material_group_id IS DISTINCT FROM v_base_id
     OR v_sheet.upper_material_product_id IS NOT NULL
     OR v_sheet.lining_material_product_id IS NOT NULL
     OR v_sheet.lining_material IS DISTINCT FROM 'NAPA SOFT'
     OR v_variant.reference_id IS DISTINCT FROM v_sheet_id
     OR v_variant.main_material_group_id IS DISTINCT FROM v_main_id
     OR v_variant.upper_material_product_id IS NOT NULL
     OR v_variant.lining_material_product_id IS NOT NULL
     OR NOT v_variant.active THEN
    RAISE EXCEPTION 'I701/Glow mudou desde a auditoria; revisar antes de alterar o cadastro.';
  END IF;

  SELECT array_agg(g.id ORDER BY g.id) INTO v_candidates
    FROM public.product_groups g
   WHERE NOT g.is_family
     AND NOT EXISTS (SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = g.id)
     AND (SELECT count(*) FROM public.product_group_layers l
           WHERE l.composite_group_id = g.id AND l.is_color_source) = 1
     AND EXISTS (SELECT 1 FROM public.product_group_layers l
                  WHERE l.composite_group_id = g.id AND l.is_color_source
                    AND l.component_group_id = v_main_id)
     AND public.product_group_upper_structure_is_compatible(v_base_id, g.id);
  IF coalesce(cardinality(v_candidates), 0) > 1 THEN
    RAISE EXCEPTION 'Mais de um composto Glow compatível; escolha cadastral necessária.';
  END IF;
  v_group_id := v_candidates[1];

  -- Replay depois da correção não reverte saldo/preço nem religa pedidos.
  IF v_group_id IS NOT NULL
     AND v_variant.upper_material_group_id = v_group_id
     AND v_variant.lining_material_group_id = v_main_id THEN
    RETURN;
  END IF;

  IF v_variant.upper_material_group_id IS NOT NULL
     OR v_variant.lining_material_group_id IS NOT NULL THEN
    RAISE EXCEPTION 'A variante I701/Glow já recebeu overrides; preservar e revisar manualmente.';
  END IF;
  -- FOR UPDATE na variante também impede novos vínculos por FK durante
  -- esta transação. OPs derivam a variante do item do PV, coberto abaixo.
  IF EXISTS (SELECT 1 FROM public.sale_order_items WHERE material_variant_id = v_variant_id)
     OR EXISTS (SELECT 1 FROM public.sheet_materials WHERE material_variant_id = v_variant_id)
     OR EXISTS (SELECT 1 FROM public.ready_stock WHERE material_variant_id = v_variant_id)
     OR EXISTS (SELECT 1 FROM public.ready_stock_movements WHERE material_variant_id = v_variant_id)
     OR EXISTS (SELECT 1 FROM public.nfe_devolucao_item_claims WHERE material_variant_id = v_variant_id) THEN
    RAISE EXCEPTION 'I701/Glow já possui vínculo operacional; não alterar seu histórico automaticamente.';
  END IF;

  IF v_base.name IS DISTINCT FROM 'NAPA SOFT + MASSABOX'
     OR v_main.name IS DISTINCT FROM 'GLOW METALIC'
     OR v_base.sector IS DISTINCT FROM 'Cabedal'
     OR v_base.is_family OR v_main.is_family
     OR v_base.dimensions_width IS DISTINCT FROM 1370
     OR v_base.dimensions_length IS DISTINCT FROM 1000
     OR v_base.dimensions_thickness IS DISTINCT FROM 1
     OR v_base.dimensions_unit IS DISTINCT FROM 'mm'
     OR EXISTS (SELECT 1 FROM public.product_groups WHERE parent_group_id IN (v_base_id, v_main_id))
     OR EXISTS (SELECT 1 FROM public.product_group_layers WHERE composite_group_id = v_main_id)
     OR (SELECT count(*) FROM public.product_group_layers WHERE composite_group_id = v_base_id) <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.product_group_layers
        WHERE composite_group_id = v_base_id AND is_color_source
          AND component_group_id = 'a0c6dcee-c72f-4e66-8f69-47be847957d3'
          AND role = 'Material externo'
     ) OR NOT EXISTS (
       SELECT 1 FROM public.product_group_layers
        WHERE composite_group_id = v_base_id AND NOT is_color_source
          AND component_group_id IS NULL AND component_label = 'MASSABOX'
          AND role = 'Base da dublagem'
     ) THEN
    RAISE EXCEPTION 'A geometria/composição base mudou; não fabricar dimensões ou camadas.';
  END IF;

  -- Só SKUs medidos em metro fundamentam o preço. AMARELO legado em un
  -- não é referência de custo e permanece intocado nesta correção.
  SELECT count(*), min(unit_price) INTO v_count, v_cost FROM public.products
   WHERE group_id = v_base_id AND active AND unit = 'm';
  IF v_count = 0 OR v_cost IS DISTINCT FROM 43.54 OR EXISTS (
    SELECT 1 FROM public.products p
      LEFT JOIN public.component_sheets cs ON cs.product_id = p.id
     WHERE p.group_id = v_base_id AND p.active AND p.unit = 'm'
       AND (p.unit_price IS DISTINCT FROM 43.54
         OR cs.dimensions_width IS DISTINCT FROM v_base.dimensions_width
         OR cs.dimensions_length IS DISTINCT FROM v_base.dimensions_length
         OR cs.dimensions_thickness IS DISTINCT FROM v_base.dimensions_thickness
         OR cs.dimensions_unit IS DISTINCT FROM v_base.dimensions_unit)
  ) THEN
    RAISE EXCEPTION 'Custo/ficha do composto base diverge da confirmação de R$ 43,54/m.';
  END IF;
  v_cost := v_cost + 2;

  IF (SELECT array_agg(color ORDER BY color) FROM public.products
       WHERE group_id = v_main_id AND active AND unit = 'm') IS DISTINCT FROM v_colors THEN
    RAISE EXCEPTION 'As quatro cores ativas Glow mudaram; revisar a lista antes de cadastrar o composto.';
  END IF;

  IF v_group_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.product_groups WHERE lower(btrim(name)) = lower(v_name)) THEN
      RAISE EXCEPTION 'O nome % já existe com outra composição.', v_name;
    END IF;
    INSERT INTO public.product_groups (
      name, description, sector, is_family, shared_specs, auto_component_sheet,
      consumption_unit, dimensions_width, dimensions_length, dimensions_thickness, dimensions_unit
    ) VALUES (
      v_name, 'Glow Metallic + Massa Box para I701; mesmas dimensões do composto Napa Soft e custo R$ 2/m maior.',
      'Cabedal', false, true, true, 'm', v_base.dimensions_width,
      v_base.dimensions_length, v_base.dimensions_thickness, v_base.dimensions_unit
    ) RETURNING id INTO v_group_id;
    v_group_created := true;

    INSERT INTO public.product_group_layers (
      composite_group_id, component_group_id, component_label, role,
      display_order, is_color_source, notes
    ) SELECT v_group_id,
      CASE WHEN l.is_color_source THEN v_main_id ELSE l.component_group_id END,
      CASE WHEN l.is_color_source THEN v_main.name ELSE l.component_label END,
      l.role, l.display_order, l.is_color_source, l.notes
      FROM public.product_group_layers l WHERE l.composite_group_id = v_base_id;
  ELSE
    SELECT * INTO STRICT v_group FROM public.product_groups WHERE id = v_group_id FOR UPDATE;
    -- A RPC de preparação pode ter criado somente o grupo/camadas antes
    -- desta migration. Completar esse rascunho vazio é seguro; um catálogo
    -- já utilizado conserva seus dados e passa pela validação abaixo.
    IF v_group.name = v_name AND v_group.sector = 'Cabedal'
       AND coalesce(v_group.dimensions_width, 0) = 0
       AND coalesce(v_group.dimensions_length, 0) = 0
       AND coalesce(v_group.dimensions_thickness, 0) = 0
       AND nullif(btrim(v_group.consumption_unit), '') IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.products WHERE group_id = v_group_id)
       AND NOT EXISTS (SELECT 1 FROM public.technical_sheets WHERE upper_material_group_id = v_group_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.reference_material_variants
          WHERE v_group_id IN (main_material_group_id, upper_material_group_id, lining_material_group_id, insole_material_group_id)
       ) THEN
      UPDATE public.product_groups SET
        shared_specs = true, auto_component_sheet = true, consumption_unit = 'm',
        dimensions_width = v_base.dimensions_width,
        dimensions_length = v_base.dimensions_length,
        dimensions_thickness = v_base.dimensions_thickness,
        dimensions_unit = v_base.dimensions_unit
      WHERE id = v_group_id RETURNING * INTO v_group;
    END IF;
    IF v_group.sector IS DISTINCT FROM 'Cabedal' OR v_group.consumption_unit IS DISTINCT FROM 'm'
       OR v_group.dimensions_width IS DISTINCT FROM v_base.dimensions_width
       OR v_group.dimensions_length IS DISTINCT FROM v_base.dimensions_length
       OR v_group.dimensions_thickness IS DISTINCT FROM v_base.dimensions_thickness
       OR v_group.dimensions_unit IS DISTINCT FROM v_base.dimensions_unit THEN
      RAISE EXCEPTION 'Composto Glow já existe com cadastro diferente; não sobrescrever dimensões/unidade.';
    END IF;
  END IF;

  FOREACH v_color IN ARRAY v_colors LOOP
    SELECT * INTO v_product FROM public.products
     WHERE group_id = v_group_id AND color = v_color AND active FOR UPDATE;
    IF NOT FOUND THEN
      v_sku := 'GLOWMETALICMASSABOX-' || replace(v_color, ' ', '-');
      IF EXISTS (SELECT 1 FROM public.products WHERE upper(btrim(sku)) = v_sku)
         OR EXISTS (SELECT 1 FROM public.products WHERE group_id = v_group_id AND color = v_color) THEN
        RAISE EXCEPTION 'SKU/cor % já existe; não reativar nem sobrescrever material automaticamente.', v_sku;
      END IF;
      -- Bootstrap cadastral executado pelo dono da migration: INSERT de saldo
      -- zero não é movimentação física. Triggers de auditoria/ficha permanecem
      -- ativos. Sem fingir auth.uid(), alterar permissões ou executar a RPC
      -- de estoque manual com identidade de usuário inventada.
      INSERT INTO public.products (
        name, sku, category, group_id, color, active,
        unit, purchase_unit, purchase_order_unit, production_unit, consumption_unit,
        conversion_rate, quantity, current_stock, reserved_stock, stock_grade,
        unit_price, purchase_price, dimensions_width, dimensions_length,
        dimensions_thickness, dimensions_unit, calculation_method
      ) VALUES (
        v_name || ' - ' || v_color, v_sku, 'Cabedal', v_group_id, v_color, true,
        'm', 'm', 'm', 'm', 'm', 1, 0, 0, 0, '{}'::jsonb,
        v_cost, v_cost, v_base.dimensions_width, v_base.dimensions_length,
        v_base.dimensions_thickness, v_base.dimensions_unit, v_base.calculation_method
      ) RETURNING * INTO v_product;
    END IF;

    IF v_product.unit IS DISTINCT FROM 'm'
       OR v_product.purchase_unit IS DISTINCT FROM 'm'
       OR v_product.conversion_rate IS DISTINCT FROM 1
       OR v_product.unit_price IS DISTINCT FROM v_cost
       OR v_product.quantity IS DISTINCT FROM 0
       OR coalesce(v_product.current_stock, 0) <> 0
       OR coalesce(v_product.reserved_stock, 0) <> 0
       OR coalesce(v_product.stock_grade, '{}'::jsonb) <> '{}'::jsonb
       OR v_product.dimensions_width IS DISTINCT FROM v_base.dimensions_width
       OR v_product.dimensions_length IS DISTINCT FROM v_base.dimensions_length
       OR v_product.dimensions_thickness IS DISTINCT FROM v_base.dimensions_thickness
       OR v_product.dimensions_unit IS DISTINCT FROM v_base.dimensions_unit THEN
      RAISE EXCEPTION 'Produto composto da cor % diverge do cadastro confirmado; preservar dados existentes.', v_color;
    END IF;

    INSERT INTO public.component_sheets (
      product_id, group_id, dimensions_width, dimensions_length, dimensions_thickness, dimensions_unit
    ) VALUES (
      v_product.id, v_group_id, v_base.dimensions_width, v_base.dimensions_length,
      v_base.dimensions_thickness, v_base.dimensions_unit
    ) ON CONFLICT (product_id) DO NOTHING;
    IF NOT EXISTS (
      SELECT 1 FROM public.component_sheets cs
       WHERE cs.product_id = v_product.id AND cs.group_id = v_group_id
         AND cs.dimensions_width = v_base.dimensions_width
         AND cs.dimensions_length = v_base.dimensions_length
         AND cs.dimensions_thickness = v_base.dimensions_thickness
         AND cs.dimensions_unit = v_base.dimensions_unit
    ) THEN
      RAISE EXCEPTION 'Ficha de componente divergente na cor %; correção cancelada.', v_color;
    END IF;
  END LOOP;

  v_before_variant := to_jsonb(v_variant) - ARRAY['upper_material_group_id', 'lining_material_group_id', 'updated_at'];
  UPDATE public.reference_material_variants
     SET upper_material_group_id = v_group_id, lining_material_group_id = v_main_id
   WHERE id = v_variant_id;

  IF (SELECT to_jsonb(ts) FROM public.technical_sheets ts WHERE id = v_sheet_id)
       IS DISTINCT FROM to_jsonb(v_sheet)
     OR (SELECT to_jsonb(v) - ARRAY['upper_material_group_id', 'lining_material_group_id', 'updated_at']
           FROM public.reference_material_variants v WHERE id = v_variant_id)
       IS DISTINCT FROM v_before_variant THEN
    RAISE EXCEPTION 'A atualização alterou outros campos da ficha/variante; correção cancelada.';
  END IF;
  IF NOT public.product_group_upper_structure_is_compatible(v_base_id, v_group_id) THEN
    RAISE EXCEPTION 'A composição Glow não preservou a base fixa MASSABOX.';
  END IF;
  RAISE NOTICE 'I701/Glow corrigida: grupo %, criado %, quatro cores, R$ %/m, estoque inicial zero.',
    v_group_id, v_group_created, v_cost;
END
$catalog$;

COMMIT;
