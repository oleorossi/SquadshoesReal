-- ============================================================================
-- Regularização do furo de baixa do PV-00145 — ENTRADA + BAIXA COMPENSATÓRIA
--
-- CONTEXTO
-- As OPs OP-2026-01142 / OP-2026-01143 (PV-00145, 2.208 pares de S-039) foram
-- finalizadas em 22/07 SEM debitar 22 pares (OP × produto) de material — 26
-- linhas de production_consumptions com standard_quantity > 0 e
-- actual_quantity = 0, marcadas pelo próprio sistema como "sem débito
-- registrado (possível furo de baixa)".
--
-- CAUSA (ver migration 20260925120000): as OPs foram reservadas em 08/07 contra
-- a ficha S-039 como ela era então; componentes acrescentados depois nunca foram
-- reservados, e a baixa na finalização converte RESERVA em stock_movements.
-- A maioria das reservas dessas OPs ficou em 'cancelled', não 'converted'.
--
-- ESTRATÉGIA ESCOLHIDA: entrada + baixa compensatória.
--   * ENTRADA ('in')  = a compra que nunca foi lançada no sistema.
--   * BAIXA   ('out') = o consumo de produção que de fato aconteceu.
--   * Efeito líquido em products.quantity: ZERO. Nenhum saldo de prateleira
--     muda. `stock_movements` não tem trigger que altere products.quantity —
--     verificado: os 3 triggers da tabela só preenchem reason/unit_price/user.
--   * Resultado: histórico auditável (dá pra ver o que entrou e o que saiu),
--     custo real preenchido, e o alerta de furo deixa de aparecer.
--
-- O solado ("01", 1.104 pares em cada OP) NÃO precisa de mexida em stock_grade:
-- entrada e baixa se anulam, então a grade por numeração fica intacta.
--
-- IDEMPOTENTE: o guard `NOT EXISTS (... description LIKE 'Regularizacao PV-00145%')`
-- impede relançar. Rodar duas vezes não duplica nada.
--
-- COMO RODAR
--   SQL Editor: https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/sql/new
--   Cole o arquivo inteiro e execute. Confira a saída dos dois SELECTs de
--   verificação no fim (esperado: 22 pares regularizados, 0 furos restantes,
--   e os saldos idênticos aos de antes).
-- ============================================================================

BEGIN;

-- ── PASSO 0 — Retrato ANTES (guarde o resultado para comparar) ───────────────
SELECT 'ANTES' AS momento, p.name AS produto, p.quantity AS saldo, p.reserved_stock
  FROM products p
 WHERE p.id IN (
   SELECT DISTINCT pc.product_id FROM production_consumptions pc
    WHERE pc.order_id IN ('2732b2ee-4f56-4d47-b32d-29c3b883ff53',
                          '598cb315-3097-42f1-ad2b-07efa514b9e8')
      AND pc.standard_quantity > 0 AND pc.actual_quantity = 0 AND pc.superseded_at IS NULL)
 ORDER BY p.name;

-- ── PASSO 1 — Lança o par entrada + baixa por (OP × produto) ────────────────
WITH furos AS (
  SELECT pc.order_id, pc.product_id,
         sum(pc.standard_quantity) AS qty
    FROM production_consumptions pc
   WHERE pc.order_id IN ('2732b2ee-4f56-4d47-b32d-29c3b883ff53',
                         '598cb315-3097-42f1-ad2b-07efa514b9e8')
     AND pc.standard_quantity > 0
     AND pc.actual_quantity = 0
     AND pc.superseded_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM stock_movements sm
                      WHERE sm.order_id = pc.order_id
                        AND sm.product_id = pc.product_id
                        AND sm.description LIKE 'Regularizacao PV-00145%')
   GROUP BY pc.order_id, pc.product_id
),
novos AS (
  SELECT f.order_id, f.product_id, f.qty, COALESCE(p.quantity, 0) AS est
    FROM furos f JOIN products p ON p.id = f.product_id
),
ent AS (
  INSERT INTO stock_movements
    (product_id, order_id, movement_type, quantity, previous_stock, new_stock, description)
  SELECT product_id, order_id, 'in', qty, est, est + qty,
         'Regularizacao PV-00145 - entrada de compra nao lancada (retroativa)'
    FROM novos
  RETURNING id
),
sai AS (
  INSERT INTO stock_movements
    (product_id, order_id, movement_type, quantity, previous_stock, new_stock, description)
  SELECT product_id, order_id, 'out', qty, est + qty, est,
         'Regularizacao PV-00145 - consumo de producao nao debitado (retroativa)'
    FROM novos
  RETURNING id
)
SELECT (SELECT count(*) FROM ent) AS entradas_lancadas,
       (SELECT count(*) FROM sai) AS baixas_lancadas,
       (SELECT count(*) FROM novos) AS pares_regularizados;

-- ── PASSO 2 — Fecha o real em production_consumptions ───────────────────────
-- O consumo REAL passa a ser o padrão (a produção saiu conforme a ficha), então
-- a variância zera e o alerta de furo desaparece dos relatórios de custo.
UPDATE production_consumptions pc
   SET actual_quantity = pc.standard_quantity,
       actual_cost     = pc.standard_cost,
       variance_quantity = 0,
       variance_cost     = 0,
       notes = 'regularizado: entrada + baixa compensatoria lancadas retroativamente (furo de baixa PV-00145)',
       updated_at = now()
 WHERE pc.order_id IN ('2732b2ee-4f56-4d47-b32d-29c3b883ff53',
                       '598cb315-3097-42f1-ad2b-07efa514b9e8')
   AND pc.standard_quantity > 0
   AND pc.actual_quantity = 0
   AND pc.superseded_at IS NULL;

-- ── PASSO 3 — Verificação: saldos NÃO podem ter mudado ──────────────────────
SELECT 'DEPOIS' AS momento, p.name AS produto, p.quantity AS saldo, p.reserved_stock
  FROM products p
 WHERE p.id IN (
   SELECT DISTINCT sm.product_id FROM stock_movements sm
    WHERE sm.description LIKE 'Regularizacao PV-00145%')
 ORDER BY p.name;

-- ── PASSO 4 — Verificação: nenhum furo restante nessas OPs ──────────────────
SELECT count(*) AS furos_restantes
  FROM production_consumptions pc
 WHERE pc.order_id IN ('2732b2ee-4f56-4d47-b32d-29c3b883ff53',
                       '598cb315-3097-42f1-ad2b-07efa514b9e8')
   AND pc.standard_quantity > 0
   AND pc.actual_quantity = 0
   AND pc.superseded_at IS NULL;

-- ── PASSO 5 — Verificação: entrada e baixa batem (líquido zero) ─────────────
SELECT p.name AS produto,
       sum(CASE WHEN sm.movement_type = 'in'  THEN sm.quantity ELSE 0 END) AS entrou,
       sum(CASE WHEN sm.movement_type = 'out' THEN sm.quantity ELSE 0 END) AS saiu,
       sum(CASE WHEN sm.movement_type = 'in'  THEN sm.quantity ELSE -sm.quantity END) AS liquido
  FROM stock_movements sm
  JOIN products p ON p.id = sm.product_id
 WHERE sm.description LIKE 'Regularizacao PV-00145%'
 GROUP BY p.name
 ORDER BY p.name;

-- Se os 5 passos vierem como esperado (22 pares, 0 furos restantes, líquido 0
-- em todos os produtos, saldos DEPOIS == ANTES), confirme:
COMMIT;
-- Se algo vier diferente do esperado, rode:  ROLLBACK;
