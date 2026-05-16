-- Etapas do setor Aviamento por ficha técnica. Lista fixa de 3 etapas
-- (Frente, Traseira, Costura de tiras) — usuário marca quais se aplicam
-- a cada ficha. A ficha de operador de Aviamento renderiza um checklist
-- por etapa marcada + por numeração da grade.
--
-- Aplicada via MCP em 2026-05-15.
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS aviamento_steps jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.technical_sheets.aviamento_steps IS
  'Array de strings com etapas de Aviamento que se aplicam à ficha. Valores válidos: "Frente", "Traseira", "Costura de tiras". Renderizado como checklist na ficha de operador de Aviamento.';

-- Backfill defensivo: fichas que já têm Aviamento em production_sectors
-- ganham as etapas padrão Frente+Traseira (comportamento anterior, que
-- mostrava ambas como checkboxes hardcoded em SilkMontageWorkSheet).
UPDATE public.technical_sheets
   SET aviamento_steps = '["Frente","Traseira"]'::jsonb
 WHERE aviamento_steps = '[]'::jsonb
   AND production_sectors @> '["Aviamento"]'::jsonb;
