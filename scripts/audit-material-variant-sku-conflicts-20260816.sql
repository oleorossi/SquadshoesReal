-- Diagnóstico read-only para os conflitos bloqueados pela migration 04300.
-- Não corrige, não renomeia e não altera nenhum cadastro.
WITH target_variants(id) AS (
  VALUES
    ('28a5e708-6261-4e4d-b154-08852cfc8c53'::uuid),
    ('75f6fcfb-7e61-42d8-ace3-0fd566cc9be3'::uuid),
    ('519826f3-6a67-4f89-a401-22c924900ac6'::uuid),
    ('c6fb1702-0615-4776-89b7-1b0974d72464'::uuid),
    ('51eddc5f-b58c-4fe3-b6e3-12308069589b'::uuid),
    ('f2855d98-eb0a-4933-a634-b471592b1a31'::uuid)
),
variant_usage AS (
  SELECT
    v.id,
    count(DISTINCT soi.id) AS sale_order_item_count,
    count(DISTINCT soi.id) FILTER (
      WHERE lower(COALESCE(to_jsonb(so) ->> 'status', ''))
        NOT IN ('cancelado', 'cancelada')
    ) AS non_cancelled_sale_order_item_count,
    count(DISTINCT o.id) AS production_order_count,
    count(DISTINCT sm.id) AS specific_bom_line_count,
    max(NULLIF(to_jsonb(so) ->> 'created_at', '')::timestamptz)
      AS latest_sale_order_at
  FROM target_variants target
  JOIN public.reference_material_variants v ON v.id = target.id
  LEFT JOIN public.sale_order_items soi ON soi.material_variant_id = v.id
  LEFT JOIN public.sale_orders so ON so.id = soi.sale_order_id
  LEFT JOIN public.orders o ON o.sale_order_item_id = soi.id
  LEFT JOIN public.sheet_materials sm ON sm.material_variant_id = v.id
  GROUP BY v.id
)
SELECT
  lower(btrim(v.sku)) AS normalized_sku,
  v.id AS variant_id,
  v.reference_id,
  to_jsonb(ts) ->> 'code' AS reference_code,
  to_jsonb(ts) ->> 'name' AS reference_name,
  to_jsonb(ts) ->> 'status' AS reference_status,
  to_jsonb(ts) ->> 'status_ficha' AS sheet_status,
  v.material_name,
  v.sku,
  v.active,
  v.main_material_group_id,
  v.upper_material_group_id,
  v.lining_material_group_id,
  v.insole_material_group_id,
  v.created_at,
  v.updated_at,
  usage.sale_order_item_count,
  usage.non_cancelled_sale_order_item_count,
  usage.production_order_count,
  usage.specific_bom_line_count,
  usage.latest_sale_order_at
FROM target_variants target
JOIN public.reference_material_variants v ON v.id = target.id
JOIN public.technical_sheets ts ON ts.id = v.reference_id
JOIN variant_usage usage ON usage.id = v.id
ORDER BY lower(btrim(v.sku)), v.id;
