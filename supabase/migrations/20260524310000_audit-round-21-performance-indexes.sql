-- =============================================================================
-- AUDIT ROUND 21 — Índices defensivos pra performance futura
-- =============================================================================
-- Tabelas hoje pequenas (max ~2400 rows), Postgres faz seq scan rápido.
-- Conforme volume cresce, queries que filtram por data (DRE) ou joinam
-- por FK vão lentar. Índices abaixo cobrem padrões já presentes no
-- código:
--   - DRE inventory variation: filtra stock_movements por created_at range
--   - DRE compras/cashflow: filtra accounts_*/financial_entries por due_date
--   - Workflow OPs: order_stages JOINs por (order_id, status)
--   - RH banco horas: time_records, bank_hours_movements filtram por data
--
-- IF NOT EXISTS — idempotente. Alguns dos nomes podem já existir em
-- versões mais antigas; o INDEX só é criado se ainda não houver.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_sale_order_items_sale_order_id
  ON public.sale_order_items (sale_order_id);

CREATE INDEX IF NOT EXISTS idx_order_stages_order_status
  ON public.order_stages (order_id, status);

CREATE INDEX IF NOT EXISTS idx_order_stages_order_stage_order
  ON public.order_stages (order_id, stage_order);

CREATE INDEX IF NOT EXISTS idx_accounts_receivable_due_date
  ON public.accounts_receivable (due_date)
  WHERE status NOT IN ('cancelled', 'cancelado');

CREATE INDEX IF NOT EXISTS idx_accounts_payable_due_date
  ON public.accounts_payable (due_date)
  WHERE status NOT IN ('cancelled', 'cancelado');

CREATE INDEX IF NOT EXISTS idx_financial_entries_entry_date
  ON public.financial_entries (entry_date);

CREATE INDEX IF NOT EXISTS idx_financial_entries_status
  ON public.financial_entries (status)
  WHERE status IN ('confirmed', 'posted', 'paid', 'reconciled');

CREATE INDEX IF NOT EXISTS idx_time_records_employee_date
  ON public.time_records (employee_external_id, record_date DESC);

CREATE INDEX IF NOT EXISTS idx_time_records_record_date
  ON public.time_records (record_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_hours_movements_employee_date
  ON public.bank_hours_movements (employee_id, movement_date DESC);

CREATE INDEX IF NOT EXISTS idx_order_costs_sale_order_id
  ON public.order_costs (sale_order_id);

CREATE INDEX IF NOT EXISTS idx_material_reservations_order_status
  ON public.material_reservations (order_id, status)
  WHERE status IN ('reserved', 'partially_consumed');

CREATE INDEX IF NOT EXISTS idx_production_consumptions_order_id
  ON public.production_consumptions (order_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_order_id
  ON public.stock_movements (order_id)
  WHERE order_id IS NOT NULL;

ANALYZE public.sale_order_items;
ANALYZE public.order_stages;
ANALYZE public.accounts_receivable;
ANALYZE public.accounts_payable;
ANALYZE public.financial_entries;
ANALYZE public.time_records;
ANALYZE public.bank_hours_movements;
ANALYZE public.order_costs;
ANALYZE public.material_reservations;
ANALYZE public.production_consumptions;
ANALYZE public.stock_movements;
