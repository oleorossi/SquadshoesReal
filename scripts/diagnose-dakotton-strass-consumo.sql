-- Diagnóstico SOMENTE LEITURA: tira STRASS no Consumo — PV infantil Dakotton
-- Projeto: ssvxfoybzmjlypnipqzn
-- Cole no SQL Editor e rode bloco a bloco.

-- 1) PVs do cliente
SELECT so.id, so.order_number, so.status, so.client_name, so.created_at
  FROM public.sale_orders so
 WHERE so.client_name ILIKE '%dakotton%'
    OR so.client_name ILIKE '%dakoton%'
    OR EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = so.client_id
         AND (
           c.razao_social ILIKE '%dakotton%'
           OR c.razao_social ILIKE '%dakoton%'
           OR coalesce(c.nome_fantasia, '') ILIKE '%dakotton%'
           OR coalesce(c.nome_fantasia, '') ILIKE '%dakoton%'
         )
    )
 ORDER BY so.created_at DESC;

-- 2) Itens + contagem de tiras na ficha vs snapshot do PV
--    (troque o order_number se quiser filtrar um PV)
WITH pvs AS (
  SELECT so.id, so.order_number, so.client_name
    FROM public.sale_orders so
   WHERE so.client_name ILIKE '%dakotton%'
      OR so.client_name ILIKE '%dakoton%'
)
SELECT
  p.order_number,
  i.id AS item_id,
  ts.code AS reference_code,
  ts.name AS reference_name,
  i.color,
  i.quantity,
  ts.has_straps,
  jsonb_array_length(coalesce(ts.strap_colors, '[]'::jsonb)) AS sheet_strap_count,
  jsonb_array_length(coalesce(i.strap_colors, '[]'::jsonb)) AS item_strap_count,
  (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'line_id', line.value ->> 'technical_strap_line_id',
      'basis', coalesce(nullif(line.value ->> 'identity_basis', ''), 'reference_base'),
      'group', line.value ->> 'group_name',
      'label', line.value ->> 'label'
    ) ORDER BY line.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(ts.strap_colors, '[]'::jsonb))
        WITH ORDINALITY AS line(value, ordinality)
  ) AS sheet_lines,
  (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'line_id', line.value ->> 'technical_strap_line_id',
      'basis', coalesce(nullif(line.value ->> 'identity_basis', ''), 'reference_base'),
      'group', line.value ->> 'group_name',
      'label', line.value ->> 'label',
      'color', line.value ->> 'color',
      'color_id', line.value ->> 'color_id',
      'sourcing', i.strap_sourcing -> (line.value ->> 'technical_strap_line_id')
    ) ORDER BY line.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(i.strap_colors, '[]'::jsonb))
        WITH ORDINALITY AS line(value, ordinality)
  ) AS item_lines
FROM pvs p
JOIN public.sale_order_items i ON i.sale_order_id = p.id
LEFT JOIN public.technical_sheets ts ON ts.id = i.reference_id
ORDER BY p.order_number, i.created_at;

-- 3) STRASS na ficha que NÃO está no snapshot do item (= some no Consumo)
WITH pvs AS (
  SELECT so.id, so.order_number
    FROM public.sale_orders so
   WHERE so.client_name ILIKE '%dakotton%'
      OR so.client_name ILIKE '%dakoton%'
),
sheet AS (
  SELECT p.order_number, i.id AS item_id, ts.code,
         line.value ->> 'technical_strap_line_id' AS line_id,
         coalesce(nullif(line.value ->> 'identity_basis', ''), 'reference_base') AS basis,
         line.value ->> 'group_name' AS group_name,
         line.value ->> 'label' AS label
    FROM pvs p
    JOIN public.sale_order_items i ON i.sale_order_id = p.id
    JOIN public.technical_sheets ts ON ts.id = i.reference_id
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(ts.strap_colors, '[]'::jsonb)) line(value)
),
item AS (
  SELECT i.id AS item_id,
         line.value ->> 'technical_strap_line_id' AS line_id
    FROM pvs p
    JOIN public.sale_order_items i ON i.sale_order_id = p.id
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(i.strap_colors, '[]'::jsonb)) line(value)
)
SELECT s.*
  FROM sheet s
 WHERE (
   coalesce(s.group_name, '') ILIKE '%STRASS%'
   OR coalesce(s.label, '') ILIKE '%STRASS%'
   OR s.basis = 'finished_product_group'
 )
 AND NOT EXISTS (
   SELECT 1 FROM item x WHERE x.item_id = s.item_id AND x.line_id = s.line_id
 );

-- 4) Preview canônica (o que o botão Consumo realmente lê)
WITH pvs AS (
  SELECT so.id
    FROM public.sale_orders so
   WHERE so.client_name ILIKE '%dakotton%'
      OR so.client_name ILIKE '%dakoton%'
)
SELECT p.id AS sale_order_id, preview.*
  FROM pvs p
  CROSS JOIN LATERAL public.preview_sale_order_strap_demand(p.id) preview
 ORDER BY p.id, preview.line_ordinal;

-- 5) Relatório batch do Consumo — strap_previews + linhas Tiras
WITH pvs AS (
  SELECT so.id, so.order_number
    FROM public.sale_orders so
   WHERE so.client_name ILIKE '%dakotton%'
      OR so.client_name ILIKE '%dakoton%'
)
SELECT
  p.order_number,
  report.payload -> 'strap_previews' AS strap_previews,
  (
    SELECT coalesce(jsonb_agg(line), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(report.payload -> 'lines', '[]'::jsonb)) line
     WHERE line ->> 'component' = 'Tiras'
  ) AS tiras_material_lines
FROM pvs p
CROSS JOIN LATERAL (
  SELECT public.calculate_consumption_report_batch(
    ARRAY[p.id]::uuid[], NULL::uuid[]
  ) AS payload
) report;
