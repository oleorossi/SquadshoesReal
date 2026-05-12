-- =============================================================================
-- 20260512190000 — Zerar defaults overhead + embalagem em cost_policies
-- =============================================================================
-- Defaults antigos (1.20 overhead, 0.80 embalagem) inflavam custo de produtos
-- novos sem que o user soubesse. Decisão: zerar pra que o user preencha
-- manualmente quando souber o valor real. Embalagem agora vai ser preenchida
-- por modelo no setor de Embalagens, não como flat global.
-- =============================================================================

ALTER TABLE public.cost_policies
  ALTER COLUMN overhead_rate_per_pair SET DEFAULT 0,
  ALTER COLUMN packaging_cost_per_pair SET DEFAULT 0;

UPDATE public.cost_policies
   SET overhead_rate_per_pair = 0,
       packaging_cost_per_pair = 0,
       updated_at = now()
 WHERE overhead_rate_per_pair > 0 OR packaging_cost_per_pair > 0;
