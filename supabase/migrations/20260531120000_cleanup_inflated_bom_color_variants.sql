-- =============================================================================
-- CLEANUP: BOM inflado por variantes-cor duplicadas (2026-05-31)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-31.
--
-- Reportado: várias fichas técnicas têm BOM (sheet_materials) com TODAS as
-- variantes-cor de cada grupo, gerando custo inflado.
--
-- Diagnóstico (pré-cleanup):
--   5 fichas (CF 03, CF 05, CF 07, CF 09, ST 10) com 76 itens IDÊNTICOS cada
--   e custo R$ 546,52 — bulk insert/clone que copiou catálogo inteiro.
--   Casos: TIRA OVERLOCK 5MM em 21 cores, TIRA CHATA 11MM em 10, TRANÇA em 8,
--   LINHANYL em 6. Nenhuma ficha "saudável" tem >4 cores do mesmo grupo no BOM.
--
-- Regra de cleanup (threshold conservador):
--   Para cada (sheet_id, group_id) com ≥ 5 variantes-cor:
--     - MANTER o produto mais barato (unit_price ASC) — provável "principal"
--     - DELETAR as outras variantes
--   Combos com ≤ 4 variantes ficam INTACTOS (caso legítimo de ficha multi-cor).
--
-- Resultado:
--   - 225 itens removidos
--   - 5 fichas: 76 → 31 itens cada
--   - Custo: R$ 546,52 → R$ 153,98 (-71%)
--
-- Auditoria: sheet_materials_cleanup_log preserva snapshot do que foi removido.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sheet_materials_cleanup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL,
  sheet_code text,
  sheet_name text,
  product_id uuid NOT NULL,
  product_name text,
  product_color text,
  group_name text,
  unit_price numeric,
  quantity_per_unit numeric,
  reason text NOT NULL,
  cleaned_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sheet_materials_cleanup_log IS
  'Auditoria de sheet_materials removidos por limpeza automática (2026-05-31). Read-only pra rastreabilidade.';

-- Cleanup já foi aplicado em 2026-05-31 via MCP. Este script é idempotente:
-- só reexecuta se ainda existirem combos com ≥5 variantes (não vai duplicar
-- registros no log porque WHERE NOT EXISTS no INSERT).

WITH bom_ranked AS (
  SELECT
    sm.id AS sm_id, sm.sheet_id,
    ts.code AS sheet_code, ts.name AS sheet_name,
    p.id AS product_id, p.name AS product_name, p.color AS product_color,
    pg.name AS group_name,
    p.unit_price, sm.quantity_per_unit,
    ROW_NUMBER() OVER (
      PARTITION BY sm.sheet_id, p.group_id
      ORDER BY COALESCE(p.unit_price, 0) ASC, p.id ASC
    ) AS rank_in_group,
    COUNT(*) OVER (PARTITION BY sm.sheet_id, p.group_id) AS group_size
  FROM public.sheet_materials sm
  JOIN public.products p ON p.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = p.group_id
  LEFT JOIN public.technical_sheets ts ON ts.id = sm.sheet_id
  WHERE p.group_id IS NOT NULL
),
to_delete AS (
  SELECT * FROM bom_ranked WHERE group_size >= 5 AND rank_in_group > 1
)
INSERT INTO public.sheet_materials_cleanup_log
  (sheet_id, sheet_code, sheet_name, product_id, product_name, product_color, group_name, unit_price, quantity_per_unit, reason)
SELECT
  sheet_id, sheet_code, sheet_name, product_id, product_name, product_color,
  group_name, unit_price, quantity_per_unit,
  'bom_inflated_color_variants_2026_05_31'
FROM to_delete
WHERE NOT EXISTS (
  SELECT 1 FROM public.sheet_materials_cleanup_log existing
  WHERE existing.sheet_id = to_delete.sheet_id
    AND existing.product_id = to_delete.product_id
    AND existing.reason = 'bom_inflated_color_variants_2026_05_31'
);

DELETE FROM public.sheet_materials sm
WHERE sm.id IN (
  SELECT sm_id FROM (
    SELECT
      sm.id AS sm_id,
      ROW_NUMBER() OVER (
        PARTITION BY sm.sheet_id, p.group_id
        ORDER BY COALESCE(p.unit_price, 0) ASC, p.id ASC
      ) AS rank_in_group,
      COUNT(*) OVER (PARTITION BY sm.sheet_id, p.group_id) AS group_size
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
    WHERE p.group_id IS NOT NULL
  ) ranked
  WHERE ranked.group_size >= 5 AND ranked.rank_in_group > 1
);
