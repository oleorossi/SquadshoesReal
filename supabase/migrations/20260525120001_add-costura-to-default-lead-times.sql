-- =============================================================================
-- Adiciona costura_capacity_per_day em default_lead_times
-- =============================================================================
-- O setor "Costura" foi adicionado em 20260521120000 mas a coluna de capacidade
-- foi criada APENAS em `technical_sheets`. A tabela `default_lead_times` (que
-- guarda fallbacks por categoria) ficou de fora — então quando uma ficha não
-- definia capacidade própria, o sistema caía no default e ficava sem fallback
-- pra Costura, gerando 0 implícito (cap=0 = setor "não tem capacidade" e seria
-- ignorado em alguns checks).
--
-- Esta migration:
--   1. Adiciona a coluna em `default_lead_times` (idempotente).
--   2. Seeds: copia o valor de `sewing_capacity_per_day` como ponto de partida
--      sensato (Costura ≈ Costura de cabedal, mesma ordem de grandeza).
--   3. Atualiza qualquer view que dependa do schema (nenhuma identificada hoje).
-- =============================================================================

ALTER TABLE public.default_lead_times
  ADD COLUMN IF NOT EXISTS costura_capacity_per_day numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.default_lead_times.costura_capacity_per_day IS
  'Capacidade default de Costura por categoria (pares/dia). Fallback quando a '
  'ficha técnica não define costura_capacity_per_day próprio. Adicionado em '
  '20260525120000 em consonância com PR 2 (novo setor Costura).';

-- Seed: copia sewing_capacity_per_day (Corte Palmilha) como aproximação inicial.
-- Costura é geralmente a operação mais rápida do cabedal, então usar essa
-- referência evita capacidades zeradas — admin pode ajustar caso a caso depois
-- via Settings ou direto no SQL.
UPDATE public.default_lead_times
SET costura_capacity_per_day = COALESCE(NULLIF(sewing_capacity_per_day, 0), 200)
WHERE costura_capacity_per_day = 0;
