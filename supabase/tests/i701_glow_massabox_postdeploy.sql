-- Verificação somente leitura da correção I701/Glow (migration 16300).
-- Executar imediatamente após publicar: preço/saldo aqui são o cadastro
-- confirmado pelo dono, não invariantes para impedir entradas futuras.
-- Não recalcula pedidos, cria movimentações ou altera consumo/snapshot.

BEGIN READ ONLY;

DO $test$
DECLARE
  v_sheet_id constant uuid := '049cef09-f46f-4017-b9c7-e927b52b8632';
  v_variant_id constant uuid := '864fd0f1-8445-439c-97de-1213fdd59975';
  v_base_id constant uuid := 'd2e718c8-aeb9-4706-be19-fd34b7fcc158';
  v_main_id constant uuid := 'e0673b80-546f-467a-9022-b288b7abdcda';
  v_group_id uuid;
  v_color text;
  v_upper_id uuid;
  v_lining_id uuid;
BEGIN
  SELECT v.upper_material_group_id INTO STRICT v_group_id
    FROM public.reference_material_variants v
   WHERE v.id = v_variant_id AND v.reference_id = v_sheet_id
     AND v.main_material_group_id = v_main_id
     AND v.lining_material_group_id = v_main_id
     AND v.upper_material_product_id IS NULL
     AND v.lining_material_product_id IS NULL;
  IF v_group_id IS NULL OR v_group_id IN (v_base_id, v_main_id) THEN
    RAISE EXCEPTION 'Cabedal da I701/Glow não aponta para o composto próprio.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.technical_sheets ts
     WHERE ts.id = v_sheet_id AND ts.name = 'I701'
       AND ts.upper_material_group_id = v_base_id
       AND ts.upper_material = 'NAPA SOFT + MASSABOX'
       AND ts.lining_material = 'NAPA SOFT'
       AND ts.upper_material_product_id IS NULL
       AND ts.lining_material_product_id IS NULL
       AND coalesce(ts.variant_drives_upper, false) = false
  ) THEN
    RAISE EXCEPTION 'A ficha tradicional I701 foi alterada ou perdeu o composto original.';
  END IF;
  IF NOT public.product_group_upper_structure_is_compatible(v_base_id, v_group_id)
     OR (SELECT count(*) FROM public.product_group_layers WHERE composite_group_id = v_group_id) <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.product_group_layers
        WHERE composite_group_id = v_group_id AND is_color_source
          AND component_group_id = v_main_id AND role = 'Material externo'
     ) OR NOT EXISTS (
       SELECT 1 FROM public.product_group_layers
        WHERE composite_group_id = v_group_id AND NOT is_color_source
          AND component_group_id IS NULL AND component_label = 'MASSABOX'
          AND role = 'Base da dublagem'
     ) THEN
    RAISE EXCEPTION 'Glow composto perdeu a fonte de cor ou a camada fixa MASSABOX.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_groups g WHERE g.id = v_group_id
      AND g.name = 'GLOW METALIC + MASSABOX' AND g.sector = 'Cabedal'
      AND g.consumption_unit = 'm' AND g.dimensions_width = 1370
      AND g.dimensions_length = 1000 AND g.dimensions_thickness = 1
      AND g.dimensions_unit = 'mm' AND NOT g.is_family
  ) THEN
    RAISE EXCEPTION 'Grupo composto não possui as dimensões/unidade confirmadas.';
  END IF;
  IF (SELECT array_agg(color ORDER BY color) FROM public.products
       WHERE group_id = v_group_id AND active)
       IS DISTINCT FROM ARRAY['CHAMPAGNE', 'COBRE', 'OURO LIGHT', 'PRATA']::text[] THEN
    RAISE EXCEPTION 'O composto não tem exatamente as quatro cores ativas Glow.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.products p
      LEFT JOIN public.component_sheets cs ON cs.product_id = p.id
     WHERE p.group_id = v_group_id AND p.active
       AND (p.unit IS DISTINCT FROM 'm'
         OR p.purchase_unit IS DISTINCT FROM 'm'
         OR p.production_unit IS DISTINCT FROM 'm'
         OR p.consumption_unit IS DISTINCT FROM 'm'
         OR p.conversion_rate IS DISTINCT FROM 1
         OR p.unit_price IS DISTINCT FROM 45.54
         OR p.purchase_price IS DISTINCT FROM 45.54
         OR p.quantity IS DISTINCT FROM 0
         OR coalesce(p.current_stock, 0) <> 0
         OR coalesce(p.reserved_stock, 0) <> 0
         OR coalesce(p.stock_grade, '{}'::jsonb) <> '{}'::jsonb
         OR p.dimensions_width IS DISTINCT FROM 1370
         OR p.dimensions_length IS DISTINCT FROM 1000
         OR p.dimensions_thickness IS DISTINCT FROM 1
         OR p.dimensions_unit IS DISTINCT FROM 'mm'
         OR cs.group_id IS DISTINCT FROM v_group_id
         OR cs.dimensions_width IS DISTINCT FROM 1370
         OR cs.dimensions_length IS DISTINCT FROM 1000
         OR cs.dimensions_thickness IS DISTINCT FROM 1
         OR cs.dimensions_unit IS DISTINCT FROM 'mm')
  ) THEN
    RAISE EXCEPTION 'SKU/ficha Glow composto diverge de R$ 45,54/m, 1370×1000×1 mm, saldo zero.';
  END IF;

  -- Valida o produto realmente escolhido pelos motores, inclusive OURO
  -- LIGHT, sem depender somente dos IDs de grupos gravados na variante.
  FOREACH v_color IN ARRAY ARRAY['CHAMPAGNE', 'COBRE', 'OURO LIGHT', 'PRATA'] LOOP
    SELECT r.product_id INTO STRICT v_upper_id
      FROM public.resolve_upper_material_for_variant(
        v_variant_id, 'NAPA SOFT + MASSABOX', v_color, 0, NULL
      ) r;
    SELECT r.product_id INTO STRICT v_lining_id
      FROM public.resolve_lining_material_for_variant(
        v_variant_id, 'NAPA SOFT', v_color, 0, NULL
      ) r;
    IF NOT EXISTS (SELECT 1 FROM public.products
                    WHERE id = v_upper_id AND group_id = v_group_id AND color = v_color)
       OR NOT EXISTS (SELECT 1 FROM public.products
                       WHERE id = v_lining_id AND group_id = v_main_id AND color = v_color)
       OR v_upper_id IS NOT DISTINCT FROM v_lining_id THEN
      RAISE EXCEPTION 'Resolver não preservou Cabedal composto/Forração simples para %.', v_color;
    END IF;
  END LOOP;
END
$test$;

SELECT p.color AS cor, g.name AS cabedal, p.unit_price AS custo_por_metro,
       p.quantity AS saldo, cs.dimensions_width AS largura_mm,
       cs.dimensions_length AS comprimento_mm, cs.dimensions_thickness AS espessura_mm,
       lining.name AS forracao
  FROM public.reference_material_variants v
  JOIN public.product_groups g ON g.id = v.upper_material_group_id
  JOIN public.product_groups lining ON lining.id = v.lining_material_group_id
  JOIN public.products p ON p.group_id = g.id AND p.active
  JOIN public.component_sheets cs ON cs.product_id = p.id
 WHERE v.id = '864fd0f1-8445-439c-97de-1213fdd59975'
 ORDER BY p.color;

ROLLBACK;
