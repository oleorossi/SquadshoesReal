-- Fase 0 (custeio): havia 2 cost_policies ativas → a função de custo fazia WHERE active
-- LIMIT 1 e pegava uma não-determinística. Mantém a mais recente (created_at) ativa, desativa
-- as demais, e trava recorrência com índice parcial único. Valores das 2 eram iguais
-- (overhead=0, embalagem=0) → custo não muda, só o determinismo. Aplicada via Supabase MCP.
UPDATE public.cost_policies
SET active = false
WHERE active = true
  AND id <> (SELECT id FROM public.cost_policies WHERE active ORDER BY created_at DESC LIMIT 1);

CREATE UNIQUE INDEX IF NOT EXISTS cost_policies_one_active
ON public.cost_policies (active) WHERE active;
