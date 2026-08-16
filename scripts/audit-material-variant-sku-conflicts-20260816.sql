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
),
recent_items AS (
  SELECT
    target.id AS variant_id,
    COALESCE(jsonb_agg(entry.payload ORDER BY entry.sort_key DESC)
      FILTER (WHERE entry.payload IS NOT NULL), '[]'::jsonb) AS items
  FROM target_variants target
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(NULLIF(to_jsonb(so) ->> 'created_at', '')::timestamptz,
               '-infinity'::timestamptz) AS sort_key,
      jsonb_build_object(
        'sale_order_item', to_jsonb(soi),
        'sale_order', to_jsonb(so)
      ) AS payload
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
    WHERE soi.material_variant_id = target.id
    ORDER BY COALESCE(NULLIF(to_jsonb(so) ->> 'created_at', '')::timestamptz,
                      '-infinity'::timestamptz) DESC
    LIMIT 20
  ) entry ON true
  GROUP BY target.id
)
SELECT jsonb_pretty(jsonb_agg(jsonb_build_object(
  'normalized_sku', lower(btrim(v.sku)),
  'variant', to_jsonb(v),
  'technical_sheet', to_jsonb(ts),
  'usage', jsonb_build_object(
    'sale_order_items', usage.sale_order_item_count,
    'non_cancelled_sale_order_items', usage.non_cancelled_sale_order_item_count,
    'production_orders', usage.production_order_count,
    'specific_bom_lines', usage.specific_bom_line_count,
    'latest_sale_order_at', usage.latest_sale_order_at
  ),
  'recent_items', recent.items
) ORDER BY lower(btrim(v.sku)), v.id)) AS material_variant_sku_conflicts
FROM target_variants target
JOIN public.reference_material_variants v ON v.id = target.id
JOIN public.technical_sheets ts ON ts.id = v.reference_id
JOIN variant_usage usage ON usage.id = v.id
JOIN recent_items recent ON recent.variant_id = v.id;
