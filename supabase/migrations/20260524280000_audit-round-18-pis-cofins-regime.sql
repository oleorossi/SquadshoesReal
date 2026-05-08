-- =============================================================================
-- AUDIT ROUND 18 — PIS/COFINS configurável por regime
-- =============================================================================
-- Hoje emit-nfe usa hardcoded 1.65% (PIS) + 7.60% (COFINS) — alíquotas do
-- regime NÃO-CUMULATIVO (Lucro Real com crédito). Pra empresas em LUCRO
-- PRESUMIDO (regime cumulativo), as alíquotas corretas são:
--   PIS:    0.65%
--   COFINS: 3.00%
--
-- Empresa atual em prod usa regime_tributario='1' (Simples Nacional, CST 49,
-- sem PIS/COFINS) — bug não afeta. Mas gap latente: ao adicionar 2ª empresa
-- em Real Cumulativo, NFe vai emitir tributos 2.5× errados.
--
-- Fix: coluna companies.pis_cofins_regime ('cumulativo' | 'nao_cumulativo').
-- Default 'nao_cumulativo' (mantém comportamento atual). Edge function lê e
-- aplica alíquota correta.
-- =============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS pis_cofins_regime text NOT NULL DEFAULT 'nao_cumulativo'
    CHECK (pis_cofins_regime IN ('cumulativo', 'nao_cumulativo'));

COMMENT ON COLUMN public.companies.pis_cofins_regime IS
  'Regime de tributação PIS/COFINS pra emissão de NF-e:'
  ' "cumulativo" (Lucro Presumido, alíquotas 0.65 + 3.00) ou'
  ' "nao_cumulativo" (Lucro Real, alíquotas 1.65 + 7.60).'
  ' Para Simples Nacional o regime é controlado por regime_tributario=1'
  ' (CST 49, sem PIS/COFINS).';
