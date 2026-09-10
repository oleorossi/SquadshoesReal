-- Somente leitura. Diagnóstico focado: por que "elástico forrado 7mm"
-- (ou qualquer elástico) aparece na ficha do PV-00194 mas some no consumo.
--
-- Varre TODOS os canais da ficha (direct_components, components_accessories,
-- strap_colors/has_straps, sheet_materials) + linhas do relatório canônico
-- (materiais + strap_previews).
-- Não grava nada.

WITH pv AS (
  SELECT
    so.id,
    so.order_number,
    so.status,
    so.client_name,
    so.client_order_number,
    so.created_at,
    so.updated_at
  FROM public.sale_orders so
  WHERE so.order_number = 'PV-00194'
     OR so.order_number ILIKE '%00194%'
  ORDER BY CASE WHEN so.order_number = 'PV-00194' THEN 0 ELSE 1 END, so.created_at DESC
  LIMIT 1
),
items AS (
  SELECT
    soi.id AS item_id,
    soi.sale_order_id,
    soi.color,
    soi.quantity,
    soi.fichas,
    soi.grade,
    soi.material_variant_id,
    soi.reference_id AS sheet_id,
    ts.code AS ficha_code,
    ts.name AS ficha_name,
    ts.version AS ficha_version,
    ts.updated_at AS ficha_updated_at,
    ts.has_straps,
    ts.component_colors_enabled,
    ts.direct_components,
    ts.components_accessories,
    ts.strap_colors,
    ts.upper_material,
    COALESCE(ts.upper_consumption, 0) AS upper_consumption
  FROM pv
  JOIN public.sale_order_items soi ON soi.sale_order_id = pv.id
  LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
),
sheet_ids AS (
  SELECT DISTINCT sheet_id FROM items WHERE sheet_id IS NOT NULL
),
-- Canal 1: Componentes diretos (JSONB)
dc AS (
  SELECT
    i.item_id,
    i.ficha_code,
    i.color AS pv_color,
    ord.ordinality AS idx,
    elem ->> 'product_id' AS product_id,
    elem ->> 'product_name' AS product_name_snap,
    elem ->> 'unit' AS unit_snap,
    NULLIF(elem ->> 'quantity', '')::numeric AS qty_per_pair,
    p.name AS product_name_live,
    p.active AS product_active,
    p.unit AS product_unit,
    pg.name AS group_name
  FROM items i
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(COALESCE(i.direct_components, '[]'::jsonb)) = 'array'
         THEN COALESCE(i.direct_components, '[]'::jsonb)
         ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS ord(elem, ordinality)
  LEFT JOIN public.products p ON p.id = NULLIF(elem ->> 'product_id', '')::uuid
  LEFT JOIN public.product_groups pg ON pg.id = p.group_id
  WHERE COALESCE(elem ->> 'product_name', '') ILIKE '%elástic%'
     OR COALESCE(elem ->> 'product_name', '') ILIKE '%elastic%'
     OR COALESCE(elem ->> 'product_name', '') ILIKE '%forrad%'
     OR COALESCE(p.name, '') ILIKE '%elástic%'
     OR COALESCE(p.name, '') ILIKE '%elastic%'
     OR COALESCE(p.name, '') ILIKE '%forrad%'
     OR COALESCE(pg.name, '') ILIKE '%elástic%'
     OR COALESCE(pg.name, '') ILIKE '%elastic%'
     OR COALESCE(pg.name, '') ILIKE '%forrad%'
),
-- Canal 2: Material 2+ (components_accessories)
acc AS (
  SELECT
    i.item_id,
    i.ficha_code,
    i.color AS pv_color,
    ord.ordinality AS idx,
    COALESCE((elem ->> 'mandatory')::boolean, false) AS mandatory,
    elem ->> 'material' AS material_label,
    elem ->> 'product_id' AS product_id,
    elem ->> 'id' AS accessory_id,
    NULLIF(elem ->> 'consumption', '')::numeric AS consumption,
    elem -> 'consumption_per_size' AS consumption_per_size,
    p.name AS product_name_live,
    p.active AS product_active,
    pg.name AS group_name
  FROM items i
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(COALESCE(i.components_accessories, '[]'::jsonb)) = 'array'
         THEN COALESCE(i.components_accessories, '[]'::jsonb)
         ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS ord(elem, ordinality)
  LEFT JOIN public.products p ON p.id = COALESCE(
    NULLIF(elem ->> 'product_id', '')::uuid,
    NULLIF(elem ->> 'id', '')::uuid
  )
  LEFT JOIN public.product_groups pg ON pg.id = p.group_id
  WHERE COALESCE(elem ->> 'material', '') ILIKE '%elástic%'
     OR COALESCE(elem ->> 'material', '') ILIKE '%elastic%'
     OR COALESCE(elem ->> 'material', '') ILIKE '%forrad%'
     OR COALESCE(p.name, '') ILIKE '%elástic%'
     OR COALESCE(p.name, '') ILIKE '%elastic%'
     OR COALESCE(p.name, '') ILIKE '%forrad%'
     OR COALESCE(pg.name, '') ILIKE '%elástic%'
     OR COALESCE(pg.name, '') ILIKE '%elastic%'
     OR COALESCE(pg.name, '') ILIKE '%forrad%'
),
-- Canal 3: Tiras (strap_colors) — "elástico forrado" costuma morar aqui
straps AS (
  SELECT
    i.item_id,
    i.ficha_code,
    i.color AS pv_color,
    i.has_straps,
    ord.ordinality AS idx,
    elem ->> 'technical_strap_line_id' AS technical_strap_line_id,
    elem ->> 'identity_basis' AS identity_basis,
    elem ->> 'measure_id' AS measure_id,
    elem ->> 'strap_type_id' AS strap_type_id,
    elem ->> 'group_id' AS group_id,
    elem ->> 'material_group_id' AS material_group_id,
    NULLIF(elem ->> 'consumption', '')::numeric AS consumption,
    elem -> 'consumption_per_size' AS consumption_per_size,
    m.display_name AS measure_name,
    st.name AS strap_type_name,
    pg.name AS identity_group_name,
    base_pg.name AS base_group_name
  FROM items i
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(COALESCE(i.strap_colors, '[]'::jsonb)) = 'array'
         THEN COALESCE(i.strap_colors, '[]'::jsonb)
         ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS ord(elem, ordinality)
  LEFT JOIN public.artisanal_strap_measures m
    ON m.id = NULLIF(elem ->> 'measure_id', '')::uuid
  LEFT JOIN public.artisanal_strap_types st
    ON st.id = NULLIF(elem ->> 'strap_type_id', '')::uuid
  LEFT JOIN public.product_groups pg
    ON pg.id = NULLIF(elem ->> 'group_id', '')::uuid
  LEFT JOIN public.product_groups base_pg
    ON base_pg.id = NULLIF(elem ->> 'material_group_id', '')::uuid
),
-- Canal 4: BOM (sheet_materials)
bom AS (
  SELECT
    i.item_id,
    i.ficha_code,
    i.color AS pv_color,
    sm.id AS sheet_material_id,
    sm.product_id,
    sm.quantity_per_unit,
    sm.color AS bom_color,
    sm.material_variant_id,
    p.name AS product_name,
    p.active AS product_active,
    p.unit AS product_unit,
    pg.name AS group_name
  FROM items i
  JOIN public.sheet_materials sm ON sm.sheet_id = i.sheet_id
  LEFT JOIN public.products p ON p.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = COALESCE(sm.group_id, p.group_id)
  WHERE COALESCE(p.name, '') ILIKE '%elástic%'
     OR COALESCE(p.name, '') ILIKE '%elastic%'
     OR COALESCE(p.name, '') ILIKE '%forrad%'
     OR COALESCE(pg.name, '') ILIKE '%elástic%'
     OR COALESCE(pg.name, '') ILIKE '%elastic%'
     OR COALESCE(pg.name, '') ILIKE '%forrad%'
),
live_report AS (
  SELECT public.calculate_consumption_report_batch(
    ARRAY[(SELECT id FROM pv)],
    NULL::uuid[]
  ) AS report
  WHERE EXISTS (SELECT 1 FROM pv)
),
live_material_elastico AS (
  SELECT
    line ->> 'sale_order_item_id' AS sale_order_item_id,
    line ->> 'component' AS component,
    line ->> 'product_name' AS product_name,
    line ->> 'product_unit' AS product_unit,
    line ->> 'color' AS color,
    line ->> 'source' AS source,
    line ->> 'line_kind' AS line_kind,
    NULLIF(line ->> 'required', '')::numeric AS required,
    line ->> 'consumption_warning' AS consumption_warning,
    line ->> 'warning' AS warning
  FROM live_report lr
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(lr.report -> 'lines', '[]'::jsonb)) AS line
  WHERE COALESCE(line ->> 'product_name', '') ILIKE '%elástic%'
     OR COALESCE(line ->> 'product_name', '') ILIKE '%elastic%'
     OR COALESCE(line ->> 'product_name', '') ILIKE '%forrad%'
     OR COALESCE(line ->> 'component', '') ILIKE '%elástic%'
     OR COALESCE(line ->> 'component', '') ILIKE '%tira%'
),
live_strap_previews AS (
  SELECT
    preview ->> 'sale_order_item_id' AS sale_order_item_id,
    preview ->> 'technical_strap_line_id' AS technical_strap_line_id,
    COALESCE(
      preview #>> '{resolved,strap_product_name}',
      preview ->> 'strap_product_name'
    ) AS strap_product_name,
    COALESCE(
      preview #>> '{resolved,measure_name}',
      preview ->> 'measure_name'
    ) AS measure_name,
    COALESCE(
      preview #>> '{resolved,strap_color_name}',
      preview #>> '{resolved,color}',
      preview ->> 'strap_color_name'
    ) AS strap_color_name,
    COALESCE(
      preview #>> '{resolved,base_group_name}',
      preview ->> 'base_group_name'
    ) AS base_group_name,
    COALESCE(
      preview #>> '{resolved,base_product_name}',
      preview ->> 'base_product_name'
    ) AS base_product_name,
    preview ->> 'source_mode' AS source_mode,
    NULLIF(preview ->> 'gross_required_m', '')::numeric AS gross_required_m,
    NULLIF(
      COALESCE(
        preview #>> '{resolved,base_required_m}',
        preview ->> 'base_required_m'
      ),
      ''
    )::numeric AS base_required_m,
    preview -> 'blocking_reasons' AS blocking_reasons,
    COALESCE(
      preview #>> '{resolved,snapshot_warning}',
      preview ->> 'snapshot_warning'
    ) AS snapshot_warning
  FROM live_report lr
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(lr.report -> 'strap_previews', '[]'::jsonb)) AS preview
)
SELECT jsonb_build_object(
  'pedido', (SELECT to_jsonb(p) FROM pv p),
  'itens', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'item_id', i.item_id,
      'cor', i.color,
      'pares', i.quantity,
      'ficha', i.ficha_code,
      'ficha_version', i.ficha_version,
      'has_straps', i.has_straps,
      'component_colors_enabled', i.component_colors_enabled,
      'upper_material', i.upper_material,
      'upper_consumption', i.upper_consumption,
      'qtd_direct_components', jsonb_array_length(COALESCE(i.direct_components, '[]'::jsonb)),
      'qtd_components_accessories', jsonb_array_length(COALESCE(i.components_accessories, '[]'::jsonb)),
      'qtd_strap_colors', jsonb_array_length(COALESCE(i.strap_colors, '[]'::jsonb))
    ) ORDER BY i.color), '[]'::jsonb)
    FROM items i
  ),
  'canal_direct_components_elastico', (
    SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.ficha_code, d.pv_color, d.idx), '[]'::jsonb)
    FROM dc d
  ),
  'canal_components_accessories_elastico', (
    SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.ficha_code, a.pv_color, a.idx), '[]'::jsonb)
    FROM acc a
  ),
  'canal_strap_colors_todas_linhas', (
    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.ficha_code, s.pv_color, s.idx), '[]'::jsonb)
    FROM straps s
  ),
  'canal_bom_elastico', (
    SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.ficha_code, b.pv_color), '[]'::jsonb)
    FROM bom b
  ),
  'consumo_vivo_materiais_elastico', (
    SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.sale_order_item_id, l.product_name), '[]'::jsonb)
    FROM live_material_elastico l
  ),
  'consumo_vivo_strap_previews', (
    SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.sale_order_item_id, p.strap_product_name), '[]'::jsonb)
    FROM live_strap_previews p
  ),
  'veredito', (
    SELECT jsonb_build_object(
      'pedido_encontrado', EXISTS (SELECT 1 FROM pv),
      'tem_direct_component_elastico', EXISTS (SELECT 1 FROM dc),
      'tem_accessory_elastico', EXISTS (SELECT 1 FROM acc),
      'tem_accessory_mandatory_elastico', EXISTS (SELECT 1 FROM acc WHERE mandatory),
      'ficha_has_straps', COALESCE((SELECT bool_or(has_straps) FROM items), false),
      'tem_linhas_strap_colors', EXISTS (SELECT 1 FROM straps),
      'tem_bom_elastico', EXISTS (SELECT 1 FROM bom),
      'consumo_mostra_elastico_material', EXISTS (SELECT 1 FROM live_material_elastico),
      'consumo_mostra_strap_preview', EXISTS (SELECT 1 FROM live_strap_previews),
      'hipotese', CASE
        WHEN EXISTS (SELECT 1 FROM straps)
          AND NOT EXISTS (SELECT 1 FROM live_strap_previews)
          THEN 'tira_na_ficha_sem_preview_canônico — cadastro de receita/variante/base incompleto ou bloqueado'
        WHEN EXISTS (SELECT 1 FROM straps)
          AND EXISTS (SELECT 1 FROM live_strap_previews)
          THEN 'elástico_forrado_é_TIRA — aparece só em § Tiras artesanais, não na tabela de materiais'
        WHEN EXISTS (SELECT 1 FROM dc)
          AND EXISTS (SELECT 1 FROM live_material_elastico)
          THEN 'elástico_está_em_componentes_diretos_e_aparece_no_consumo — confira o NOME do produto (ex.: Elástico 6MM no grupo ELÁSTICO 7MM)'
        WHEN EXISTS (SELECT 1 FROM acc WHERE mandatory)
          AND NOT EXISTS (SELECT 1 FROM live_material_elastico)
          THEN 'accessory_mandatory_sem_linha_no_consumo — produto inativo/órfão ou qty 0 (skip silencioso)'
        WHEN EXISTS (SELECT 1 FROM bom)
          AND NOT EXISTS (SELECT 1 FROM live_material_elastico)
          THEN 'BOM_com_elastico_omitido — dedup/variante/produto inativo/qty 0'
        WHEN NOT EXISTS (SELECT 1 FROM dc)
          AND NOT EXISTS (SELECT 1 FROM acc)
          AND NOT EXISTS (SELECT 1 FROM straps)
          AND NOT EXISTS (SELECT 1 FROM bom)
          THEN 'nenhum_canal_da_ficha_tem_elastico_forrado — o que a UI mostra pode ser só rótulo/grupo, não vínculo consumível'
        ELSE 'revisar_detalhe_dos_canais'
      END
    )
  )
) AS audit_pv_00194_elastico;
