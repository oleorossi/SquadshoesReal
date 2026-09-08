-- =============================================================================
-- Auditoria de transição de status dos Pedidos de Venda (somente leitura)
-- =============================================================================
-- Espelha as travas de `cancel_sale_order_atomic_internal`
-- (migration 20270101010400): NF-e ativa, OP finalizada, fato físico.
--
-- Como usar:
--   1) Cole o arquivo inteiro no SQL Editor do projeto ssvxfoybzmjlypnipqzn
--      https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/sql/new
--   2) Execute. Sai:
--        • resumo por cancel_block_code
--        • uma linha por PV ativo (deleted_at IS NULL)
--   3) Não grava nada.
--
-- Códigos:
--   ok                     — cancelamento automático permitido
--   PZ112                  — NF-e autorizada/processando/cancelando
--   PZ105_op_finalizada    — alguma OP Finalizado/Concluído
--   PZ105_fato_fisico      — OP aberta com etapa/lote/reserva consumida/consumo
--   PZ110_status           — status do PV fora do allow-list do cancel
--   ja_cancelado           — já Cancelado (noop do writer)
-- =============================================================================

-- ── Resumo ───────────────────────────────────────────────────────────────────
WITH nfe_ativa AS (
  SELECT DISTINCT nfe.sale_order_id
    FROM public.nfe_emitidas nfe
   WHERE nfe.status IN ('autorizada', 'processando', 'cancelando')
),
ops AS (
  SELECT
    o.id,
    o.order_number,
    o.status,
    o.sale_order_id
  FROM public.orders o
  WHERE o.deleted_at IS NULL
    AND o.sale_order_id IS NOT NULL
),
ops_finalizadas AS (
  SELECT DISTINCT sale_order_id
    FROM ops
   WHERE status IN (
     'Finalizado', 'FINALIZADO', 'Concluído', 'Concluido', 'Concluída'
   )
),
-- Mesmas predicados do cancel (por OP aberta, não-finalizada).
fato_por_op AS (
  SELECT
    o.id AS order_id,
    o.order_number,
    o.sale_order_id,
    EXISTS (
      SELECT 1
        FROM public.order_stages os
       WHERE os.order_id = o.id
         AND (
           COALESCE(os.quantity_processed, 0) > 0
           OR os.started_at IS NOT NULL
           OR os.completed_at IS NOT NULL
           OR lower(COALESCE(os.status, '')) NOT IN ('', 'pendente', 'pending')
         )
    ) AS has_stage_fact,
    EXISTS (
      SELECT 1
        FROM public.order_lots ol
       WHERE ol.order_id = o.id
         AND (
           ol.started_at IS NOT NULL
           OR ol.completed_at IS NOT NULL
           OR lower(COALESCE(ol.status, '')) NOT IN ('', 'pendente', 'pending')
         )
    ) AS has_lot_fact,
    EXISTS (
      SELECT 1
        FROM public.material_reservations mr
       WHERE mr.order_id = o.id
         AND (
           COALESCE(mr.quantity_consumed, 0) > 0
           OR mr.consumed_at IS NOT NULL
           OR lower(COALESCE(mr.status, '')) IN (
             'consumed', 'converted', 'pending_reconciliation'
           )
         )
    ) AS has_reservation_fact,
    EXISTS (
      SELECT 1
        FROM public.production_consumptions pc
       WHERE pc.order_id = o.id
         AND pc.superseded_at IS NULL
         AND COALESCE(pc.actual_quantity, 0) > 0
    ) AS has_consumption_fact
  FROM ops o
  WHERE o.status NOT IN (
    'Cancelada', 'Cancelado',
    'Finalizado', 'FINALIZADO',
    'Concluído', 'Concluido', 'Concluída'
  )
),
fato_com_motivo AS (
  SELECT
    sale_order_id,
    order_id,
    order_number,
    concat_ws(
      '+',
      CASE WHEN has_stage_fact THEN 'stage' END,
      CASE WHEN has_lot_fact THEN 'lot' END,
      CASE WHEN has_reservation_fact THEN 'reservation' END,
      CASE WHEN has_consumption_fact THEN 'consumption' END
    ) AS fact_kinds
  FROM fato_por_op
  WHERE has_stage_fact
     OR has_lot_fact
     OR has_reservation_fact
     OR has_consumption_fact
),
fato_agg AS (
  SELECT
    sale_order_id,
    string_agg(
      format('%s (%s) [%s]', order_number, order_id, fact_kinds),
      '; '
      ORDER BY order_number, order_id
    ) AS cancel_block_detail,
    count(*) AS blocking_op_count
  FROM fato_com_motivo
  GROUP BY sale_order_id
),
pares AS (
  SELECT
    soi.sale_order_id,
    COALESCE(sum(soi.quantity), 0)::numeric AS pares
  FROM public.sale_order_items soi
  GROUP BY soi.sale_order_id
),
audit AS (
  SELECT
    so.id AS sale_order_id,
    so.order_number,
    so.status,
    so.client_name,
    so.client_order_number,
    COALESCE(p.pares, 0) AS pares,
    so.total,
    so.nfe_required,
    (nfe.sale_order_id IS NOT NULL) AS nfe_ativa,
    CASE so.status
      WHEN 'Rascunho' THEN ARRAY['Pendente', 'Aprovado', 'Em Produção', 'Cancelado']
      WHEN 'Pendente' THEN ARRAY['Aprovado', 'Em Produção', 'Cancelado', 'Rascunho']
      WHEN 'Aprovado' THEN ARRAY['Em Produção', 'Cancelado', 'Rascunho']
      WHEN 'Em Produção' THEN ARRAY['Faturado', 'Finalizado s/ NF', 'Cancelado']
      WHEN 'Faturado' THEN ARRAY['Expedido', 'Cancelado']
      WHEN 'Expedido' THEN ARRAY['Concluído']
      WHEN 'Concluído' THEN ARRAY[]::text[]
      WHEN 'Finalizado s/ NF' THEN ARRAY[]::text[]
      WHEN 'Cancelado' THEN ARRAY['Rascunho']
      ELSE ARRAY[]::text[]
    END AS allowed_next_statuses,
    CASE
      WHEN so.status = 'Cancelado' THEN 'ja_cancelado'
      WHEN so.status NOT IN (
        'Rascunho', 'Pendente', 'Aprovado', 'Em Produção', 'Faturado', 'Cancelado'
      ) THEN 'PZ110_status'
      WHEN nfe.sale_order_id IS NOT NULL THEN 'PZ112'
      WHEN fin.sale_order_id IS NOT NULL THEN 'PZ105_op_finalizada'
      WHEN fa.sale_order_id IS NOT NULL THEN 'PZ105_fato_fisico'
      ELSE 'ok'
    END AS cancel_block_code,
    CASE
      WHEN so.status = 'Cancelado' THEN 'PV já cancelado'
      WHEN so.status NOT IN (
        'Rascunho', 'Pendente', 'Aprovado', 'Em Produção', 'Faturado', 'Cancelado'
      ) THEN format('Status %s não permite transição para Cancelado', so.status)
      WHEN nfe.sale_order_id IS NOT NULL
        THEN 'PV possui NF-e ativa; cancele a NF-e antes de cancelar o pedido'
      WHEN fin.sale_order_id IS NOT NULL
        THEN 'PV possui OP concluída/finalizada; cancelamento automático recusado'
      WHEN fa.sale_order_id IS NOT NULL THEN fa.cancel_block_detail
      ELSE NULL
    END AS cancel_block_detail,
    COALESCE(fa.blocking_op_count, 0) AS blocking_op_count
  FROM public.sale_orders so
  LEFT JOIN pares p ON p.sale_order_id = so.id
  LEFT JOIN nfe_ativa nfe ON nfe.sale_order_id = so.id
  LEFT JOIN ops_finalizadas fin ON fin.sale_order_id = so.id
  LEFT JOIN fato_agg fa ON fa.sale_order_id = so.id
  WHERE so.deleted_at IS NULL
)
SELECT
  'resumo'::text AS secao,
  cancel_block_code,
  count(*)::bigint AS qtd_pvs,
  sum(pares)::numeric AS pares,
  NULL::text AS order_number,
  NULL::text AS status,
  NULL::text AS client_name,
  NULL::numeric AS total,
  NULL::boolean AS nfe_ativa,
  NULL::boolean AS can_cancel,
  NULL::boolean AS can_revert_aprovado_to_rascunho,
  NULL::text[] AS allowed_next_statuses,
  NULL::text AS cancel_block_detail,
  NULL::bigint AS blocking_op_count,
  NULL::uuid AS sale_order_id
FROM audit
GROUP BY cancel_block_code

UNION ALL

SELECT
  'detalhe'::text AS secao,
  a.cancel_block_code,
  NULL::bigint AS qtd_pvs,
  a.pares,
  a.order_number,
  a.status,
  a.client_name,
  a.total,
  a.nfe_ativa,
  (a.cancel_block_code = 'ok') AS can_cancel,
  (
    a.status = 'Aprovado'
    AND a.cancel_block_code = 'ok'
  ) AS can_revert_aprovado_to_rascunho,
  a.allowed_next_statuses,
  a.cancel_block_detail,
  a.blocking_op_count,
  a.sale_order_id
FROM audit a

ORDER BY
  secao DESC,                          -- resumo primeiro
  cancel_block_code,
  order_number NULLS FIRST;
