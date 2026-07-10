-- Diagnóstico R2 (SOMENTE LEITURA) — complementa diag-broken-sole-debit-window.sql
-- (1) movimentos de solado DETACHED (order_id NULL) → risco de falso "não debitado";
-- (2) pendências sole_pending_grade (qualquer status) das OPs afetadas → vintage do dano;
-- (3) status dos PVs das OPs afetadas → o que ainda vai faturar;
-- (4) varredura ampla de OCs: auto_generated na janela + itens de solado adicionados na janela.
WITH params AS (
  SELECT timestamptz '2026-06-24 00:00-03' AS scan_start,
         timestamptz '2026-07-02 12:00-03' AS win_start
),
ops AS (
  SELECT o.id, o.order_number, o.status, o.created_at, o.quantity, o.grade,
         o.reference_id, o.color, o.sale_order_id
    FROM orders o, params
   WHERE o.grade IS NOT NULL AND jsonb_typeof(o.grade) = 'object' AND o.grade <> '{}'::jsonb
     AND (o.created_at >= params.scan_start OR o.updated_at >= params.scan_start)
),
afetadas AS (
  SELECT ops.*, rsc.sole_product_id
  FROM ops
  LEFT JOIN LATERAL (SELECT * FROM resolve_sole_color(ops.reference_id, COALESCE(ops.color,'')) LIMIT 1) rsc ON true
  WHERE rsc.sole_product_id IS NOT NULL
    AND ops.status NOT ILIKE '%cancel%'
    AND NOT EXISTS (SELECT 1 FROM material_reservations mr
                     WHERE mr.order_id = ops.id AND mr.metadata->>'kind' = 'sole_grade')
    AND NOT EXISTS (SELECT 1 FROM stock_movements sm
                     WHERE sm.order_id = ops.id AND sm.movement_type = 'out'
                       AND (sm.description LIKE 'Debito Solado por grade%'
                            OR sm.description LIKE 'Conversão Solado por grade%'))
)
-- ── R1: movimentos de débito de solado DETACHED (order_id NULL) ──────────────
SELECT 'R1_mov_detached' AS secao, 1 AS seq, jsonb_build_object(
  'n', count(*), 'pares', COALESCE(sum(sm.quantity),0),
  'primeiro', min(sm.created_at), 'ultimo', max(sm.created_at)) AS dados
FROM stock_movements sm
WHERE sm.order_id IS NULL AND sm.movement_type = 'out'
  AND (sm.description LIKE 'Debito Solado por grade%' OR sm.description LIKE 'Conversão Solado por grade%')
UNION ALL
SELECT 'R1b_amostra', row_number() OVER (ORDER BY sm.created_at DESC)::int,
       jsonb_build_object('data', sm.created_at::date, 'pares', sm.quantity, 'desc', left(sm.description, 90))
FROM (SELECT * FROM stock_movements sm
       WHERE sm.order_id IS NULL AND sm.movement_type = 'out'
         AND (sm.description LIKE 'Debito Solado por grade%' OR sm.description LIKE 'Conversão Solado por grade%')
       ORDER BY sm.created_at DESC LIMIT 8) sm
UNION ALL
-- ── R2: pendências sole_pending_grade das OPs afetadas (qualquer status) ─────
SELECT 'R2_pendencias', row_number() OVER (ORDER BY a.order_number)::int,
       jsonb_build_object('op', a.order_number, 'status_op', a.status,
         'pend_status', mr.status, 'pend_criada', mr.created_at::date,
         'pend_notes', left(COALESCE(mr.notes,''), 110))
FROM afetadas a
JOIN material_reservations mr
  ON mr.order_id = a.id AND mr.metadata->>'kind' = 'sole_pending_grade'
UNION ALL
-- ── R3: status dos PVs das OPs afetadas ──────────────────────────────────────
SELECT 'R3_pvs', row_number() OVER (ORDER BY so.order_number)::int,
       jsonb_build_object('pv', so.order_number, 'status_pv', so.status,
         'ops_afetadas', n, 'pares', pares, 'status_ops', st_ops)
FROM (SELECT sale_order_id, count(*) AS n, sum(quantity) AS pares,
             jsonb_agg(DISTINCT status) AS st_ops
        FROM afetadas GROUP BY 1) a
JOIN sale_orders so ON so.id = a.sale_order_id
UNION ALL
-- ── R4: OCs auto_generated criadas na janela (qualquer notes) ────────────────
SELECT 'R4_ocs_auto', row_number() OVER (ORDER BY po.created_at)::int,
       jsonb_build_object('oc', po.order_number, 'criada', po.created_at::date,
         'fornecedor', po.supplier_name, 'status', po.status, 'source', po.source_type,
         'notes', left(COALESCE(po.notes,''), 120),
         'itens', (SELECT jsonb_agg(jsonb_build_object('prod', pp.name, 'qtd', poi.quantity))
                     FROM purchase_order_items poi JOIN products pp ON pp.id = poi.product_id
                    WHERE poi.purchase_order_id = po.id))
FROM purchase_orders po, params
WHERE po.auto_generated = true AND po.created_at >= params.win_start
UNION ALL
-- ── R5: itens de SOLADO adicionados a OCs na janela (pega acúmulos) ──────────
SELECT 'R5_itens_solado', row_number() OVER (ORDER BY poi.created_at)::int,
       jsonb_build_object('oc', po.order_number, 'status_oc', po.status,
         'item_criado', poi.created_at::date, 'prod', pp.name, 'cor', pp.color,
         'qtd', poi.quantity, 'grade', poi.grade)
FROM purchase_order_items poi
JOIN purchase_orders po ON po.id = poi.purchase_order_id
JOIN products pp ON pp.id = poi.product_id, params
WHERE poi.created_at >= params.win_start
  AND (LOWER(COALESCE(pp.category,'')) LIKE '%solado%' OR pp.sole_classification IS NOT NULL)
ORDER BY 1, 2;
