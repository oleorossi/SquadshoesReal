-- =============================================================================
-- Variante de material por GRUPO (napa) — colunas de grupo por componente
-- =============================================================================
--
-- Antes: a variante apontava um PRODUTO individual por componente
--   (upper_material_product_id / lining_material_product_id / insole_material_product_id).
--   Escolher "outra napa" exigia fixar um produto numa cor específica.
--
-- Agora: a variante aponta um GRUPO (product_groups) por componente
--   (Cabedal / Forro / Palmilha). A COR vem do PV; o produto é resolvido por
--   grupo + cor no motor (resolve_*_material_for_variant — mig 20260907120500).
--   Solado sempre herda a ficha (fora do escopo — sem coluna de grupo).
--
-- INVARIANTE: a área (dm²/par) permanece a da ficha técnica. A variante só troca
-- a ORIGEM do material; o valor final (metros/custo) sai da largura da ficha de
-- componente + preço do grupo. Nenhuma coluna de consumo é alterada aqui.
--
-- Esta migration é ADITIVA e não muda o comportamento de nenhuma função: as
-- colunas novas só passam a ser lidas pela migration 20260907120500.
-- =============================================================================

-- ── 1) Colunas de grupo (FK → product_groups, ON DELETE SET NULL) ────────────
-- SET NULL: se o grupo for excluído, a variante degrada para "herda a ficha"
-- (mesmo padrão dos pins de produto na technical_sheets).
ALTER TABLE public.reference_material_variants
  ADD COLUMN IF NOT EXISTS upper_material_group_id  uuid NULL REFERENCES public.product_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lining_material_group_id uuid NULL REFERENCES public.product_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS insole_material_group_id uuid NULL REFERENCES public.product_groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.reference_material_variants.upper_material_group_id  IS
  'Grupo de cabedal (napa) desta variacao. Resolve produto por grupo+cor do PV. NULL = herda a ficha. Precedencia: upper_material_product_id (legado) > este grupo > pin da ficha > grupo da ficha.';
COMMENT ON COLUMN public.reference_material_variants.lining_material_group_id IS
  'Grupo de forracao desta variacao. Resolve por grupo+cor do PV. NULL = herda a ficha.';
COMMENT ON COLUMN public.reference_material_variants.insole_material_group_id IS
  'Grupo de palmilha (forracao da palmilha) desta variacao. Resolve por grupo+cor do PV. NULL = herda a ficha.';

-- ── 2) Backfill: variante que apontava produto herda o grupo do produto ──────
-- Só para o dialog de edicao pre-selecionar o grupo. NAO muda resolucao de
-- consumo: a mig 20260907120500 mantem o produto legado (upper_material_product_id)
-- com PRECEDENCIA sobre o grupo, então variantes existentes continuam resolvendo
-- o MESMO produto/cor de antes (custeio/consumo inalterado).
UPDATE public.reference_material_variants v
   SET upper_material_group_id = p.group_id
  FROM public.products p
 WHERE p.id = v.upper_material_product_id
   AND v.upper_material_group_id IS NULL
   AND p.group_id IS NOT NULL;

UPDATE public.reference_material_variants v
   SET lining_material_group_id = p.group_id
  FROM public.products p
 WHERE p.id = v.lining_material_product_id
   AND v.lining_material_group_id IS NULL
   AND p.group_id IS NOT NULL;

UPDATE public.reference_material_variants v
   SET insole_material_group_id = p.group_id
  FROM public.products p
 WHERE p.id = v.insole_material_product_id
   AND v.insole_material_group_id IS NULL
   AND p.group_id IS NOT NULL;
