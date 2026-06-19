-- ============================================================================
-- P0.3 — get_material_conversion_info: usar GREATEST(width, length) (paridade TS)
-- ============================================================================
-- Auditoria 2026-06-19: 25 component_sheets de material LINEAR têm largura×
-- comprimento TROCADOS (1000×1370). A largura real da bobina é 1370. O SQL usava
-- só dimensions_width=1000 → divisor 100; o TS (materialConsumption.ts) usa
-- max(width,length)=1370 → divisor 137. Logo o SQL SUPERESTIMAVA ~37% o consumo/
-- custo/compra de NAPA ONÇA + GLOW METALIC (custeio, MRP e ondas).
--
-- Fix: a função passa a usar GREATEST(dimensions_width, dimensions_length) — a
-- MESMA regra do TS. É SEGURO: a maior dimensão linear cadastrada é sempre a
-- largura da bobina (≤1500mm); o comprimento de 40m do rolo NÃO é cadastrado em
-- component_sheets (verificado: máximo é 1500). Assim SQL e TS convergem por
-- construção, e qualquer troca futura de campo deixa de causar a divergência.
--
-- As 22 "Tira Overlock 5mm" do mesmo set (1000×1370) são linear-direto e NÃO
-- entram em sheet_materials nem como material de ficha (verificado), então não
-- passam por esta função — GREATEST é inócuo pra elas.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_material_conversion_info(p_product_id uuid)
 RETURNS TABLE(dm2_per_unit numeric, waste_pct numeric, target_unit text, conversion_warning text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_width numeric;
  v_length numeric;
  v_dim numeric;
  v_dim_unit text;
  v_prod_unit text;
  v_waste numeric;
  v_group_id uuid;
  v_is_linear boolean;
BEGIN
  SELECT unit, group_id INTO v_prod_unit, v_group_id
  FROM public.products WHERE id = p_product_id;

  SELECT dimensions_width, dimensions_length, dimensions_unit, cs.waste_pct
    INTO v_width, v_length, v_dim_unit, v_waste
    FROM public.component_sheets cs
    WHERE cs.product_id = p_product_id;

  -- maior dimensão = largura da bobina (espelha max(width,length) do TS)
  v_dim := GREATEST(COALESCE(v_width, 0), COALESCE(v_length, 0));

  IF v_dim <= 0 THEN
    SELECT GREATEST(COALESCE(cs.dimensions_width, 0), COALESCE(cs.dimensions_length, 0)),
           cs.dimensions_unit, COALESCE(v_waste, cs.waste_pct)
      INTO v_dim, v_dim_unit, v_waste
      FROM public.component_sheets cs
      WHERE cs.group_id = v_group_id
        AND GREATEST(COALESCE(cs.dimensions_width, 0), COALESCE(cs.dimensions_length, 0)) > 0
      LIMIT 1;
  END IF;

  v_waste := COALESCE(v_waste, 8);
  v_prod_unit := LOWER(v_prod_unit);
  v_is_linear := v_prod_unit IN ('m','meters','metros','mt','cm');

  IF v_is_linear THEN
    IF v_dim IS NOT NULL AND v_dim > 0 THEN
      IF LOWER(v_dim_unit) = 'cm' THEN v_dim := v_dim * 10;
      ELSIF LOWER(v_dim_unit) = 'm' THEN v_dim := v_dim * 1000;
      END IF;
      dm2_per_unit := v_dim / 10;
      IF v_prod_unit = 'cm' THEN dm2_per_unit := dm2_per_unit / 100; END IF;
      conversion_warning := NULL;
    ELSE
      dm2_per_unit := 1;
      conversion_warning :=
        'Material em "' || v_prod_unit || '" sem dimensions_width em component_sheets. '
        'Resultado pode estar 100x errado. Configurar largura em Materiais > '
        'Ficha de Componente.';
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
