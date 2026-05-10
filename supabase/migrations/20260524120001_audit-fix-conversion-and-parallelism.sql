-- =============================================================================
-- Auditoria-fix: bugs reais identificados pela auditoria de 4 áreas
-- =============================================================================
-- Dos 35 achados, 33 foram falsos positivos (agentes Explore inferiram bugs
-- sem ler o estado atual do código). 2 bugs reais:
--
--   #4 — Frontend `sectorCapacity.ts` calculava cascata SEQUENCIAL mas
--        compute_wave_timeline (PR 3) é PARALELO. Datas divergiam entre
--        UI e relatório do server. → JÁ CORRIGIDO no frontend
--        (sectorCapacity.ts + leadTime.ts).
--
--   #9 — `get_material_conversion_info` retorna `dm2_per_unit=1` em silêncio
--        quando produto é linear (m, cm) mas `dimensions_width` não foi
--        configurado em component_sheets. UI então mostra valor em "metros"
--        que na verdade é dm² (~100× errado se largura típica 1.4m).
--        Esta migration adiciona warning + função diagnóstica.
-- =============================================================================

-- ─── Adiciona warning quando dm2_per_unit cai no fallback ──────────────────
-- A função AGORA retorna um conversion_warning (text nullable) que a UI/RPC
-- consumidora pode exibir. Mantém compatibilidade — colunas pré-existentes
-- (dm2_per_unit, waste_pct, target_unit) continuam idênticas.
DROP FUNCTION IF EXISTS public.get_material_conversion_info(p_product_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.get_material_conversion_info(p_product_id uuid)
RETURNS TABLE (
  dm2_per_unit numeric,
  waste_pct numeric,
  target_unit text,
  conversion_warning text
) AS $$
DECLARE
  v_width numeric;
  v_dim_unit text;
  v_prod_unit text;
  v_waste numeric;
  v_group_id uuid;
  v_is_linear boolean;
BEGIN
  SELECT unit, group_id INTO v_prod_unit, v_group_id
  FROM products WHERE id = p_product_id;

  SELECT dimensions_width, dimensions_unit, cs.waste_pct
    INTO v_width, v_dim_unit, v_waste
    FROM component_sheets cs
    WHERE cs.product_id = p_product_id;

  IF v_width IS NULL OR v_width <= 0 THEN
    SELECT cs.dimensions_width, cs.dimensions_unit, COALESCE(v_waste, cs.waste_pct)
      INTO v_width, v_dim_unit, v_waste
      FROM component_sheets cs
      WHERE cs.group_id = v_group_id AND cs.dimensions_width > 0
      LIMIT 1;
  END IF;

  v_waste := COALESCE(v_waste, 8);
  v_prod_unit := LOWER(v_prod_unit);
  v_is_linear := v_prod_unit IN ('m','meters','metros','mt','cm');

  IF v_is_linear THEN
    IF v_width IS NOT NULL AND v_width > 0 THEN
      IF LOWER(v_dim_unit) = 'cm' THEN v_width := v_width * 10;
      ELSIF LOWER(v_dim_unit) = 'm' THEN v_width := v_width * 1000;
      END IF;
      dm2_per_unit := v_width / 10;
      IF v_prod_unit = 'cm' THEN dm2_per_unit := dm2_per_unit / 100; END IF;
      conversion_warning := NULL;
    ELSE
      -- Fallback: produto é linear mas não tem largura cadastrada.
      -- Resultado: cálculo trata 1 dm² = 1 metro (errado por ~100× pra
      -- larguras típicas de 1.4m). UI mostra valor em "metros" que é dm².
      dm2_per_unit := 1;
      conversion_warning :=
        'Material em "' || v_prod_unit || '" sem dimensions_width em component_sheets. '
        'Resultado pode estar 100× errado. Configurar largura em Materiais > '
        'Ficha de Componente.';
    END IF;
  ELSE
    -- Não-linear (kg, g, un, par): nenhuma conversão dm²→linear faz sentido.
    -- dm2_per_unit=1 significa "valor já está na unidade correta". Sem warn.
    dm2_per_unit := 1;
    conversion_warning := NULL;
  END IF;

  waste_pct := v_waste;
  target_unit := v_prod_unit;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_material_conversion_info(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_material_conversion_info(uuid) IS
  'Retorna fator de conversão dm² → unidade do produto + waste_pct. '
  'Quando o produto é LINEAR (m/cm) mas dimensions_width não foi configurada '
  'em component_sheets, retorna dm2_per_unit=1 + conversion_warning não-NULL '
  'pra UI alertar (sem warn é silencioso e gera erro 100×).';


-- ─── Diagnóstico: lista produtos lineares sem largura configurada ──────────
-- UI em /diagnostics ou TechnicalSheets pode mostrar essa lista pra admin
-- corrigir manualmente.
DROP FUNCTION IF EXISTS public.list_materials_missing_width();
CREATE OR REPLACE FUNCTION public.list_materials_missing_width()
RETURNS TABLE (
  product_id uuid,
  product_name text,
  product_unit text,
  group_name text,
  has_component_sheet boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id           AS product_id,
    p.name         AS product_name,
    p.unit         AS product_unit,
    pg.name        AS group_name,
    EXISTS (
      SELECT 1 FROM component_sheets cs
      WHERE cs.product_id = p.id OR cs.group_id = p.group_id
    )              AS has_component_sheet
  FROM products p
  LEFT JOIN product_groups pg ON pg.id = p.group_id
  WHERE p.active = true
    AND LOWER(p.unit) IN ('m','meters','metros','mt','cm')
    AND NOT EXISTS (
      SELECT 1 FROM component_sheets cs
      WHERE (cs.product_id = p.id OR cs.group_id = p.group_id)
        AND COALESCE(cs.dimensions_width, 0) > 0
    )
  ORDER BY pg.name NULLS LAST, p.name;
$$;

GRANT EXECUTE ON FUNCTION public.list_materials_missing_width() TO authenticated;

COMMENT ON FUNCTION public.list_materials_missing_width() IS
  'Diagnóstico: lista materiais lineares (m/cm) sem dimensions_width em '
  'component_sheets. Esses produtos têm cálculo de consumo silenciosamente '
  'errado (100×). Corrigir cadastrando largura em Materiais > Componentes.';
