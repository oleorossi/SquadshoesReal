-- =============================================================================
-- Default fiscal/comissão pro simulador Markup
-- =============================================================================
--
-- Adiciona 2 colunas em cost_policies que viram defaults pro
-- PricingByTechnicalSheetPanel (auto-fill no Markup):
--   - default_tax_pct          → impostos % sobre venda (PIS+COFINS+ICMS+ISS)
--   - default_commission_pct   → comissão padrão % sobre venda
-- =============================================================================

ALTER TABLE public.cost_policies
  ADD COLUMN IF NOT EXISTS default_tax_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_commission_pct numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cost_policies.default_tax_pct IS
  'Alíquota total de impostos % sobre venda (PIS+COFINS+ICMS+ISS médios). Preenche o simulador de Markup automaticamente.';

COMMENT ON COLUMN public.cost_policies.default_commission_pct IS
  'Comissão padrão % sobre venda. Preenche o simulador de Markup automaticamente.';
