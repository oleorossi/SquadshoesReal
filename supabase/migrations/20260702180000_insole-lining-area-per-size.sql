-- =============================================================================
-- PALMILHA — Fase 1: área da FORRAÇÃO da palmilha por numeração (separada da placa)
-- =============================================================================
-- A palmilha = PLACA (EVA, base) + FORRAÇÃO (napa). Hoje só existe a área da placa
-- por número (sole_technical_specs.insole_consumption_dm2). A forração precisa de
-- ÁREA PRÓPRIA por número (decisão do usuário 2026-05-31), pois é maior que a placa
-- (sobra/dobra) e vem da napa do forro (lining_material).
--
-- Esta migration apenas CAPTURA o dado novo (não muda nenhum cálculo — isso é a Fase 2).
-- =============================================================================

-- Área da forração da palmilha por solado + numeração (dm²/par)
ALTER TABLE public.sole_technical_specs
  ADD COLUMN IF NOT EXISTS insole_lining_consumption_dm2 numeric;

COMMENT ON COLUMN public.sole_technical_specs.insole_lining_consumption_dm2 IS
  'Área da FORRAÇÃO da palmilha (napa) por par, em dm², por numeração. Distinta de '
  'insole_consumption_dm2 (que é a área da PLACA EVA). Forração usa a napa do forro (lining_material).';

-- Espelho na ficha técnica (puxado do solado via autoFillFromSoleSpecs)
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_lining_consumption numeric;
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_lining_consumption_per_size jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.technical_sheets.insole_lining_consumption_per_size IS
  'Área da forração da palmilha por numeração (dm²/par), herdada do solado. '
  'Consumida da napa do forro (lining_material) quando insole_has_lining=true e não é palmilha pronta.';
