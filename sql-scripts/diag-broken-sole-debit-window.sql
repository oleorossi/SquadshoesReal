-- Diagnóstico (SOMENTE LEITURA): janela em que debit_sole_stock_by_grade
-- estava quebrada em produção (22P02 — COALESCE de enum com '' introduzido na
-- 20260902140000; corrigido na 20260910160000 em 2026-07-09).
--
-- Efeito na janela: toda chamada que RESOLVIA solado estourava →
--   • soft (PV create/update/re-debit): a reserva sole_grade não nascia; a
--     pendência sole_pending_grade do hybrid_debit ficava órfã;
--   • fallback de erro autoCreateSolePO criava/acumulava OC automática;
--   • hard (convert_reservation_to_out no faturar, ramo pendência): abortava.
--
-- Saída: linhas (secao, seq, dados jsonb). Uso: workflow supabase-db-exec.yml.
WITH params AS (
  SELECT timestamptz '2026-06-24 00:00-03' AS scan_start,
         timestamptz '2026-07-02 12:00-03' AS win_start_guess
),
ops AS (
  SELECT o.id, o.order_number, o.status, o.created_at, o.updated_at,
         o.quantity, o.grade, o.reference_id, o.color, o.sale_order_id
    FROM orders o, params
   WHERE o.grade IS NOT NULL AND jsonb_typeof(o.grade) = 'object' AND o.grade <> '{}'::jsonb
     AND (o.created_at >= params.scan_start OR o.updated_at >= params.scan_start)
),
op_art AS (
  SELECT ops.*, rsc.sole_product_id, rsc.sole_color,
    EXISTS (SELECT 1 FROM material_reservations mr
             WHERE mr.order_id = ops.id AND mr.metadata->>'kind' = 'sole_grade') AS has_sole_grade,
    EXISTS (SELECT 1 FROM material_reservations mr
             WHERE mr.order_id = ops.id AND mr.metadata->>'kind' = 'sole_pending_grade'
               AND mr.status = 'reserved') AS has_pend_viva,
    EXISTS (SELECT 1 FROM stock_movements sm
             WHERE sm.order_id = ops.id AND sm.movement_type = 'out'
               AND (sm.description LIKE 'Debito Solado por grade%'
                    OR sm.description LIKE 'Conversão Solado por grade%')) AS has_sole_mov
  FROM ops
  LEFT JOIN LATERAL (SELECT * FROM resolve_sole_color(ops.reference_id, COALESCE(ops.color,'')) LIMIT 1) rsc ON true
),
classif AS (
  SELECT a.*,
    CASE
      WHEN a.sole_product_id IS NULL THEN 'NAO_RESOLVE'
      WHEN a.has_sole_grade OR a.has_sole_mov THEN 'OK'
      WHEN a.has_pend_viva THEN 'PENDENCIA_ORFA'
      ELSE 'SEM_RASTRO'
    END AS classe
  FROM op_art a
),
afetadas AS (
  SELECT c.*, p.name AS sole_name, so.order_number AS pv_number
    FROM classif c
    LEFT JOIN products p ON p.id = c.sole_product_id
    LEFT JOIN sale_orders so ON so.id = c.sale_order_id
   WHERE c.classe IN ('PENDENCIA_ORFA', 'SEM_RASTRO')
     AND c.status NOT ILIKE '%cancel%'
),
ocs AS (
  SELECT po.id, po.order_number, po.created_at, po.supplier_name, po.status,
         po.auto_generated, left(COALESCE(po.notes,''), 300) AS notes_head,
         (length(COALESCE(po.notes,'')) - length(replace(COALESCE(po.notes,''), 'Solado insuficiente para OP', '')))
           / length('Solado insuficiente para OP') AS n_acumulos,
         (SELECT jsonb_agg(jsonb_build_object('prod', pp.name, 'cor', pp.color,
                  'qtd', poi.quantity, 'grade', poi.grade) ORDER BY pp.name)
            FROM purchase_order_items poi JOIN products pp ON pp.id = poi.product_id
           WHERE poi.purchase_order_id = po.id) AS itens
    FROM purchase_orders po, params
   WHERE COALESCE(po.notes,'') LIKE '%Solado insuficiente para OP%'
     AND (po.created_at >= params.scan_start OR po.status IN ('pending','approved'))
)
-- ── S1: histograma diário (fixa a data de aplicação da 20260902140000) ──────
SELECT 'S1_histograma' AS secao, row_number() OVER (ORDER BY d)::int AS seq,
       jsonb_build_object('dia', d::date, 'ops_grade', n, 'ok', n_ok,
         'pend_orfa', n_pend, 'sem_rastro', n_sem, 'nao_resolve', n_nr) AS dados
FROM (
  SELECT date_trunc('day', created_at) AS d, count(*) AS n,
         count(*) FILTER (WHERE classe = 'OK') AS n_ok,
         count(*) FILTER (WHERE classe = 'PENDENCIA_ORFA') AS n_pend,
         count(*) FILTER (WHERE classe = 'SEM_RASTRO') AS n_sem,
         count(*) FILTER (WHERE classe = 'NAO_RESOLVE') AS n_nr
    FROM classif GROUP BY 1
) h
UNION ALL
-- ── S2: marcos temporais ─────────────────────────────────────────────────────
SELECT 'S2_marcos', 1, jsonb_build_object(
  'ultima_reserva_sole_grade_pre_janela',
    (SELECT max(mr.created_at) FROM material_reservations mr, params
      WHERE mr.metadata->>'kind' = 'sole_grade' AND mr.created_at < params.win_start_guess),
  'primeira_reserva_sole_grade_pos_janela',
    (SELECT min(mr.created_at) FROM material_reservations mr, params
      WHERE mr.metadata->>'kind' = 'sole_grade' AND mr.created_at >= params.win_start_guess),
  'primeira_pendencia_orfa',
    (SELECT min(a.created_at) FROM afetadas a WHERE a.classe = 'PENDENCIA_ORFA'),
  'primeira_oc_janela',
    (SELECT min(o.created_at) FROM ocs o, params WHERE o.created_at >= params.win_start_guess),
  'ultimo_mov_debito_solado_pre',
    (SELECT max(sm.created_at) FROM stock_movements sm, params
      WHERE (sm.description LIKE 'Debito Solado por grade%' OR sm.description LIKE 'Conversão Solado por grade%')
        AND sm.created_at < params.win_start_guess),
  'primeiro_mov_debito_solado_pos',
    (SELECT min(sm.created_at) FROM stock_movements sm, params
      WHERE (sm.description LIKE 'Debito Solado por grade%' OR sm.description LIKE 'Conversão Solado por grade%')
        AND sm.created_at >= params.win_start_guess))
UNION ALL
-- ── S3: resumo das OPs afetadas por classe × status ─────────────────────────
SELECT 'S3_resumo', row_number() OVER (ORDER BY classe, status)::int,
       jsonb_build_object('classe', classe, 'status_op', status, 'ops', n, 'pares', pares)
FROM (SELECT classe, status, count(*) AS n, sum(quantity) AS pares
        FROM afetadas GROUP BY 1, 2) r
UNION ALL
-- ── S4: OPs afetadas (detalhe, cap 60) ───────────────────────────────────────
SELECT 'S4_ops', row_number() OVER (ORDER BY a.created_at)::int,
       jsonb_build_object('op', a.order_number, 'pv', a.pv_number, 'status', a.status,
         'classe', a.classe, 'criada', a.created_at::date, 'editada', a.updated_at::date,
         'pares', a.quantity, 'cor', a.color, 'solado', a.sole_name, 'cor_solado', a.sole_color,
         'grade', a.grade)
FROM (SELECT * FROM afetadas ORDER BY created_at LIMIT 60) a
UNION ALL
-- ── S5: estoque fantasma por solado (OPs faturadas/finalizadas SEM_RASTRO +
--        PENDENCIA_ORFA já faturada = débito que nunca aconteceu) ─────────────
SELECT 'S5_fantasma', row_number() OVER (ORDER BY pares_nao_debitados DESC)::int,
       jsonb_build_object('solado', sole_name, 'cor', sole_color,
         'ops', n_ops, 'pares_nao_debitados', pares_nao_debitados,
         'stock_grade_atual', (SELECT p2.stock_grade FROM products p2 WHERE p2.id = spid),
         'necessidade_por_numero', need_grade)
FROM (
  SELECT a.sole_product_id AS spid, a.sole_name, a.sole_color, count(*) AS n_ops,
         sum(a.quantity) AS pares_nao_debitados,
         (SELECT jsonb_object_agg(k, v) FROM (
            SELECT key AS k, sum(value::numeric) AS v
              FROM afetadas a2, LATERAL jsonb_each_text(scale_grade_to_total(a2.grade, a2.quantity))
             WHERE a2.sole_product_id = a.sole_product_id
               AND (a2.status ILIKE '%fatur%' OR a2.status ILIKE '%finaliz%' OR a2.status ILIKE '%conclu%' OR a2.status ILIKE '%entreg%')
               AND left(key,1) <> '_' GROUP BY key) g) AS need_grade
    FROM afetadas a
   WHERE a.status ILIKE '%fatur%' OR a.status ILIKE '%finaliz%' OR a.status ILIKE '%conclu%' OR a.status ILIKE '%entreg%'
   GROUP BY 1, 2, 3
) f
UNION ALL
-- ── S6: OCs automáticas de solado na janela / abertas (cap 30) ───────────────
SELECT 'S6_ocs', row_number() OVER (ORDER BY o.created_at)::int,
       jsonb_build_object('oc', o.order_number, 'criada', o.created_at::date,
         'fornecedor', o.supplier_name, 'status', o.status, 'auto', o.auto_generated,
         'n_acumulos', o.n_acumulos, 'itens', o.itens, 'notes', o.notes_head)
FROM (SELECT * FROM ocs ORDER BY created_at LIMIT 30) o
ORDER BY 1, 2;
