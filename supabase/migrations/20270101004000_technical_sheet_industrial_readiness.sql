-- Fichas técnicas: prontidão industrial, vínculo de solado e auditoria por unidade.
--
-- Corrige a auditoria legada que tratava todo modelo como cabedal cortado,
-- exigia placa para palmilha pronta e só enxergava solados cadastrados na
-- tabela de cores da ficha. O motor de consumo já usa primary_sole_id como
-- fallback; a auditoria precisa enxergar a mesma fonte.

-- Repara fichas antigas criadas pela UI que salvava o nome/grupo do solado,
-- mas não persistia o UUID usado pelo motor de consumo. Dentro do grupo do
-- solado, prefere a variante com mais specs e depois a de maior estoque.
UPDATE public.technical_sheets ts
   SET primary_sole_id = COALESCE(
     (
       SELECT tsc.sole_product_id
         FROM public.technical_sheet_sole_colors tsc
        WHERE tsc.sheet_id = ts.id
          AND tsc.sole_product_id IS NOT NULL
        ORDER BY tsc.created_at DESC
        LIMIT 1
     ),
     (
       SELECT p.id
         FROM public.products p
        WHERE p.group_id = ts.sole_group_id
          AND p.active = true
          AND p.category ILIKE '%solado%'
        ORDER BY
          (SELECT COUNT(*) FROM public.sole_technical_specs sts WHERE sts.sole_id = p.id) DESC,
          COALESCE(p.quantity, 0) DESC,
          p.id
        LIMIT 1
     )
   )
 WHERE ts.primary_sole_id IS NULL
   AND ts.sole_group_id IS NOT NULL;

CREATE OR REPLACE VIEW public.v_technical_sheets_audit AS
WITH sheet_solados AS (
  SELECT ts.id AS sheet_id, ts.primary_sole_id AS sole_product_id
    FROM public.technical_sheets ts
   WHERE ts.primary_sole_id IS NOT NULL
  UNION
  SELECT tsc.sheet_id, tsc.sole_product_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sole_product_id IS NOT NULL
),
sole_profile AS (
  SELECT
    ss.sheet_id,
    bool_or(COALESCE(p.is_fachetado, false)) AS sole_is_fachetado,
    bool_or(p.fachete_material_group_id IS NOT NULL) AS sole_has_fachete_group,
    bool_or(EXISTS (
      SELECT 1 FROM public.sole_technical_specs sts
       WHERE sts.sole_id = ss.sole_product_id
         AND COALESCE(sts.lining_consumption_dm2, 0) > 0
    )) AS sole_has_lining_specs,
    bool_or(EXISTS (
      SELECT 1 FROM public.sole_technical_specs sts
       WHERE sts.sole_id = ss.sole_product_id
         AND COALESCE(sts.insole_consumption_dm2, 0) > 0
    )) AS sole_has_insole_specs,
    bool_or(EXISTS (
      SELECT 1 FROM public.sole_technical_specs sts
       WHERE sts.sole_id = ss.sole_product_id
         AND COALESCE(sts.fachete_lining_consumption_dm2, 0) > 0
    )) AS sole_has_fachete_specs
  FROM sheet_solados ss
  JOIN public.products p ON p.id = ss.sole_product_id
  GROUP BY ss.sheet_id
),
sheet_product_refs AS (
  SELECT sm.sheet_id, sm.product_id FROM public.sheet_materials sm
  UNION
  SELECT tcc.sheet_id, tcc.product_id FROM public.technical_sheet_component_colors tcc
  UNION
  SELECT ts.id, ts.upper_material_product_id FROM public.technical_sheets ts WHERE ts.upper_material_product_id IS NOT NULL
  UNION
  SELECT ts.id, ts.lining_material_product_id FROM public.technical_sheets ts WHERE ts.lining_material_product_id IS NOT NULL
  UNION
  SELECT ts.id, ts.primary_sole_id FROM public.technical_sheets ts WHERE ts.primary_sole_id IS NOT NULL
  UNION
  SELECT tsc.sheet_id, tsc.sole_product_id FROM public.technical_sheet_sole_colors tsc WHERE tsc.sole_product_id IS NOT NULL
  UNION
  SELECT ts.id, p.id
    FROM public.technical_sheets ts
    JOIN public.product_groups pg
      ON pg.name IN (ts.upper_material, ts.lining_material, ts.insole_material)
    JOIN public.products p ON p.group_id = pg.id AND p.active = true
  UNION
  SELECT ts.id, p.id
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ts.direct_components) = 'array' THEN ts.direct_components ELSE '[]'::jsonb END
    ) item
    JOIN public.products p ON p.id = CASE
      WHEN item->>'product_id' ~* '^[0-9a-f-]{36}$' THEN (item->>'product_id')::uuid
      ELSE NULL
    END
  UNION
  SELECT ts.id, p.id
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ts.components_accessories) = 'array' THEN ts.components_accessories ELSE '[]'::jsonb END
    ) item
    JOIN public.product_groups pg ON pg.name = item->>'material'
    JOIN public.products p ON p.group_id = pg.id AND p.active = true
  UNION
  SELECT ts.id, p.id
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ts.lining_accessories) = 'array' THEN ts.lining_accessories ELSE '[]'::jsonb END
    ) item
    JOIN public.product_groups pg ON pg.name = item->>'material'
    JOIN public.products p ON p.group_id = pg.id AND p.active = true
  UNION
  SELECT ts.id, p.id
    FROM public.technical_sheets ts
    JOIN public.sole_standard_materials ssm ON ssm.sole_group_id = ts.sole_group_id
    JOIN public.products p ON p.id = ssm.material_product_id
),
sheet_unit_health AS (
  SELECT
    spr.sheet_id,
    bool_or(
      p.unit IS NULL OR btrim(p.unit) = ''
      OR p.unit NOT IN ('m','cm','mm','m²','dm²','cm²','un','par','placa','kg','g','L','ml')
      OR p.purchase_order_unit IS NULL OR btrim(p.purchase_order_unit) = ''
      OR (
        lower(p.purchase_order_unit) = lower(p.unit)
        AND COALESCE(p.conversion_rate, 1) <> 1
      )
      OR (
        lower(p.purchase_order_unit) <> lower(p.unit)
        AND COALESCE(p.conversion_rate, 0) <= 0
      )
    ) AS unit_configuration_issue,
    bool_or(
      p.unit IN ('m', 'cm')
      AND pg.consumption_unit IN ('m²', 'dm²', 'cm²')
      AND NOT EXISTS (
        SELECT 1 FROM public.component_sheets cs
         WHERE cs.product_id = p.id
           AND COALESCE(cs.dimensions_width, 0) > 0
      )
    ) AS area_material_width_missing
  FROM sheet_product_refs spr
  JOIN public.products p ON p.id = spr.product_id
  LEFT JOIN public.product_groups pg ON pg.id = p.group_id
  GROUP BY spr.sheet_id
)
SELECT
  ts.id,
  ts.code,
  ts.name,
  ts.status,
  COALESCE(ts.sole_drives_consumption, false) AS sole_drives_consumption,

  NOT COALESCE(ts.has_straps, false)
    AND COALESCE(ts.upper_material, '') = '' AS missing_upper_material,
  NOT COALESCE(ts.has_straps, false)
    AND COALESCE(ts.upper_consumption, 0) <= 0
    AND (ts.upper_consumption_per_size IS NULL OR ts.upper_consumption_per_size = '{}'::jsonb)
    AS missing_upper_consumption,

  (
    COALESCE(ts.lining_material, '') = ''
    AND (
      COALESCE(ts.lining_consumption, 0) > 0
      OR (ts.lining_consumption_per_size IS NOT NULL AND ts.lining_consumption_per_size <> '{}'::jsonb)
      OR (COALESCE(ts.sole_drives_consumption, false) AND COALESCE(sp.sole_has_lining_specs, false))
    )
  ) AS missing_lining_material,
  (
    COALESCE(ts.lining_material, '') <> ''
    AND COALESCE(ts.lining_consumption, 0) <= 0
    AND (ts.lining_consumption_per_size IS NULL OR ts.lining_consumption_per_size = '{}'::jsonb)
    AND (NOT COALESCE(ts.sole_drives_consumption, false) OR NOT COALESCE(sp.sole_has_lining_specs, false))
  ) AS missing_lining_consumption,

  NOT COALESCE(ts.insole_ready_made, false)
    AND COALESCE(ts.insole_material, '') = '' AS missing_insole_material,
  NOT COALESCE(ts.insole_ready_made, false)
    AND COALESCE(ts.insole_consumption, 0) <= 0
    AND (ts.insole_consumption_per_size IS NULL OR ts.insole_consumption_per_size = '{}'::jsonb)
    AND (NOT COALESCE(ts.sole_drives_consumption, false) OR NOT COALESCE(sp.sole_has_insole_specs, false))
    AS missing_insole_consumption,

  COALESCE(ts.sole_material, '') = '' AS missing_sole_material,
  COALESCE(ts.sole_consumption, 0) <= 0 AS missing_sole_consumption,

  NOT EXISTS (
    SELECT 1 FROM public.technical_sheet_sole_colors tsc WHERE tsc.sheet_id = ts.id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.sole_color_conjugations scc
     WHERE scc.sole_group_id = ts.sole_group_id AND scc.active = true
  ) AS missing_sole_color_mapping,

  COALESCE(sp.sole_is_fachetado, false)
    AND (
      (NOT COALESCE(sp.sole_has_fachete_group, false) AND COALESCE(ts.lining_material, '') = '')
      OR NOT COALESCE(sp.sole_has_fachete_specs, false)
    ) AS sole_fachetado_sem_fachete,

  COALESCE(ts.sole_drives_consumption, false)
    AND (
      (
        NOT COALESCE(ts.insole_ready_made, false)
        AND NOT COALESCE(sp.sole_has_insole_specs, false)
        AND COALESCE(ts.insole_consumption, 0) <= 0
        AND (ts.insole_consumption_per_size IS NULL OR ts.insole_consumption_per_size = '{}'::jsonb)
      )
      OR (
        COALESCE(ts.lining_material, '') <> ''
        AND NOT COALESCE(sp.sole_has_lining_specs, false)
        AND COALESCE(ts.lining_consumption, 0) <= 0
        AND (ts.lining_consumption_per_size IS NULL OR ts.lining_consumption_per_size = '{}'::jsonb)
      )
    ) AS sole_driven_but_specs_missing,

  COALESCE(ts.has_straps, false)
    AND (ts.strap_colors IS NULL OR jsonb_typeof(ts.strap_colors) <> 'array' OR jsonb_array_length(ts.strap_colors) = 0)
    AS straps_without_colors,
  COALESCE(ts.has_straps, false)
    AND ts.strap_colors IS NOT NULL
    AND jsonb_typeof(ts.strap_colors) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(ts.strap_colors) strap
       WHERE COALESCE(strap->>'group_id', '') = ''
         AND COALESCE(strap->>'measure_id', '') = ''
    ) AS straps_without_group,

  NOT EXISTS (SELECT 1 FROM public.technical_sheet_operations tso WHERE tso.sheet_id = ts.id) AS missing_mod,

  NOT COALESCE(ts.has_straps, false)
    AND ts.upper_consumption_per_size IS NOT NULL
    AND jsonb_typeof(ts.upper_consumption_per_size) = 'object'
    AND ts.upper_consumption_per_size <> '{}'::jsonb
    AND COALESCE(ts.upper_consumption, 0) <= 0
    AND (
      SELECT COUNT(*) FROM jsonb_each_text(ts.upper_consumption_per_size)
       WHERE value ~ '^[0-9]+([.,][0-9]+)?$' AND replace(value, ',', '.')::numeric > 0
    ) < 5 AS upper_per_size_partial_no_fallback,

  ts.production_sectors IS NULL
    OR jsonb_typeof(ts.production_sectors) <> 'array'
    OR jsonb_array_length(ts.production_sectors) = 0 AS missing_production_sectors,

  ts.updated_at,
  ts.created_at,

  ts.primary_sole_id IS NULL
    AND (ts.sole_group_id IS NOT NULL OR COALESCE(ts.sole_material, '') <> '') AS missing_primary_sole_id,
  ts.status_ficha = 'publicada' AND COALESCE(ts.ncm, '') !~ '^[0-9]{8}$' AS invalid_published_ncm,
  COALESCE(suh.unit_configuration_issue, false) AS unit_configuration_issue,
  COALESCE(suh.area_material_width_missing, false) AS area_material_width_missing
FROM public.technical_sheets ts
LEFT JOIN sole_profile sp ON sp.sheet_id = ts.id
LEFT JOIN sheet_unit_health suh ON suh.sheet_id = ts.id;

GRANT SELECT ON public.v_technical_sheets_audit TO authenticated;
ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true);

COMMENT ON VIEW public.v_technical_sheets_audit IS
  'Prontidão industrial da ficha: regras condicionais por construção, solado principal, cor, unidade, largura, rota e liberação fiscal.';

CREATE OR REPLACE VIEW public.v_technical_sheets_audit_summary AS
SELECT
  COUNT(*) AS total_fichas,
  COUNT(*) FILTER (WHERE NOT (
    missing_upper_material OR missing_upper_consumption OR
    missing_lining_material OR missing_lining_consumption OR
    missing_insole_material OR missing_insole_consumption OR
    missing_sole_material OR missing_sole_consumption OR
    missing_sole_color_mapping OR sole_fachetado_sem_fachete OR
    sole_driven_but_specs_missing OR straps_without_colors OR
    straps_without_group OR upper_per_size_partial_no_fallback OR
    missing_production_sectors OR missing_primary_sole_id OR
    invalid_published_ncm OR unit_configuration_issue OR
    area_material_width_missing
  )) AS fichas_100_completas,
  COUNT(*) FILTER (WHERE sole_drives_consumption) AS fichas_sole_driven,
  COUNT(*) FILTER (WHERE sole_driven_but_specs_missing) AS sole_driven_sem_specs,
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
  COUNT(*) FILTER (WHERE straps_without_colors) AS tiras_sem_cores,
  COUNT(*) FILTER (WHERE straps_without_group) AS tiras_sem_grupo,
  COUNT(*) FILTER (WHERE missing_mod) AS sem_mod_cadastrado,
  COUNT(*) FILTER (WHERE missing_production_sectors) AS sem_setores_producao,
  COUNT(*) FILTER (WHERE missing_primary_sole_id) AS sem_solado_principal,
  COUNT(*) FILTER (WHERE invalid_published_ncm) AS ncm_invalido_publicada,
  COUNT(*) FILTER (WHERE unit_configuration_issue) AS unidade_invalida,
  COUNT(*) FILTER (WHERE area_material_width_missing) AS material_area_sem_largura
FROM public.v_technical_sheets_audit;

GRANT SELECT ON public.v_technical_sheets_audit_summary TO authenticated;
ALTER VIEW public.v_technical_sheets_audit_summary SET (security_invoker = true);

CREATE OR REPLACE VIEW public.v_soles_audit AS
WITH sheet_solados AS (
  SELECT
    ts.id AS sheet_id,
    ts.primary_sole_id AS sole_product_id,
    COALESCE(ts.sole_drives_consumption, false) AS drives,
    COALESCE(ts.sole_drives_consumption, false)
      AND COALESCE(ts.lining_material, '') <> ''
      AND COALESCE(ts.lining_consumption, 0) <= 0
      AND (ts.lining_consumption_per_size IS NULL OR ts.lining_consumption_per_size = '{}'::jsonb)
      AS needs_lining_specs,
    COALESCE(ts.sole_drives_consumption, false)
      AND NOT COALESCE(ts.insole_ready_made, false)
      AND COALESCE(ts.insole_consumption, 0) <= 0
      AND (ts.insole_consumption_per_size IS NULL OR ts.insole_consumption_per_size = '{}'::jsonb)
      AS needs_insole_specs
    FROM public.technical_sheets ts
   WHERE ts.primary_sole_id IS NOT NULL
  UNION
  SELECT
    tsc.sheet_id,
    tsc.sole_product_id,
    COALESCE(ts.sole_drives_consumption, false),
    COALESCE(ts.sole_drives_consumption, false)
      AND COALESCE(ts.lining_material, '') <> ''
      AND COALESCE(ts.lining_consumption, 0) <= 0
      AND (ts.lining_consumption_per_size IS NULL OR ts.lining_consumption_per_size = '{}'::jsonb),
    COALESCE(ts.sole_drives_consumption, false)
      AND NOT COALESCE(ts.insole_ready_made, false)
      AND COALESCE(ts.insole_consumption, 0) <= 0
      AND (ts.insole_consumption_per_size IS NULL OR ts.insole_consumption_per_size = '{}'::jsonb)
    FROM public.technical_sheet_sole_colors tsc
    JOIN public.technical_sheets ts ON ts.id = tsc.sheet_id
   WHERE tsc.sole_product_id IS NOT NULL
),
soles_in_use AS (
  SELECT
    p.id AS sole_id,
    p.name AS sole_name,
    p.color AS sole_color,
    p.sku AS sole_sku,
    p.unit_price,
    COALESCE(p.is_fachetado, false) AS is_fachetado,
    COUNT(DISTINCT ss.sheet_id) AS sheets_using,
    bool_or(ss.drives) AS drives_consumption,
    bool_or(ss.needs_lining_specs) AS needs_lining_specs,
    bool_or(ss.needs_insole_specs) AS needs_insole_specs
  FROM sheet_solados ss
  JOIN public.products p ON p.id = ss.sole_product_id
  GROUP BY p.id, p.name, p.color, p.sku, p.unit_price, p.is_fachetado
)
SELECT
  s.sole_id,
  s.sole_name,
  s.sole_color,
  s.sole_sku,
  s.unit_price,
  s.is_fachetado,
  s.sheets_using,
  (SELECT COUNT(*) FROM public.sole_technical_specs sts WHERE sts.sole_id = s.sole_id) AS sizes_with_specs_total,
  (SELECT COUNT(*) FROM public.sole_technical_specs sts WHERE sts.sole_id = s.sole_id AND COALESCE(sts.lining_consumption_dm2, 0) > 0) AS sizes_with_lining,
  (SELECT COUNT(*) FROM public.sole_technical_specs sts WHERE sts.sole_id = s.sole_id AND COALESCE(sts.insole_consumption_dm2, 0) > 0) AS sizes_with_insole,
  (SELECT COUNT(*) FROM public.sole_technical_specs sts WHERE sts.sole_id = s.sole_id AND COALESCE(sts.fachete_lining_consumption_dm2, 0) > 0) AS sizes_with_fachete,
  s.needs_lining_specs AND NOT EXISTS (
    SELECT 1 FROM public.sole_technical_specs sts
     WHERE sts.sole_id = s.sole_id AND COALESCE(sts.lining_consumption_dm2, 0) > 0
  ) AS missing_lining_specs,
  s.needs_insole_specs AND NOT EXISTS (
    SELECT 1 FROM public.sole_technical_specs sts
     WHERE sts.sole_id = s.sole_id AND COALESCE(sts.insole_consumption_dm2, 0) > 0
  ) AS missing_insole_specs,
  s.is_fachetado AND NOT EXISTS (
    SELECT 1 FROM public.sole_technical_specs sts
     WHERE sts.sole_id = s.sole_id AND COALESCE(sts.fachete_lining_consumption_dm2, 0) > 0
  ) AS fachetado_missing_fachete_specs,
  (
    s.needs_lining_specs AND NOT EXISTS (
      SELECT 1 FROM public.sole_technical_specs sts
       WHERE sts.sole_id = s.sole_id AND COALESCE(sts.lining_consumption_dm2, 0) > 0
    )
  ) OR (
    s.needs_insole_specs AND NOT EXISTS (
      SELECT 1 FROM public.sole_technical_specs sts
       WHERE sts.sole_id = s.sole_id AND COALESCE(sts.insole_consumption_dm2, 0) > 0
    )
  ) AS drives_consumption_but_no_specs
FROM soles_in_use s;

GRANT SELECT ON public.v_soles_audit TO authenticated;
ALTER VIEW public.v_soles_audit SET (security_invoker = true);

COMMENT ON VIEW public.v_soles_audit IS
  'Solados em uso pela ficha, incluindo primary_sole_id e os mapeamentos por cor, com cobertura das specs por numeração.';
