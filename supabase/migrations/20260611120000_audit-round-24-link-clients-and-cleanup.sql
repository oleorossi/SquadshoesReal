-- Round 24: limpeza adicional pós-auditoria

-- 1) Linkar 20 sale_orders ao cliente correto via CNPJ normalizado (14 dígitos)
--    Ficam fora 2 PVs do "LOJÃO DE NITEROI" sem CNPJ — esses precisam input manual.
UPDATE sale_orders so
SET client_id = c.id
FROM clients c
WHERE so.client_id IS NULL
  AND so.status NOT IN ('cancelado', 'cancelled')
  AND length(regexp_replace(COALESCE(so.client_cnpj, ''), '[^0-9]', '', 'g')) = 14
  AND regexp_replace(COALESCE(c.cnpj, ''),  '[^0-9]', '', 'g')
    = regexp_replace(COALESCE(so.client_cnpj, ''), '[^0-9]', '', 'g');

-- 2) Limpar 20 stock_movements com quantity=0 (noise legacy de mar/2026 — cálculos
--    que retornaram 0 pares ou estornos triviais; previous_stock = new_stock confirma
--    que não houve movimentação real de estoque)
DELETE FROM stock_movements
WHERE quantity = 0
  AND previous_stock = new_stock;

-- 3) Indexar 2 FKs descobertas sem índice
CREATE INDEX IF NOT EXISTS idx_fk_bank_hours_movements_created_by
  ON bank_hours_movements(created_by);
CREATE INDEX IF NOT EXISTS idx_fk_payroll_runs_created_by
  ON payroll_runs(created_by);
