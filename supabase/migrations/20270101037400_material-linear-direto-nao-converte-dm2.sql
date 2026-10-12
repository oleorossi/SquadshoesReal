-- Material linear DIRETO não converte dm² — a largura da fita não é largura de bobina
-- =====================================================================================
-- Decisão do dono (12/10/2026), sobre ELÁSTICO ESPECIAL G no Cabedal:
--   "A largura da tira é de 25mm, e o material é vendido a metro. Só isso."
--   "É um material já pronto, com SKU próprio. Não é convertido através da napa."
--
-- O BUG
-- -----
-- `get_material_conversion_info` tratava QUALQUER `dimensions_width > 0` como largura
-- de BOBINA e devolvia `dm2_per_unit = largura_mm / 10`. Os 14 consumidores
-- (calculate_order_consumption_by_grade, calculate_order_cost_item,
-- check_stock_availability, get_wave_material_needs_core, record_order_consumption,
-- compute_materials_per_pv, fn_projected_demand, …) fazem `necessário ÷ dm2_per_unit`.
--
-- Para o ELÁSTICO ESPECIAL G (fita de 25 mm, SKU próprio comprado e estocado por
-- metro) isso dava `dm2_per_unit = 2,5` e o consumo de 1,37 m/par digitado na ficha
-- virava **0,548 m/par** — subdébito de 2,5× em consumo, reserva, débito, custeio e
-- compra. A fita não é cortada de napa: não há área a converter.
--
-- A REGRA
-- -------
-- O mesmo campo `dimensions_width` carrega dois significados, e só a ORDEM DE
-- GRANDEZA os separa:
--   >= 400 mm  largura do ROLO de onde a peça é cortada (napa/couro/forro:
--              1000–1370 mm) → consumo em dm²/par, converte (comportamento atual).
--   <  400 mm  largura da PRÓPRIA peça (elástico, tira: 5–25 mm) → material linear
--              direto, consumo já na unidade de estoque, `dm2_per_unit = 1`.
--
-- ⚠ É heurística, e é assim por falta de alternativa. Medido em 12/10/2026 nos 10
-- grupos usados como cabedal: `products.unit` ('m' nos dois), `consumption_unit`
-- ('m' nos dois), `calculation_method` ('weight' em 100%), `sector` ('Cabedal' nos
-- dois) e `is_artisanal_strap` (false em 100%) NÃO distinguem fita de bobina.
-- Larguras reais: bobina 1000–1370 mm, fita 25 mm — o piso tem folga de 2,5× pra
-- cada lado. Ao cadastrar uma bobina ESTREITA (< 400 mm), o caminho certo é trocar
-- isto por marcação explícita no grupo, NÃO baixar o piso.
--
-- ⚠ ESPELHO OBRIGATÓRIO: `ROLL_WIDTH_FLOOR_MM` / `isNativeLinearMaterial` em
-- src/lib/materialConsumption.ts. Mudar um lado sem o outro recria a divergência
-- TS×SQL que a auditoria de 2026-07-21 fechou.
--
-- ⚠ NÃO há backfill: os valores já gravados em `technical_sheets` ficam como estão
-- (specs/materiais-cabedal-por-posicao.md proíbe converter consumo cadastrado
-- automaticamente). Alcance medido: 1 ficha (ELÁSTICO ESPECIAL G) passa a debitar
-- 1,37 m/par em vez de 0,548 — que é o número que o dono cadastrou.
--
-- ⚠ As 26 fichas de TIRA OVERLOCK 5MM seguem cadastradas com 1370 mm (cadastro
-- copiado de napa, ver CLAUDE.md). O piso NÃO as muda: continuam como bobina,
-- exatamente como antes. Corrigir aquilo é decisão de cadastro, não deste arquivo.

CREATE OR REPLACE FUNCTION public.get_material_conversion_info(p_product_id uuid)
 RETURNS TABLE(dm2_per_unit numeric, target_unit text, conversion_warning text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  DECLARE
    v_width numeric; v_length numeric; v_dim numeric; v_dim_unit text;
    v_prod_unit text; v_group_id uuid; v_is_linear boolean;
    v_has_cs boolean; v_is_area boolean;
    -- Piso de largura de BOBINA. Espelha ROLL_WIDTH_FLOOR_MM (TS).
    c_roll_width_floor_mm CONSTANT numeric := 400;
  BEGIN
    SELECT unit, group_id INTO v_prod_unit, v_group_id FROM public.products WHERE id = p_product_id;
    SELECT dimensions_width, dimensions_length, dimensions_unit
      INTO v_width, v_length, v_dim_unit
      FROM public.component_sheets cs WHERE cs.product_id = p_product_id;
    v_dim := COALESCE(NULLIF(v_width, 0), NULLIF(v_length, 0), 0);
    IF v_dim <= 0 THEN
      SELECT COALESCE(NULLIF(cs.dimensions_width, 0), NULLIF(cs.dimensions_length, 0)), cs.dimensions_unit
        INTO v_dim, v_dim_unit
        FROM public.component_sheets cs
        WHERE cs.group_id = v_group_id
          AND COALESCE(NULLIF(cs.dimensions_width, 0), NULLIF(cs.dimensions_length, 0)) > 0
        ORDER BY (COALESCE(cs.dimensions_width, 0) > 0) DESC, cs.updated_at DESC NULLS LAST, cs.id
        LIMIT 1;
    END IF;
    v_prod_unit := LOWER(v_prod_unit);
    v_is_linear := v_prod_unit IN ('m','meters','metros','mt','cm','m linear');
    IF v_is_linear THEN
      IF v_dim IS NOT NULL AND v_dim > 0 THEN
        IF LOWER(v_dim_unit) = 'cm' THEN v_dim := v_dim * 10;
        ELSIF LOWER(v_dim_unit) = 'dm' THEN v_dim := v_dim * 100;
        ELSIF LOWER(v_dim_unit) = 'm' THEN v_dim := v_dim * 1000; END IF;

        IF v_dim < c_roll_width_floor_mm THEN
          -- Item linear DIRETO (fita/elástico): a largura cadastrada é a da PRÓPRIA
          -- peça, não a de um rolo. O valor da ficha já está na unidade de estoque.
          dm2_per_unit := 1;
          conversion_warning := NULL;
        ELSE
          dm2_per_unit := v_dim / 10;
          IF v_prod_unit = 'cm' THEN dm2_per_unit := dm2_per_unit / 100; END IF;
          conversion_warning := NULL;
        END IF;
      ELSE
        dm2_per_unit := 1;
        SELECT EXISTS (SELECT 1 FROM public.component_sheets cs
                       WHERE cs.product_id = p_product_id OR cs.group_id = v_group_id) INTO v_has_cs;
        SELECT EXISTS (
          SELECT 1 FROM public.product_groups pg
           WHERE pg.id = v_group_id
             AND (pg.sector IN ('Cabedal', 'Palmilha', 'Forração da Palmilha')
                  OR EXISTS (SELECT 1 FROM public.technical_sheets ts
                              WHERE UPPER(TRIM(ts.upper_material))  = UPPER(TRIM(pg.name))
                                 OR UPPER(TRIM(ts.lining_material)) = UPPER(TRIM(pg.name))
                                 OR UPPER(TRIM(ts.insole_material)) = UPPER(TRIM(pg.name))))
        ) INTO v_is_area;
        IF v_has_cs OR v_is_area THEN
          conversion_warning := 'Material em "' || v_prod_unit || '" sem dimensions_width em component_sheets. '
            'Resultado pode estar 100x errado. Configurar largura em Materiais > Ficha de Componente.';
        ELSE
          conversion_warning := NULL;
        END IF;
      END IF;
    ELSE
      dm2_per_unit := 1;
      conversion_warning := NULL;
    END IF;
    target_unit := v_prod_unit;
    RETURN NEXT;
  END;
  $function$;

COMMENT ON FUNCTION public.get_material_conversion_info(uuid) IS
  'Fator dm²→unidade de estoque. Largura >= 400mm = bobina (converte); < 400mm = '
  'largura da própria peça, material linear direto (dm2_per_unit=1, não converte). '
  'Espelha ROLL_WIDTH_FLOOR_MM em src/lib/materialConsumption.ts — mudar junto.';
