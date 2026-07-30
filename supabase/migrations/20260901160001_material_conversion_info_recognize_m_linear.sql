-- ============================================================================
-- get_material_conversion_info: reconhece 'm linear' como unidade linear
-- ============================================================================
-- 'm linear' é uma unidade selecionável de verdade (src/pages/ComponentSheets.tsx
-- PRODUCT_UNITS) e é o alvo canônico de toCanonical() em src/lib/nfUnitConversion.ts
-- (mtl/m linear/m lin/ml (linear) → 'm linear'). v_is_linear não reconhecia esse
-- valor, então um produto com unit='m linear' pulava a conversão dm²→metro
-- inteiramente e usava o valor de dm² cru como se já fosse metro — reintroduzindo
-- a inflação ~100x que o sistema de unidades canônicas existe pra evitar.
-- Companheiro do fix em src/lib/materialConsumption.ts (LINEAR_UNITS).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_material_conversion_info(p_product_id uuid)
 RETURNS TABLE(dm2_per_unit numeric, waste_pct numeric, target_unit text, conversion_warning text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_width numeric; v_length numeric; v_dim numeric; v_dim_unit text;
  v_prod_unit text; v_waste numeric; v_group_id uuid; v_is_linear boolean;
  v_has_cs boolean;
BEGIN
  SELECT unit, group_id INTO v_prod_unit, v_group_id FROM public.products WHERE id = p_product_id;
  SELECT dimensions_width, dimensions_length, dimensions_unit, cs.waste_pct
    INTO v_width, v_length, v_dim_unit, v_waste
    FROM public.component_sheets cs WHERE cs.product_id = p_product_id;
  v_dim := GREATEST(COALESCE(v_width, 0), COALESCE(v_length, 0));
  IF v_dim <= 0 THEN
    SELECT GREATEST(COALESCE(cs.dimensions_width,0), COALESCE(cs.dimensions_length,0)),
           cs.dimensions_unit, COALESCE(v_waste, cs.waste_pct)
      INTO v_dim, v_dim_unit, v_waste
      FROM public.component_sheets cs
      WHERE cs.group_id = v_group_id
        AND GREATEST(COALESCE(cs.dimensions_width,0), COALESCE(cs.dimensions_length,0)) > 0
      LIMIT 1;
  END IF;
  v_waste := COALESCE(v_waste, 8);
  v_prod_unit := LOWER(v_prod_unit);
  v_is_linear := v_prod_unit IN ('m','meters','metros','mt','cm','m linear');
  IF v_is_linear THEN
    IF v_dim IS NOT NULL AND v_dim > 0 THEN
      IF LOWER(v_dim_unit) = 'cm' THEN v_dim := v_dim * 10;
      ELSIF LOWER(v_dim_unit) = 'm' THEN v_dim := v_dim * 1000; END IF;
      dm2_per_unit := v_dim / 10;
      IF v_prod_unit = 'cm' THEN dm2_per_unit := dm2_per_unit / 100; END IF;
      conversion_warning := NULL;
    ELSE
      dm2_per_unit := 1;
      SELECT EXISTS (SELECT 1 FROM public.component_sheets cs
                     WHERE cs.product_id = p_product_id OR cs.group_id = v_group_id)
        INTO v_has_cs;
      IF v_has_cs THEN
        conversion_warning := 'Material em "' || v_prod_unit || '" sem dimensions_width em component_sheets. '
          'Resultado pode estar 100x errado. Configurar largura em Materiais > Ficha de Componente.';
      ELSE
        conversion_warning := NULL;  -- item linear direto (tira/elástico), não converte
      END IF;
    END IF;
  ELSE
    dm2_per_unit := 1;
    conversion_warning := NULL;
  END IF;
  waste_pct := v_waste;
  target_unit := v_prod_unit;
  RETURN NEXT;
END;
$function$;
