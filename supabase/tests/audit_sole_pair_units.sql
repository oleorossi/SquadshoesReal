-- Auditoria somente leitura: unidade canônica, grade e consumo de solados.
-- Regra de negócio: 1 unidade de estoque = 1 par completo de solado
-- (pé esquerdo + pé direito). Portanto, 1 par vendido consome 1 par do estoque.

WITH sole_products AS (
  SELECT p.*
    FROM public.products p
   WHERE lower(btrim(COALESCE(p.category, ''))) = 'sola'
      OR lower(btrim(COALESCE(p.category, ''))) LIKE 'solado%'
),
grade_totals AS (
  SELECT sp.id,
         COALESCE(sum((g.value #>> '{}')::numeric)
           FILTER (WHERE left(g.key, 1) <> '_'), 0) AS grade_total,
         bool_or(
           left(g.key, 1) <> '_'
           AND (g.value #>> '{}')::numeric <> trunc((g.value #>> '{}')::numeric)
         ) AS has_fraction,
         bool_or(
           left(g.key, 1) <> '_'
           AND (g.value #>> '{}')::numeric < 0
         ) AS has_negative
    FROM sole_products sp
    LEFT JOIN LATERAL jsonb_each(COALESCE(sp.stock_grade, '{}'::jsonb)) g ON true
   GROUP BY sp.id
),
configured_sheets AS (
  SELECT ts.id,
         ts.name,
         ts.status,
         ts.sole_consumption,
         ts.sole_group_id,
         ts.sole_material
    FROM public.technical_sheets ts
   WHERE ts.sole_group_id IS NOT NULL
      OR NULLIF(btrim(COALESCE(ts.sole_material, '')), '') IS NOT NULL
),
sole_reservations AS (
  SELECT mr.id,
         mr.order_id,
         mr.product_id,
         mr.status,
         mr.quantity_reserved,
         mr.quantity_consumed,
         mr.metadata,
         COALESCE((
           SELECT sum((g.value #>> '{}')::numeric)
             FROM jsonb_each(COALESCE(mr.metadata -> 'effective_grade', '{}'::jsonb)) g
            WHERE left(g.key, 1) <> '_'
         ), 0) AS effective_grade_total
    FROM public.material_reservations mr
    JOIN sole_products sp ON sp.id = mr.product_id
   WHERE COALESCE(mr.metadata ->> 'kind', '') IN ('sole_grade', 'sole_pending_grade')
),
debit_source AS (
  SELECT pg_get_functiondef(
           to_regprocedure('public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)')
         ) AS source
),
consumption_source AS (
  SELECT pg_get_functiondef(
           to_regprocedure('public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)')
         ) AS source
)
SELECT jsonb_pretty(jsonb_build_object(
  'rule', '1 unidade de estoque = 1 par completo (esquerdo + direito); 1 par vendido consome 1 par',
  'products', jsonb_build_object(
    'total', (SELECT count(*) FROM sole_products),
    'active', (SELECT count(*) FROM sole_products WHERE active),
    'unit_not_pair', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sp.id, 'name', sp.name, 'sku', sp.sku, 'unit', sp.unit, 'active', sp.active
      ) ORDER BY sp.active DESC, sp.name)
        FROM sole_products sp
       WHERE lower(btrim(COALESCE(sp.unit, ''))) <> 'par'
    ), '[]'::jsonb),
    'secondary_units_not_pair', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sp.id, 'name', sp.name,
        'stock_unit', sp.unit,
        'consumption_unit', sp.consumption_unit,
        'purchase_unit', sp.purchase_unit,
        'conversion_rate', sp.conversion_rate
      ) ORDER BY sp.name)
        FROM sole_products sp
       WHERE (NULLIF(btrim(COALESCE(sp.consumption_unit, '')), '') IS NOT NULL
              AND lower(btrim(sp.consumption_unit)) <> 'par')
          OR (NULLIF(btrim(COALESCE(sp.purchase_unit, '')), '') IS NOT NULL
              AND lower(btrim(sp.purchase_unit)) <> 'par')
          OR COALESCE(sp.conversion_rate, 1) <> 1
    ), '[]'::jsonb),
    'quantity_grade_drift', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sp.id, 'name', sp.name, 'quantity', sp.quantity, 'grade_total', gt.grade_total
      ) ORDER BY sp.name)
        FROM sole_products sp
        JOIN grade_totals gt ON gt.id = sp.id
       WHERE sp.stock_grade IS NOT NULL
         AND abs(COALESCE(sp.quantity, 0) - gt.grade_total) > 0.0001
    ), '[]'::jsonb),
    'fractional_or_negative_grade', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sp.id, 'name', sp.name,
        'fractional', COALESCE(gt.has_fraction, false),
        'negative', COALESCE(gt.has_negative, false)
      ) ORDER BY sp.name)
        FROM sole_products sp
        JOIN grade_totals gt ON gt.id = sp.id
       WHERE COALESCE(gt.has_fraction, false) OR COALESCE(gt.has_negative, false)
    ), '[]'::jsonb)
  ),
  'technical_sheets', jsonb_build_object(
    'configured', (SELECT count(*) FROM configured_sheets),
    'consumption_not_one_pair_per_pair', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cs.id, 'name', cs.name,
        'status', cs.status, 'sole_consumption', cs.sole_consumption
      ) ORDER BY cs.name)
        FROM configured_sheets cs
       WHERE COALESCE(cs.sole_consumption, 0) <> 1
    ), '[]'::jsonb)
  ),
  'material_variants', jsonb_build_object(
    'sole_override_not_one', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rmv.id, 'reference_id', rmv.reference_id,
        'sole_consumption_override', rmv.sole_consumption_override
      ) ORDER BY rmv.reference_id, rmv.id)
        FROM public.reference_material_variants rmv
       WHERE rmv.sole_consumption_override IS NOT NULL
         AND rmv.sole_consumption_override <> 1
    ), '[]'::jsonb)
  ),
  'reservations', jsonb_build_object(
    'total', (SELECT count(*) FROM sole_reservations),
    'fractional_quantity', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sr.id, 'order_id', sr.order_id,
        'reserved', sr.quantity_reserved, 'consumed', sr.quantity_consumed
      ) ORDER BY sr.id)
        FROM sole_reservations sr
       WHERE sr.quantity_reserved <> trunc(sr.quantity_reserved)
          OR sr.quantity_consumed <> trunc(sr.quantity_consumed)
    ), '[]'::jsonb),
    'effective_grade_mismatch', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sr.id, 'order_id', sr.order_id, 'status', sr.status,
        'reserved', sr.quantity_reserved, 'grade_total', sr.effective_grade_total
      ) ORDER BY sr.id)
        FROM sole_reservations sr
       WHERE sr.metadata ? 'effective_grade'
         AND abs(sr.quantity_reserved - sr.effective_grade_total) > 0.0001
    ), '[]'::jsonb)
  ),
  'sql_contract', jsonb_build_object(
    'debit_function_exists', (SELECT source IS NOT NULL FROM debit_source),
    'debit_uses_grade_pair_quantity', (SELECT source LIKE '%v_debit_size := LEAST(v_available, v_size_qty)%' FROM debit_source),
    'debit_has_explicit_times_two', (SELECT source ~* 'v_size_qty[[:space:]]*\\*[[:space:]]*2|2[[:space:]]*\\*[[:space:]]*v_size_qty' FROM debit_source),
    'consumption_function_exists', (SELECT source IS NOT NULL FROM consumption_source)
  )
)) AS audit_sole_pair_units;
