-- =============================================================================
-- AUDIT ROUND 17 — Solado como driver primário de consumo
-- =============================================================================
-- User: "O motor definidor da maioria dos consumos é o solado, praticamente
--        todo o restante das variações de referência mudam poucas coisas.
--        Tudo deve gerar em torno disso."
--
-- Realidade descoberta:
--   - 8 fichas com sole_drives_consumption=true
--   - 0 solados com specs preenchidas (sole_technical_specs)
--   - 1 solado fachetado, 0 com fachete cadastrado
--   - Resultado: fichas "sole_driven" caem em fallback escalar da ficha
--     (que está vazio), gerando consumo=0 e custo otimista.
--
-- Fixes:
--   1. Refatorar v_technical_sheets_audit pra considerar solado como driver:
--      - Forro/palmilha: gap só se NÃO sole_driven OU solado sem specs
--      - Nova flag: sole_driven_but_specs_missing (quando ficha confia no
--        solado mas solado não tem specs preenchidas)
--   2. Nova view v_soles_audit: lista cada solado em uso e status das specs
--      (forro/palmilha/fachete por tamanho).
-- =============================================================================

-- ─── 1. Refatoração da v_technical_sheets_audit ───────────────────────────

CREATE OR REPLACE VIEW public.v_technical_sheets_audit AS
WITH sheet_solados AS (
  -- Solado(s) usados por cada ficha (via mapping cor -> sole_product_id)
  SELECT DISTINCT tsc.sheet_id, tsc.sole_product_id
    FROM technical_sheet_sole_colors tsc
   WHERE tsc.sole_product_id IS NOT NULL
),
sole_has_specs AS (
  -- Por ficha: o(s) solado(s) tem specs de forro? palmilha? fachete?
  SELECT
    s.sheet_id,
    bool_or(EXISTS (
      SELECT 1 FROM sole_technical_specs sts
       WHERE sts.sole_id = s.sole_product_id
         AND COALESCE(sts.lining_consumption_dm2, 0) > 0
    )) AS sole_has_lining_specs,
    bool_or(EXISTS (
      SELECT 1 FROM sole_technical_specs sts
       WHERE sts.sole_id = s.sole_product_id
         AND COALESCE(sts.insole_consumption_dm2, 0) > 0
    )) AS sole_has_insole_specs,
    bool_or(EXISTS (
      SELECT 1 FROM products p
       WHERE p.id = s.sole_product_id AND COALESCE(p.is_fachetado, false) = true
    )) AS sole_is_fachetado,
    bool_or(EXISTS (
      SELECT 1 FROM sole_technical_specs sts
       WHERE sts.sole_id = s.sole_product_id
         AND COALESCE(sts.fachete_lining_consumption_dm2, 0) > 0
    )) AS sole_has_fachete_specs
  FROM sheet_solados s
  GROUP BY s.sheet_id
)
SELECT
  ts.id,
  ts.code,
  ts.name,
  ts.status,
  COALESCE(ts.sole_drives_consumption, false) AS sole_drives_consumption,

  -- ── Cabedal (sempre da ficha — solado não dirige cabedal) ──
  COALESCE(ts.upper_material, '') = '' AS missing_upper_material,
  (COALESCE(ts.upper_consumption, 0) <= 0
    AND (ts.upper_consumption_per_size IS NULL OR ts.upper_consumption_per_size = '{}'::jsonb)) AS missing_upper_consumption,

  -- ── Forro: gap se não tem ficha E (não sole_driven OU solado sem specs) ──
  COALESCE(ts.lining_material, '') = '' AS missing_lining_material,
  (COALESCE(ts.lining_consumption, 0) <= 0
    AND (ts.lining_consumption_per_size IS NULL OR ts.lining_consumption_per_size = '{}'::jsonb)
    AND (
      NOT COALESCE(ts.sole_drives_consumption, false)
      OR NOT COALESCE(shs.sole_has_lining_specs, false)
    )
  ) AS missing_lining_consumption,

  -- ── Palmilha ──
  COALESCE(ts.insole_material, '') = '' AS missing_insole_material,
  (COALESCE(ts.insole_consumption, 0) <= 0
    AND (ts.insole_consumption_per_size IS NULL OR ts.insole_consumption_per_size = '{}'::jsonb)
    AND (
      NOT COALESCE(ts.sole_drives_consumption, false)
      OR NOT COALESCE(shs.sole_has_insole_specs, false)
    )
  ) AS missing_insole_consumption,

  -- ── Solado ──
  COALESCE(ts.sole_material, '') = '' AS missing_sole_material,
  COALESCE(ts.sole_consumption, 0) <= 0 AS missing_sole_consumption,

  -- ── Mapeamento de cores do solado ──
  NOT EXISTS (SELECT 1 FROM technical_sheet_sole_colors WHERE sheet_id = ts.id) AS missing_sole_color_mapping,

  -- ── Fachetado sem fachete ──
  COALESCE(shs.sole_is_fachetado, false) = true
    AND NOT COALESCE(shs.sole_has_fachete_specs, false) AS sole_fachetado_sem_fachete,

  -- ── NEW: ficha sole_driven mas solado sem specs (root cause real) ──
  COALESCE(ts.sole_drives_consumption, false) = true
    AND (
      NOT COALESCE(shs.sole_has_lining_specs, false)
      OR NOT COALESCE(shs.sole_has_insole_specs, false)
    ) AS sole_driven_but_specs_missing,

  -- ── Tiras ──
  COALESCE(ts.has_straps, false) = true
    AND (ts.strap_colors IS NULL OR jsonb_array_length(ts.strap_colors) = 0) AS straps_without_colors,
  COALESCE(ts.has_straps, false) = true
    AND ts.strap_colors IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(ts.strap_colors) s
      WHERE COALESCE(s ->> 'group_id', '') = ''
    ) AS straps_without_group,

  -- ── MOD ──
  NOT EXISTS (SELECT 1 FROM technical_sheet_operations WHERE sheet_id = ts.id) AS missing_mod,

  -- ── Cabedal per-size parcial ──
  (ts.upper_consumption_per_size IS NOT NULL
    AND jsonb_typeof(ts.upper_consumption_per_size) = 'object'
    AND ts.upper_consumption_per_size != '{}'::jsonb
    AND COALESCE(ts.upper_consumption, 0) <= 0
    AND (SELECT COUNT(*) FROM jsonb_each_text(ts.upper_consumption_per_size) WHERE value::numeric > 0) < 5
  ) AS upper_per_size_partial_no_fallback,

  ts.updated_at,
  ts.created_at
FROM technical_sheets ts
LEFT JOIN sole_has_specs shs ON shs.sheet_id = ts.id;

GRANT SELECT ON public.v_technical_sheets_audit TO authenticated;


-- ─── 2. View nova: auditoria de solados ───────────────────────────────────

CREATE OR REPLACE VIEW public.v_soles_audit AS
WITH soles_in_use AS (
  -- Solados que estão sendo usados em alguma ficha
  SELECT DISTINCT
    p.id AS sole_id,
    p.name AS sole_name,
    p.color AS sole_color,
    p.sku AS sole_sku,
    p.unit_price,
    COALESCE(p.is_fachetado, false) AS is_fachetado,
    -- Quantas fichas usam este solado
    (SELECT COUNT(DISTINCT sheet_id) FROM technical_sheet_sole_colors WHERE sole_product_id = p.id) AS sheets_using
  FROM products p
  WHERE p.id IN (
    SELECT sole_product_id FROM technical_sheet_sole_colors WHERE sole_product_id IS NOT NULL
  )
)
SELECT
  s.sole_id,
  s.sole_name,
  s.sole_color,
  s.sole_sku,
  s.unit_price,
  s.is_fachetado,
  s.sheets_using,
  -- Quantos tamanhos têm specs
  COALESCE((SELECT COUNT(*) FROM sole_technical_specs WHERE sole_id = s.sole_id), 0) AS sizes_with_specs_total,
  COALESCE((SELECT COUNT(*) FROM sole_technical_specs WHERE sole_id = s.sole_id AND lining_consumption_dm2 > 0), 0) AS sizes_with_lining,
  COALESCE((SELECT COUNT(*) FROM sole_technical_specs WHERE sole_id = s.sole_id AND insole_consumption_dm2 > 0), 0) AS sizes_with_insole,
  COALESCE((SELECT COUNT(*) FROM sole_technical_specs WHERE sole_id = s.sole_id AND fachete_lining_consumption_dm2 > 0), 0) AS sizes_with_fachete,
  -- Flags de gaps
  NOT EXISTS (SELECT 1 FROM sole_technical_specs WHERE sole_id = s.sole_id AND lining_consumption_dm2 > 0) AS missing_lining_specs,
  NOT EXISTS (SELECT 1 FROM sole_technical_specs WHERE sole_id = s.sole_id AND insole_consumption_dm2 > 0) AS missing_insole_specs,
  s.is_fachetado AND NOT EXISTS (
    SELECT 1 FROM sole_technical_specs WHERE sole_id = s.sole_id AND fachete_lining_consumption_dm2 > 0
  ) AS fachetado_missing_fachete_specs,
  -- Solados que dirigem fichas (sole_drives_consumption=true) E não têm specs
  EXISTS (
    SELECT 1 FROM technical_sheet_sole_colors tsc
    JOIN technical_sheets ts ON ts.id = tsc.sheet_id
    WHERE tsc.sole_product_id = s.sole_id
      AND COALESCE(ts.sole_drives_consumption, false) = true
  ) AND COALESCE((SELECT COUNT(*) FROM sole_technical_specs WHERE sole_id = s.sole_id AND (lining_consumption_dm2 > 0 OR insole_consumption_dm2 > 0)), 0) = 0 AS drives_consumption_but_no_specs
FROM soles_in_use s;

GRANT SELECT ON public.v_soles_audit TO authenticated;

COMMENT ON VIEW public.v_soles_audit IS
  'Auditoria de solados em uso. Mostra quantos tamanhos têm specs cadastradas '
  'e flags pra solados que dirigem consumo (sole_drives_consumption) mas não '
  'tem dados — root cause das fichas com consumo aparentemente faltando.';


-- ─── 3. Atualizar resumo agregado ─────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_technical_sheets_audit_summary AS
SELECT
  COUNT(*) AS total_fichas,
  COUNT(*) FILTER (WHERE missing_upper_material) AS sem_grupo_cabedal,
  COUNT(*) FILTER (WHERE missing_upper_consumption) AS sem_consumo_cabedal,
  COUNT(*) FILTER (WHERE missing_lining_material) AS sem_grupo_forro,
  COUNT(*) FILTER (WHERE missing_lining_consumption) AS sem_consumo_forro,
  COUNT(*) FILTER (WHERE missing_insole_material) AS sem_grupo_palmilha,
  COUNT(*) FILTER (WHERE missing_insole_consumption) AS sem_consumo_palmilha,
  COUNT(*) FILTER (WHERE missing_sole_material) AS sem_grupo_solado,
  COUNT(*) FILTER (WHERE missing_sole_consumption) AS sem_consumo_solado,
  COUNT(*) FILTER (WHERE missing_sole_color_mapping) AS sem_cores_solado,
  COUNT(*) FILTER (WHERE sole_fachetado_sem_fachete) AS fachetado_sem_fachete,
  COUNT(*) FILTER (WHERE sole_driven_but_specs_missing) AS sole_driven_sem_specs,
  COUNT(*) FILTER (WHERE straps_without_colors) AS tiras_sem_cores,
  COUNT(*) FILTER (WHERE straps_without_group) AS tiras_sem_grupo,
  COUNT(*) FILTER (WHERE missing_mod) AS sem_mod_cadastrado,
  COUNT(*) FILTER (WHERE upper_per_size_partial_no_fallback) AS upper_per_size_parcial,
  COUNT(*) FILTER (WHERE sole_drives_consumption) AS fichas_sole_driven,
  COUNT(*) FILTER (
    WHERE NOT missing_upper_material AND NOT missing_upper_consumption
      AND NOT missing_lining_material AND NOT missing_lining_consumption
      AND NOT missing_insole_material AND NOT missing_insole_consumption
      AND NOT missing_sole_material AND NOT missing_sole_consumption
      AND NOT missing_sole_color_mapping
      AND NOT sole_fachetado_sem_fachete
      AND NOT sole_driven_but_specs_missing
      AND NOT straps_without_colors AND NOT straps_without_group
      AND NOT missing_mod
      AND NOT upper_per_size_partial_no_fallback
  ) AS fichas_100_completas
FROM v_technical_sheets_audit;

GRANT SELECT ON public.v_technical_sheets_audit_summary TO authenticated;
