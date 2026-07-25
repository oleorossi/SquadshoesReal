-- ============================================================================
-- Regularização do furo de baixa do PV-00141 — ENTRADA + BAIXA COMPENSATÓRIA
--
-- ⚠ NÃO FOI EXECUTADO. Este arquivo existe pra o usuário rodar quando decidir.
--    Ele MEXE EM HISTÓRICO DE ESTOQUE (saldo líquido zero, mas grava movimentos).
--
-- CONTEXTO
-- As OPs OP-2026-01125 / OP-2026-01126 / OP-2026-01127 (PV-00141, 1.200 pares
-- da referência d38386d2-ae3c-4364-86e0-542afbbcf803) foram finalizadas e
-- faturadas com ZERO material_reservations e ZERO stock_movements — nada saiu
-- do estoque no sistema. Sobraram 40 linhas de production_consumptions com
-- standard_quantity > 0 e actual_quantity = 0, marcadas pelo próprio ERP como
-- "sem débito registrado (possível furo de baixa)". São 16 product_id distintos
-- (14 NOMES — "TIRA OVERLOCK 5MM: CARAMELO" e "Tira Overlock 5mm: Off White"
-- aparecem em dois cadastros diferentes cada) e R$ 8.622,61 de material.
-- Agregado por NOME:
--
--   01 (solado)                    1.200,0000 par   R$ 2.280,00
--   Binóculo 10mm                  4.800,0000 un    R$   480,00
--   CAIXA COLMEIA 11                  99,6000 un    R$   547,80
--   CAIXA INDIVIDUAL 11            1.200,0000 un    R$ 1.800,00
--   COLA  ADESIVO HOTMELT              0,0120 kg    R$     0,06
--   COLA FORTE                         0,3000 kg    R$     5,46
--   COLA PVC                          27,9960 kg    R$   503,78
--   EVA 3MM                           24,0396 m     R$   216,36
--   LINHANYL                           1,0800 kg    R$    48,60
--   NAPA SUDANI                       57,5000 m     R$   767,05
--   PALMILHA: OURO LIGHT              11,8404 m     R$   106,56
--   TIRA OVERLOCK 5MM: CARAMELO      789,6000 m     R$   671,16
--   Tira Overlock 5mm: Off White     973,8400 m     R$   827,76
--   TIRA OVERLOCK 5MM: OURO LIGHT    432,9600 m     R$   368,02
--
-- CAUSA (diferente do PV-00145): não foi reserva DEFASADA, foi reserva NENHUMA.
-- O trigger tg_sync_orders_from_sale_order_item envolvia cada chamada de reserva
-- em BEGIN/EXCEPTION WHEN OTHERS → RAISE WARNING (mig 20260611132747), pra "não
-- quebrar a edição do PV". Todas falharam, o WARNING morreu no log do Postgres,
-- e a OP nasceu sem reserva. Como a baixa na finalização converte RESERVA em
-- stock_movements, material sem reserva nunca é debitado.
-- A prevenção está na migration 20260925133000_stock-debit-hole-prevention.sql
-- (a falha agora marca material_status='erro_reserva' e grava em
-- production_alerts). Esta regularização é do dado HISTÓRICO.
--
-- ESTRATÉGIA (idêntica à do PV-00145 — sql-scripts/fix-furo-baixa-pv-00145.sql):
--   * ENTRADA ('in')  = a compra que nunca foi lançada no sistema.
--   * BAIXA   ('out') = o consumo de produção que de fato aconteceu.
--   * Efeito líquido em products.quantity: ZERO. Nenhum saldo de prateleira
--     muda. `stock_movements` não tem trigger que altere products.quantity —
--     os 3 triggers da tabela só preenchem reason/unit_price/user.
--   * Resultado: histórico auditável, custo real preenchido, e o alerta de furo
--     deixa de aparecer em list_stock_debit_holes()/production_alerts.
--
-- O solado "01" (1.200 pares) NÃO precisa de mexida em stock_grade: entrada e
-- baixa se anulam, então a grade por numeração fica intacta.
--
-- IDEMPOTENTE: o guard `NOT EXISTS (... description LIKE 'Regularizacao PV-00141%')`
-- impede relançar. Rodar duas vezes não duplica nada.
--
-- COMO RODAR
--   SQL Editor: https://supabase.com/dashboard/project/ssvxfoybzmjlypnipqzn/sql/new
--   Cole o arquivo inteiro e execute. Confira a saída dos SELECTs de verificação
--   no fim. ESPERADO (conferido no banco em 2026-07-25): 40 linhas de
--   production_consumptions (14 + 14 + 12 nas três OPs) colapsam em 33 pares
--   (OP × produto) — algumas OPs têm 2 linhas do mesmo produto, por isso 33 e
--   não 40 —, logo 33 entradas + 33 baixas; 0 furos restantes; líquido 0 em
--   todos os produtos; saldos DEPOIS == ANTES.
-- ============================================================================

BEGIN;

-- ── PASSO 0 — Retrato ANTES (guarde o resultado para comparar) ───────────────
SELECT 'ANTES' AS momento, p.name AS produto, p.unit, p.quantity AS saldo, p.reserved_stock
  FROM products p
 WHERE p.id IN (
   SELECT DISTINCT pc.product_id FROM production_consumptions pc
    WHERE pc.order_id IN ('9b0e82fb-778e-4456-911b-5bd9c12b1d71',
                          '8724a734-2f24-43df-9c09-4555cdb00b5e',
                          'd7997ffe-6015-4ce7-b9cf-f1f839b6f18b')
      AND pc.standard_quantity > 0 AND pc.actual_quantity = 0 AND pc.superseded_at IS NULL)
 ORDER BY p.name;

-- ── PASSO 1 — Lança o par entrada + baixa por (OP × produto) ────────────────
WITH furos AS (
  SELECT pc.order_id, pc.product_id,
         sum(pc.standard_quantity) AS qty
    FROM production_consumptions pc
   WHERE pc.order_id IN ('9b0e82fb-778e-4456-911b-5bd9c12b1d71',
                         '8724a734-2f24-43df-9c09-4555cdb00b5e',
                         'd7997ffe-6015-4ce7-b9cf-f1f839b6f18b')
     AND pc.standard_quantity > 0
     AND pc.actual_quantity = 0
     AND pc.superseded_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM stock_movements sm
                      WHERE sm.order_id = pc.order_id
                        AND sm.product_id = pc.product_id
                        AND sm.description LIKE 'Regularizacao PV-00141%')
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
         'Regularizacao PV-00141 - entrada de compra nao lancada (retroativa)'
    FROM novos
  RETURNING id
),
sai AS (
  INSERT INTO stock_movements
    (product_id, order_id, movement_type, quantity, previous_stock, new_stock, description)
  SELECT product_id, order_id, 'out', qty, est + qty, est,
         'Regularizacao PV-00141 - consumo de producao nao debitado (retroativa)'
    FROM novos
  RETURNING id
)
SELECT (SELECT count(*) FROM ent) AS entradas_lancadas,
       (SELECT count(*) FROM sai) AS baixas_lancadas,
       (SELECT count(*) FROM novos) AS pares_regularizados;

-- ── PASSO 2 — Fecha o real em production_consumptions ───────────────────────
-- O consumo REAL passa a ser o padrão (a produção saiu conforme a ficha), então
-- a variância zera e o alerta de furo desaparece dos relatórios de custo.
--
-- ⚠ O EXISTS é obrigatório: só fecha a linha que REALMENTE ganhou o par
-- entrada+baixa no PASSO 1. Sem ele, uma linha cujo product_id não casa com
-- `products` (o PASSO 1 dropa no JOIN) sairia do relatório de furo sem nunca
-- ter sido regularizada — o furo viraria invisível em vez de resolvido.
UPDATE production_consumptions pc
   SET actual_quantity = pc.standard_quantity,
       actual_cost     = pc.standard_cost,
       variance_quantity = 0,
       variance_cost     = 0,
       notes = 'regularizado: entrada + baixa compensatoria lancadas retroativamente (furo de baixa PV-00141)',
       updated_at = now()
 WHERE pc.order_id IN ('9b0e82fb-778e-4456-911b-5bd9c12b1d71',
                       '8724a734-2f24-43df-9c09-4555cdb00b5e',
                       'd7997ffe-6015-4ce7-b9cf-f1f839b6f18b')
   AND pc.standard_quantity > 0
   AND pc.actual_quantity = 0
   AND pc.superseded_at IS NULL
   AND EXISTS (SELECT 1 FROM stock_movements sm
                WHERE sm.order_id = pc.order_id
                  AND sm.product_id = pc.product_id
                  AND sm.description LIKE 'Regularizacao PV-00141%');

-- ── PASSO 3 — Dispensa o alerta de furo dessas OPs (se existir) ─────────────
-- production_alerts é populada por trg_zzz_flag_stock_debit_holes na finalização
-- (migration 20260925133000). Regularizado o dado, o alerta pode ser dispensado.
UPDATE production_alerts
   SET dismissed_at = now()
 WHERE alert_type = 'furo_baixa'
   AND dismissed_at IS NULL
   AND alert_key IN ('furo_baixa:9b0e82fb-778e-4456-911b-5bd9c12b1d71',
                     'furo_baixa:8724a734-2f24-43df-9c09-4555cdb00b5e',
                     'furo_baixa:d7997ffe-6015-4ce7-b9cf-f1f839b6f18b');

-- ── PASSO 4 — Verificação: saldos NÃO podem ter mudado ──────────────────────
SELECT 'DEPOIS' AS momento, p.name AS produto, p.unit, p.quantity AS saldo, p.reserved_stock
  FROM products p
 WHERE p.id IN (
   SELECT DISTINCT sm.product_id FROM stock_movements sm
    WHERE sm.description LIKE 'Regularizacao PV-00141%')
 ORDER BY p.name;

-- ── PASSO 5 — Verificação: nenhum furo restante nessas OPs ──────────────────
SELECT count(*) AS furos_restantes
  FROM production_consumptions pc
 WHERE pc.order_id IN ('9b0e82fb-778e-4456-911b-5bd9c12b1d71',
                       '8724a734-2f24-43df-9c09-4555cdb00b5e',
                       'd7997ffe-6015-4ce7-b9cf-f1f839b6f18b')
   AND pc.standard_quantity > 0
   AND pc.actual_quantity = 0
   AND pc.superseded_at IS NULL;

-- ── PASSO 6 — Verificação: entrada e baixa batem (líquido zero) ─────────────
SELECT p.name AS produto,
       sum(CASE WHEN sm.movement_type = 'in'  THEN sm.quantity ELSE 0 END) AS entrou,
       sum(CASE WHEN sm.movement_type = 'out' THEN sm.quantity ELSE 0 END) AS saiu,
       sum(CASE WHEN sm.movement_type = 'in'  THEN sm.quantity ELSE -sm.quantity END) AS liquido
  FROM stock_movements sm
  JOIN products p ON p.id = sm.product_id
 WHERE sm.description LIKE 'Regularizacao PV-00141%'
 GROUP BY p.name
 ORDER BY p.name;

-- Se os 6 passos vierem como esperado (33 pares OP×produto regularizados a
-- partir de 40 linhas, 0 furos restantes, líquido 0 em todos os produtos,
-- saldos DEPOIS == ANTES), confirme:
COMMIT;
-- Se algo vier diferente do esperado, rode:  ROLLBACK;
