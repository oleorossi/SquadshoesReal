-- Auditoria somente leitura — Pedido de Venda / prontidão comercial
-- Data: 2026-08-16
--
-- Mede a cadeia referência → material → cor/grade → preço, sem alterar dados.
-- O resultado é um único JSON para caber no log do workflow Management API.

WITH
open_items AS (
  SELECT
    soi.*,
    so.order_number,
    so.status AS order_status,
    so.client_id,
    so.total AS order_total,
    so.shipping_rate_per_pair,
    ts.code AS reference_code,
    ts.name AS reference_name,
    ts.status AS reference_status,
    ts.status_ficha,
    ts.sale_price AS sheet_sale_price
  FROM public.sale_order_items soi
  JOIN public.sale_orders so ON so.id = soi.sale_order_id
  LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
  WHERE COALESCE(so.status, '') NOT IN ('Cancelado', 'Cancelada', 'Faturado')
),
valid_client_lists AS (
  SELECT
    c.id AS client_id,
    c.price_list_id,
    pl.name AS price_list_name,
    pl.active,
    pl.valid_from,
    pl.valid_to,
    (
      pl.active
      AND pl.valid_from <= CURRENT_DATE
      AND (pl.valid_to IS NULL OR pl.valid_to >= CURRENT_DATE)
    ) AS effective_today
  FROM public.clients c
  JOIN public.price_lists pl ON pl.id = c.price_list_id
),
effective_rule AS (
  SELECT
    oi.id AS sale_order_item_id,
    exact_rule.id AS exact_rule_id,
    default_rule.id AS default_rule_id,
    COALESCE(exact_rule.unit_price, default_rule.unit_price) AS effective_price,
    CASE
      WHEN exact_rule.id IS NOT NULL THEN 'tabela_cor'
      WHEN default_rule.id IS NOT NULL THEN 'tabela_referencia'
      ELSE NULL
    END AS price_origin
  FROM open_items oi
  JOIN valid_client_lists vcl
    ON vcl.client_id = oi.client_id
   AND vcl.effective_today
  LEFT JOIN LATERAL (
    SELECT pli.id, pli.unit_price
    FROM public.price_list_items pli
    WHERE pli.price_list_id = vcl.price_list_id
      AND pli.reference_id = oi.reference_id
      AND upper(trim(COALESCE(pli.color, ''))) = upper(trim(COALESCE(oi.color, '')))
      AND trim(COALESCE(pli.color, '')) <> ''
      AND pli.min_quantity <= GREATEST(COALESCE(oi.quantity, 0), 0)
    ORDER BY pli.min_quantity DESC, pli.updated_at DESC, pli.id
    LIMIT 1
  ) exact_rule ON true
  LEFT JOIN LATERAL (
    SELECT pli.id, pli.unit_price
    FROM public.price_list_items pli
    WHERE pli.price_list_id = vcl.price_list_id
      AND pli.reference_id = oi.reference_id
      AND trim(COALESCE(pli.color, '')) = ''
      AND pli.min_quantity <= GREATEST(COALESCE(oi.quantity, 0), 0)
    ORDER BY pli.min_quantity DESC, pli.updated_at DESC, pli.id
    LIMIT 1
  ) default_rule ON true
),
duplicate_price_rules AS (
  SELECT
    price_list_id,
    reference_id,
    upper(trim(COALESCE(color, ''))) AS color_key,
    min_quantity,
    count(*) AS duplicates
  FROM public.price_list_items
  GROUP BY 1, 2, 3, 4
  HAVING count(*) > 1
),
order_recomputed AS (
  SELECT
    so.id,
    so.order_number,
    COALESCE(so.total, 0) AS stored_total,
    COALESCE(sum(soi.quantity * soi.unit_price), 0) AS recomputed_total
  FROM public.sale_orders so
  LEFT JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
  WHERE COALESCE(so.status, '') NOT IN ('Cancelado', 'Cancelada')
  GROUP BY so.id, so.order_number, so.total
),
sheet_usage AS (
  SELECT reference_id, count(*) AS item_count
  FROM public.sale_order_items
  GROUP BY reference_id
),
variant_counts AS (
  SELECT reference_id, count(*) FILTER (WHERE active) AS active_variants
  FROM public.reference_material_variants
  GROUP BY reference_id
)
SELECT jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'references', jsonb_build_object(
    'total', (SELECT count(*) FROM public.technical_sheets),
    'published', (SELECT count(*) FROM public.technical_sheets WHERE status_ficha = 'publicada'),
    'draft_or_review', (SELECT count(*) FROM public.technical_sheets WHERE status_ficha IS DISTINCT FROM 'publicada'),
    'discontinued', (SELECT count(*) FROM public.technical_sheets WHERE lower(COALESCE(status, '')) = 'descontinuado'),
    'used_in_sales', (SELECT count(*) FROM sheet_usage),
    'used_with_zero_sale_price', (
      SELECT count(*)
      FROM public.technical_sheets ts
      JOIN sheet_usage su ON su.reference_id = ts.id
      WHERE COALESCE(ts.sale_price, 0) <= 0
    ),
    'duplicate_identity_groups', (
      SELECT count(*) FROM (
        SELECT lower(trim(COALESCE(code, ''))), lower(trim(COALESCE(name, '')))
        FROM public.technical_sheets
        GROUP BY 1, 2 HAVING count(*) > 1
      ) d
    )
  ),
  'price_lists', jsonb_build_object(
    'total', (SELECT count(*) FROM public.price_lists),
    'effective_today', (
      SELECT count(*) FROM public.price_lists
      WHERE active AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
    ),
    'clients_assigned', (SELECT count(*) FROM public.clients WHERE price_list_id IS NOT NULL),
    'clients_assigned_invalid_today', (SELECT count(*) FROM valid_client_lists WHERE NOT effective_today),
    'duplicate_rule_groups', (SELECT count(*) FROM duplicate_price_rules),
    'duplicate_rule_rows', (SELECT COALESCE(sum(duplicates), 0) FROM duplicate_price_rules),
    'open_items_with_valid_client_list', (
      SELECT count(*) FROM open_items oi JOIN valid_client_lists vcl ON vcl.client_id = oi.client_id AND vcl.effective_today
    ),
    'open_items_covered_by_rule', (SELECT count(*) FROM effective_rule WHERE effective_price IS NOT NULL),
    'open_items_different_from_rule', (
      SELECT count(*)
      FROM open_items oi
      JOIN effective_rule er ON er.sale_order_item_id = oi.id
      WHERE er.effective_price IS NOT NULL
        AND abs(COALESCE(oi.unit_price, 0) - er.effective_price) > 0.009
    )
  ),
  'open_order_items', jsonb_build_object(
    'total', (SELECT count(*) FROM open_items),
    'zero_or_negative_price', (SELECT count(*) FROM open_items WHERE COALESCE(unit_price, 0) <= 0),
    'quantity_grade_mismatch', (
      SELECT count(*)
      FROM open_items oi
      WHERE COALESCE(oi.quantity, 0) <> COALESCE((
        SELECT sum((entry.value)::numeric)
        FROM jsonb_each_text(COALESCE(oi.grade, '{}'::jsonb)) entry
      ), 0) * GREATEST(COALESCE(oi.fichas, 1), 1)
    ),
    'variant_from_other_reference', (
      SELECT count(*)
      FROM open_items oi
      JOIN public.reference_material_variants rmv ON rmv.id = oi.material_variant_id
      WHERE rmv.reference_id <> oi.reference_id
    ),
    'inactive_variant_selected', (
      SELECT count(*)
      FROM open_items oi
      JOIN public.reference_material_variants rmv ON rmv.id = oi.material_variant_id
      WHERE NOT rmv.active
    ),
    'missing_variant_when_available', (
      SELECT count(*)
      FROM open_items oi
      JOIN variant_counts vc ON vc.reference_id = oi.reference_id AND vc.active_variants > 0
      WHERE oi.material_variant_id IS NULL
    ),
    'missing_variant_when_multiple', (
      SELECT count(*)
      FROM open_items oi
      JOIN variant_counts vc ON vc.reference_id = oi.reference_id AND vc.active_variants > 1
      WHERE oi.material_variant_id IS NULL
    )
  ),
  'order_totals', jsonb_build_object(
    'different_from_item_sum', (
      SELECT count(*) FROM order_recomputed WHERE abs(stored_total - recomputed_total) > 0.009
    ),
    'absolute_difference_brl', (
      SELECT round(COALESCE(sum(abs(stored_total - recomputed_total)), 0)::numeric, 2)
      FROM order_recomputed
    )
  ),
  'actionable_samples', jsonb_build_object(
    'invalid_client_price_lists', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'client_id', client_id,
        'price_list', price_list_name,
        'active', active,
        'valid_from', valid_from,
        'valid_to', valid_to
      ))
      FROM (SELECT * FROM valid_client_lists WHERE NOT effective_today ORDER BY price_list_name LIMIT 20) x
    ), '[]'::jsonb),
    'missing_material_variant', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pv', oi.order_number,
        'reference', concat_ws(' · ', oi.reference_code, oi.reference_name),
        'color', oi.color,
        'active_variants', vc.active_variants
      ))
      FROM open_items oi
      JOIN variant_counts vc ON vc.reference_id = oi.reference_id AND vc.active_variants > 0
      WHERE oi.material_variant_id IS NULL
      ORDER BY oi.order_number, oi.reference_code
      LIMIT 20
    ), '[]'::jsonb),
    'price_rule_differences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pv', oi.order_number,
        'reference', concat_ws(' · ', oi.reference_code, oi.reference_name),
        'color', oi.color,
        'saved_price', oi.unit_price,
        'rule_price', er.effective_price,
        'origin', er.price_origin
      ))
      FROM open_items oi
      JOIN effective_rule er ON er.sale_order_item_id = oi.id
      WHERE er.effective_price IS NOT NULL
        AND abs(COALESCE(oi.unit_price, 0) - er.effective_price) > 0.009
      ORDER BY oi.order_number, oi.reference_code
      LIMIT 20
    ), '[]'::jsonb)
  )
)) AS audit;
