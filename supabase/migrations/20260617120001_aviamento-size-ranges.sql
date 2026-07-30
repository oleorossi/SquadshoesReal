-- ════════════════════════════════════════════════════════════════════════
-- Range Aviamento — faixas P/M/G PRÓPRIAS do setor de Aviamento.
--
-- Segmento INDEPENDENTE das facas de Corte Cabedal (knife_size_ranges): o
-- Aviamento monta o cabedal de sandálias de tira, que normalmente NÃO têm faca
-- de corte. Cada referência pode definir suas próprias faixas (P/M/G) e a ficha
-- de operador de Aviamento agrupa as numerações por faixa em vez de número-a-
-- número. (Pedido user 2026-06-17.)
--
-- Semântica idêntica ao padrão JSONB já usado no projeto:
--   NULL  → herda o padrão global (system_settings.key='aviamento_pmg_default').
--   []    → opt-out explícito (mostra numerações individuais).
--   [...] → faixas próprias desta referência: [{label, sizes[]}].
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE technical_sheets
  ADD COLUMN IF NOT EXISTS aviamento_size_ranges jsonb;

COMMENT ON COLUMN technical_sheets.aviamento_size_ranges IS
  'Faixas P/M/G do setor de Aviamento (independente de knife_size_ranges). '
  'NULL=herda padrão global aviamento_pmg_default; []=sem faixa (numeração '
  'individual); [{label,sizes[]}]=faixas próprias da referência.';
