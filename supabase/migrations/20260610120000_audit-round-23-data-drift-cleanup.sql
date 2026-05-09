-- Round 23: cleanup de drift de dados encontrados em auditoria
-- Idempotente. Não cria triggers AFTER UPDATE/DELETE em material_reservations
-- (risco de duplo decremento com funções legacy convert/debit — ver migration round 6).

-- 1) Backfill products.reserved_stock = SUM real de reservas ativas (8 produtos com drift)
WITH active_reservations AS (
  SELECT product_id, SUM(quantity_reserved - COALESCE(quantity_consumed, 0)) AS tot
  FROM material_reservations WHERE status = 'active'
  GROUP BY product_id
)
UPDATE products p
SET reserved_stock = COALESCE(ar.tot, 0)
FROM products p2
LEFT JOIN active_reservations ar ON ar.product_id = p2.id
WHERE p.id = p2.id
  AND p.reserved_stock <> COALESCE(ar.tot, 0);

-- 2) Inserir 9 stages canônicos para 4 OPs Finalizadas órfãs do PV-2026-00084
--    (criadas em 2026-04-19, finalizadas em 2026-05-04, antes do init_order_stages estar consolidado)
INSERT INTO order_stages (order_id, stage_name, stage_order, status, completed_at, quantity_total, quantity_processed)
SELECT
  o.id,
  st.stage_name,
  st.stage_order,
  'concluido',
  o.updated_at,
  o.quantity,
  o.quantity
FROM orders o
CROSS JOIN (VALUES
  ('Corte Palmilha', 1),
  ('Corte Forração', 2),
  ('Aviamento',      3),
  ('Silk',           4),
  ('Colagem',        5),
  ('Montagem',       6),
  ('Solagem',        7),
  ('Acabamento',     8),
  ('Expedição',     10)
) AS st(stage_name, stage_order)
WHERE o.id IN (
  '073de78c-1301-40ac-b9ad-bb0b01256392',
  '853c3b35-e0fd-45dc-9a0b-e16c1a7af011',
  'd590b381-0ae3-4b72-addf-06a889e7f2f1',
  '7284afa5-ace2-4a71-8fb8-8c59ce5750d2'
)
AND NOT EXISTS (SELECT 1 FROM order_stages WHERE order_id = o.id);

-- 3) Deletar 6 wave_items órfãos (wave_id apontando pra wave deletada)
DELETE FROM production_wave_items wi
WHERE NOT EXISTS (SELECT 1 FROM production_waves WHERE id = wi.wave_id);

-- 4) Associar 22 financial_entries (faturamentos confirmados) à conta bancária default
UPDATE financial_entries
SET bank_account_id = (SELECT id FROM bank_accounts WHERE active = true ORDER BY created_at LIMIT 1)
WHERE bank_account_id IS NULL
  AND status NOT IN ('cancelado', 'cancelled', 'estornado');
