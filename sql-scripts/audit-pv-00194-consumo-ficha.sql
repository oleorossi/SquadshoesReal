-- Somente leitura. Auditoria do PV-00194:
-- 1) o pedido existe e em que status;
-- 2) se já gerou OPs (promovido);
-- 3) se snapshots/reservas estão desatualizados vs ficha viva;
-- 4) consumo canônico vivo (calculate_consumption_report_batch) vs snapshot congelado.
-- Não grava nada.

WITH pv AS (
  SELECT
    so.id,
    so.order_number,
    so.status,
    so.client_name,
    so.client_order_number,
    so.total,
    so.created_at,
    so.updated_at,
    so.costs_dirty_at,
    so.reservations_outdated_at,
    so.packaging_mode,
    so.box_grouping
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
    soi.created_at AS item_created_at,
    ts.code AS ficha_code,
    ts.name AS ficha_name,
    ts.version AS ficha_version_viva,
    ts.updated_at AS ficha_updated_at,
    ts.sole_drives_consumption,
    ts.component_colors_enabled,
    ts.upper_material,
    COALESCE(ts.upper_consumption, 0) AS upper_consumption,
    ts.upper_consumption_per_size,
    ts.lining_material,
    COALESCE(ts.lining_consumption, 0) AS lining_consumption,
    ts.lining_consumption_per_size,
    ts.insole_material,
    COALESCE(ts.insole_consumption, 0) AS insole_consumption,
    ts.insole_consumption_per_size,
    COALESCE(ts.insole_lining_consumption, 0) AS insole_lining_consumption,
    ts.insole_lining_consumption_per_size,
    ts.fachete_material,
    COALESCE(ts.fachete_consumption, 0) AS fachete_consumption,
    ts.primary_sole_id,
    rmv.material_name AS variant_name
  FROM pv
  JOIN public.sale_order_items soi ON soi.sale_order_id = pv.id
  LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN public.reference_material_variants rmv ON rmv.id = soi.material_variant_id
),
ops AS (
  SELECT
    o.id AS op_id,
    o.order_number AS op_number,
    o.status AS op_status,
    o.quantity AS op_quantity,
    o.color AS op_color,
    o.grade AS op_grade,
    o.sale_order_item_id,
    o.reference_id,
    o.created_at AS op_created_at,
    o.updated_at AS op_updated_at
  FROM pv
  JOIN public.orders o ON o.sale_order_id = pv.id
),
snaps AS (
  SELECT
    tss.id AS snapshot_id,
    tss.sale_order_item_id,
    tss.sheet_id,
    tss.sheet_name,
    tss.sheet_version AS snapshot_sheet_version,
    tss.color,
    tss.quantity,
    tss.frozen_at,
    tss.outdated_at,
    tss.sole_drives_consumption AS snap_sole_drives,
    tss.consumption_snapshot
  FROM pv
  JOIN public.technical_sheet_snapshots tss ON tss.sale_order_id = pv.id
),
reservas AS (
  SELECT
    mr.id,
    mr.order_id AS op_id,
    mr.product_id,
    p.name AS product_name,
    p.unit AS product_unit,
    mr.quantity_reserved AS reserved_qty,
    mr.quantity_consumed AS consumed_qty,
    mr.status AS reservation_status,
    mr.reservation_type,
    mr.source,
    mr.metadata,
    mr.created_at
  FROM ops
  JOIN public.material_reservations mr ON mr.order_id = ops.op_id
  LEFT JOIN public.products p ON p.id = mr.product_id
),
live_consumo AS (
  SELECT public.calculate_consumption_report_batch(
    ARRAY[(SELECT id FROM pv)],
    NULL::uuid[]
  ) AS report
  WHERE EXISTS (SELECT 1 FROM pv)
),
live_lines AS (
  SELECT
    line ->> 'scope_key' AS scope_key,
    line ->> 'scope_type' AS scope_type,
    line ->> 'sale_order_item_id' AS sale_order_item_id,
    line ->> 'reference_id' AS reference_id,
    line ->> 'reference_name' AS reference_name,
    line ->> 'component' AS component,
    line ->> 'product_name' AS product_name,
    line ->> 'product_unit' AS product_unit,
    line ->> 'color' AS color,
    line ->> 'line_kind' AS line_kind,
    line ->> 'product_id' AS product_id,
    NULLIF(line ->> 'required', '')::numeric AS required,
    NULLIF(line ->> 'available', '')::numeric AS available,
    COALESCE((line ->> 'stock_ok')::boolean, false) AS stock_ok,
    line ->> 'source' AS source,
    line ->> 'consumption_warning' AS consumption_warning,
    line ->> 'conversion_warning' AS conversion_warning,
    line ->> 'warning' AS warning
  FROM live_consumo lc
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(lc.report -> 'lines', '[]'::jsonb)) AS line
),
snap_vs_live AS (
  SELECT
    i.item_id,
    i.color,
    i.ficha_code,
    i.ficha_name,
    i.ficha_version_viva,
    s.snapshot_id,
    s.snapshot_sheet_version,
    s.frozen_at,
    s.outdated_at,
    CASE
      WHEN s.snapshot_id IS NULL THEN 'sem_snapshot'
      WHEN s.outdated_at IS NOT NULL THEN 'snapshot_marcado_outdated'
      WHEN s.snapshot_sheet_version IS DISTINCT FROM i.ficha_version_viva
        THEN 'versao_ficha_diferente_do_snapshot'
      ELSE 'snapshot_parece_alinhado_a_versao'
    END AS alinhamento_snapshot
  FROM items i
  LEFT JOIN snaps s ON s.sale_order_item_id = i.item_id
),
item_ops AS (
  SELECT
    i.item_id,
    i.color,
    i.ficha_code,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'op', o.op_number,
          'status', o.op_status,
          'pares', o.op_quantity,
          'criada_em', o.op_created_at
        )
        ORDER BY o.op_created_at
      ) FILTER (WHERE o.op_id IS NOT NULL),
      '[]'::jsonb
    ) AS ops
  FROM items i
  LEFT JOIN ops o ON o.sale_order_item_id = i.item_id
  GROUP BY i.item_id, i.color, i.ficha_code
)
SELECT jsonb_build_object(
  'pedido', (SELECT to_jsonb(p) FROM pv p),
  'ja_gerado', (
    SELECT jsonb_build_object(
      'tem_ops', EXISTS (SELECT 1 FROM ops),
      'qtd_ops', (SELECT count(*) FROM ops),
      'status_pv', (SELECT status FROM pv),
      'promovido_em_producao', COALESCE((SELECT status FROM pv) IN ('Em Produção', 'Finalizado', 'Expedido'), false),
      'costs_dirty', (SELECT costs_dirty_at IS NOT NULL FROM pv),
      'reservations_outdated', (SELECT reservations_outdated_at IS NOT NULL FROM pv)
    )
  ),
  'itens', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'item_id', i.item_id,
      'cor', i.color,
      'pares', i.quantity,
      'fichas', i.fichas,
      'grade', i.grade,
      'ficha_code', i.ficha_code,
      'ficha_name', i.ficha_name,
      'ficha_version_viva', i.ficha_version_viva,
      'ficha_updated_at', i.ficha_updated_at,
      'variant', i.variant_name,
      'sole_drives_consumption', i.sole_drives_consumption,
      'component_colors_enabled', i.component_colors_enabled,
      'consumos_ficha', jsonb_build_object(
        'upper_material', i.upper_material,
        'upper_consumption', i.upper_consumption,
        'upper_per_size', i.upper_consumption_per_size,
        'lining_material', i.lining_material,
        'lining_consumption', i.lining_consumption,
        'lining_per_size', i.lining_consumption_per_size,
        'insole_material', i.insole_material,
        'insole_consumption', i.insole_consumption,
        'insole_per_size', i.insole_consumption_per_size,
        'insole_lining_consumption', i.insole_lining_consumption,
        'insole_lining_per_size', i.insole_lining_consumption_per_size,
        'fachete_material', i.fachete_material,
        'fachete_consumption', i.fachete_consumption,
        'primary_sole_id', i.primary_sole_id
      ),
      'ops', (SELECT ops FROM item_ops io WHERE io.item_id = i.item_id)
    ) ORDER BY i.item_created_at), '[]'::jsonb)
    FROM items i
  ),
  'ops', (
    SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.op_created_at), '[]'::jsonb)
    FROM ops o
  ),
  'snapshots', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'snapshot_id', s.snapshot_id,
      'sale_order_item_id', s.sale_order_item_id,
      'sheet_name', s.sheet_name,
      'color', s.color,
      'quantity', s.quantity,
      'snapshot_sheet_version', s.snapshot_sheet_version,
      'frozen_at', s.frozen_at,
      'outdated_at', s.outdated_at,
      'consumo_congelado', s.consumption_snapshot
    ) ORDER BY s.frozen_at), '[]'::jsonb)
    FROM snaps s
  ),
  'alinhamento_snapshot_vs_ficha', (
    SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.color), '[]'::jsonb)
    FROM snap_vs_live a
  ),
  'reservas_resumo', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'op_id', r.op_id,
      'product', r.product_name,
      'unit', r.product_unit,
      'qty_reserved', r.reserved_qty,
      'qty_consumed', r.consumed_qty,
      'status', r.reservation_status,
      'reservation_type', r.reservation_type,
      'source', r.source,
      'metadata', r.metadata
    ) ORDER BY r.product_name), '[]'::jsonb)
    FROM reservas r
  ),
  'consumo_vivo_linhas', (
    SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.sale_order_item_id, l.component, l.product_name), '[]'::jsonb)
    FROM live_lines l
  ),
  'consumo_vivo_totais', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'component', l.component,
      'product_name', l.product_name,
      'product_unit', l.product_unit,
      'required', sum(l.required),
      'stock_ok', bool_and(l.stock_ok),
      'warnings', jsonb_agg(DISTINCT w) FILTER (WHERE w IS NOT NULL AND btrim(w) <> '')
    ) ORDER BY l.component, l.product_name), '[]'::jsonb)
    FROM live_lines l
    CROSS JOIN LATERAL unnest(ARRAY[l.consumption_warning, l.conversion_warning, l.warning]) AS w
    WHERE l.line_kind = 'material' OR l.line_kind IS NULL
    GROUP BY l.component, l.product_name, l.product_unit
  ),
  'veredito', (
    SELECT jsonb_build_object(
      'pedido_encontrado', EXISTS (SELECT 1 FROM pv),
      'ops_geradas', EXISTS (SELECT 1 FROM ops),
      'snapshot_desatualizado', EXISTS (SELECT 1 FROM snaps WHERE outdated_at IS NOT NULL)
        OR EXISTS (
          SELECT 1 FROM snap_vs_live
          WHERE alinhamento_snapshot IN (
            'snapshot_marcado_outdated',
            'versao_ficha_diferente_do_snapshot'
          )
        ),
      'costs_dirty', COALESCE((SELECT costs_dirty_at IS NOT NULL FROM pv), false),
      'reservations_outdated', COALESCE((SELECT reservations_outdated_at IS NOT NULL FROM pv), false),
      'consumo_vivo_com_aviso', EXISTS (
        SELECT 1 FROM live_lines
        WHERE COALESCE(consumption_warning, '') <> ''
           OR COALESCE(conversion_warning, '') <> ''
           OR COALESCE(warning, '') <> ''
      ),
      'linhas_consumo_vivo', (SELECT count(*) FROM live_lines)
    )
  )
) AS audit_pv_00194;
