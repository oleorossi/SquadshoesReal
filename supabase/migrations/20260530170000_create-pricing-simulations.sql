-- =============================================================================
-- pricing_simulations — histórico do simulador Markup
-- =============================================================================
--
-- Tabela onde o usuário salva snapshots completos de simulações feitas no
-- PricingByTechnicalSheetPanel. Cada linha contém:
--   - referência da ficha técnica de origem (FK opcional, sheet_id pode virar
--     NULL se a ficha for deletada — preservamos o snapshot)
--   - todos os custos no momento (MP, MO, OH, embalagem, frete)
--   - todos os parâmetros (impostos, factoring, comissão, margem)
--   - resultados (preço sugerido, à vista, lucro real)
--
-- Use case: revisitar margens decididas em PVs anteriores, comparar simulações,
-- justificar variação de preço entre clientes/épocas.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pricing_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid REFERENCES public.technical_sheets(id) ON DELETE SET NULL,
  sheet_code text,
  sheet_name text,
  -- Custos (snapshot do momento)
  material_cost numeric NOT NULL DEFAULT 0,
  labor_cost numeric NOT NULL DEFAULT 0,
  overhead_cost numeric NOT NULL DEFAULT 0,
  packaging_cost numeric NOT NULL DEFAULT 0,
  freight_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  -- Parâmetros (snapshot)
  tax_pct numeric NOT NULL DEFAULT 0,
  factoring_rate_pct numeric NOT NULL DEFAULT 0,
  factoring_days numeric NOT NULL DEFAULT 0,
  factoring_total_pct numeric NOT NULL DEFAULT 0,
  commission_pct numeric NOT NULL DEFAULT 0,
  profit_margin_pct numeric NOT NULL DEFAULT 0,
  -- Resultados (snapshot)
  suggested_price numeric NOT NULL DEFAULT 0,
  cash_price numeric NOT NULL DEFAULT 0,
  real_profit numeric NOT NULL DEFAULT 0,
  -- Metadados
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_simulations_sheet ON public.pricing_simulations(sheet_id);
CREATE INDEX IF NOT EXISTS idx_pricing_simulations_created ON public.pricing_simulations(created_at DESC);

ALTER TABLE public.pricing_simulations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can read pricing_simulations" ON public.pricing_simulations;
CREATE POLICY "Approved users can read pricing_simulations"
ON public.pricing_simulations FOR SELECT
USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can insert pricing_simulations" ON public.pricing_simulations;
CREATE POLICY "Approved users can insert pricing_simulations"
ON public.pricing_simulations FOR INSERT
WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can update own pricing_simulations" ON public.pricing_simulations;
CREATE POLICY "Approved users can update own pricing_simulations"
ON public.pricing_simulations FOR UPDATE
USING (public.is_approved_user() AND created_by = auth.uid());

DROP POLICY IF EXISTS "Approved users can delete own pricing_simulations" ON public.pricing_simulations;
CREATE POLICY "Approved users can delete own pricing_simulations"
ON public.pricing_simulations FOR DELETE
USING (public.is_approved_user() AND created_by = auth.uid());

COMMENT ON TABLE public.pricing_simulations IS
  'Histórico de simulações do Markup. Snapshot completo (custos + parâmetros + resultados) para auditoria de decisões de preço.';
