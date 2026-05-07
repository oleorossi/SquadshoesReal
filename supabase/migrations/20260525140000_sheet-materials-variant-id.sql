-- =============================================================================
-- BOM por variante de material (Frente 4 — Pessoas → Engenharia)
-- =============================================================================
-- ANTES: `sheet_materials` só vincula um material à ficha técnica como um todo.
-- Quando a mesma referência tinha 3 variações de cabedal (Paso Napa, Santorini,
-- Metálica), o usuário criava 3 fichas técnicas duplicadas pra ter BOMs
-- diferentes. Resultado: Sale Order vê 3× a ref no dropdown e o cálculo de
-- consumo é sempre o mesmo (ignorando variante).
--
-- AGORA:
--   #1 Coluna `material_variant_id UUID NULLABLE` em `sheet_materials`:
--      • NULL  → linha vale pra TODAS as variantes (BOM compartilhado, default).
--      • UUID  → linha específica daquela variante (override + adicional).
--   #2 Index pra lookup rápido por (sheet_id, material_variant_id).
--   #3 RPC `get_effective_bom(sheet_id, variant_id)` retorna o BOM efetivo
--      pra uma combinação ficha+variante (junta linhas compartilhadas + específicas).
--   #4 Função `calculate_order_consumption_by_variant()` wrapper que respeita
--      a variante na hora de somar materiais (futuro — quando precisar receitas
--      diferentes por variante).
--
-- IMPORTANTE — comportamento legado preservado:
--   • Linhas existentes em sheet_materials têm material_variant_id=NULL → continuam
--     servindo a todas as variantes (zero impacto em fichas atuais).
--   • Quem cadastrar variante específica do BOM ganha a flexibilidade nova.
-- =============================================================================

ALTER TABLE public.sheet_materials
  ADD COLUMN IF NOT EXISTS material_variant_id UUID
    REFERENCES public.reference_material_variants(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.sheet_materials.material_variant_id IS
  'Variante de material à qual esta linha de BOM se aplica. '
  'NULL = vale pra todas variantes (BOM compartilhado, default). '
  'UUID = override/adicional específico daquela variante. Ver Frente 4 / 20260525140000.';

CREATE INDEX IF NOT EXISTS idx_sheet_materials_variant
  ON public.sheet_materials(sheet_id, material_variant_id);

-- ─── #3 BOM efetivo pra (sheet, variant) ────────────────────────────────
-- Junta linhas compartilhadas (variant_id IS NULL) com específicas
-- (variant_id = X). Quando uma linha específica DUPLICA um product_id de
-- linha compartilhada, a ESPECÍFICA prevalece (override). Caso contrário,
-- a específica é ADICIONAL (somada à compartilhada).
DROP FUNCTION IF EXISTS public.get_effective_bom(uuid, uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.get_effective_bom(
  p_sheet_id uuid,
  p_variant_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  sheet_id uuid,
  product_id uuid,
  quantity_per_unit numeric,
  color text,
  width text,
  weight text,
  supplier text,
  notes text,
  sizes text,
  source text       -- 'shared' (variant_id IS NULL) | 'variant' (override)
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH bom_specific AS (
    SELECT sm.*,
           'variant'::text AS source
    FROM public.sheet_materials sm
    WHERE sm.sheet_id = p_sheet_id
      AND p_variant_id IS NOT NULL
      AND sm.material_variant_id = p_variant_id
  ),
  -- IDs de produtos cobertos pela variante específica (pra fazer override)
  variant_product_ids AS (
    SELECT product_id FROM bom_specific
  ),
  bom_shared AS (
    SELECT sm.*,
           'shared'::text AS source
    FROM public.sheet_materials sm
    WHERE sm.sheet_id = p_sheet_id
      AND sm.material_variant_id IS NULL
      AND (p_variant_id IS NULL OR sm.product_id NOT IN (SELECT product_id FROM variant_product_ids))
  )
  SELECT id, sheet_id, product_id, quantity_per_unit, color, width, weight, supplier, notes, sizes, source
  FROM bom_specific
  UNION ALL
  SELECT id, sheet_id, product_id, quantity_per_unit, color, width, weight, supplier, notes, sizes, source
  FROM bom_shared;
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_bom(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_effective_bom(uuid, uuid) IS
  'Retorna o BOM efetivo de uma (sheet_id, variant_id). Quando uma linha '
  'específica da variante repete um product_id de linha compartilhada, a '
  'específica PREVALECE (override). Senão é adicional. variant_id NULL = '
  'só compartilhadas (compatível com chamadas legadas).';

-- ─── #4 RPC pra Sale Order: lista variantes ATIVAS de uma ficha ─────────
-- Wrapper conveniente — UI hoje busca via reference_material_variants direto;
-- esta RPC adiciona o display_order + count de BOMs específicas pra mostrar
-- "quem tem receita própria" no dropdown.
DROP FUNCTION IF EXISTS public.list_active_material_variants(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.list_active_material_variants(p_sheet_id uuid)
RETURNS TABLE (
  id uuid,
  reference_id uuid,
  material_name text,
  sku text,
  active boolean,
  display_order int,
  has_specific_bom boolean,
  specific_bom_count int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    rmv.id,
    rmv.reference_id,
    rmv.material_name,
    rmv.sku,
    rmv.active,
    rmv.display_order,
    EXISTS (SELECT 1 FROM public.sheet_materials sm
            WHERE sm.sheet_id = p_sheet_id AND sm.material_variant_id = rmv.id) AS has_specific_bom,
    (SELECT COUNT(*) FROM public.sheet_materials sm
     WHERE sm.sheet_id = p_sheet_id AND sm.material_variant_id = rmv.id)::int AS specific_bom_count
  FROM public.reference_material_variants rmv
  WHERE rmv.reference_id = p_sheet_id
    AND rmv.active = true
  ORDER BY rmv.display_order, rmv.material_name;
$$;

GRANT EXECUTE ON FUNCTION public.list_active_material_variants(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_active_material_variants(uuid) IS
  'Lista variantes ativas de uma referência + flag has_specific_bom indicando '
  'se a variante tem BOM próprio (override) — útil pra UI exibir "★ recipe específica" '
  'no dropdown do PV.';
