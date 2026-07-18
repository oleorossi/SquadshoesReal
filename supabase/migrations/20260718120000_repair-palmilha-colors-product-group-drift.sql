-- Repara drift de schema: technical_sheet_palmilha_colors ficou SEM as colunas
-- palmilha_product_id / palmilha_group_id no banco de produção, apesar das
-- migrations 20260502161405 e 20260502163708 as declararem (ADD COLUMN). Essas
-- ALTERs nunca foram aplicadas no projeto ssvxfoybzmjlypnipqzn (banco ≠ arquivos
-- de migration).
--
-- Sintoma (2026-07-18, log Postgres 19:23): "column
-- technical_sheet_palmilha_colors.palmilha_product_id does not exist". O motor de
-- consumo (src/lib/orderConsumption.ts, fetchConsumptionContext) faz
-- `select(... palmilha_product_id)` dentro de um Promise.all — a coluna ausente
-- derruba TODO o contexto e o modal "Consumo de Materiais" + a ficha de consumo
-- do operador quebram (linhas vazias). O front também GRAVA a coluna
-- (usePalmilhaColorMappings) e a LÊ (TechnicalSheets.tsx), então salvar um pin de
-- produto na forração de palmilha por cor também falhava.
--
-- Idempotente (IF NOT EXISTS) — seguro reaplicar. Mesmo conteúdo das ALTERs
-- originais que faltaram.

ALTER TABLE public.technical_sheet_palmilha_colors
  ADD COLUMN IF NOT EXISTS palmilha_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS palmilha_group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_technical_sheet_palmilha_colors_product_id
  ON public.technical_sheet_palmilha_colors(palmilha_product_id);

CREATE INDEX IF NOT EXISTS idx_palmilha_colors_sheet_id
  ON public.technical_sheet_palmilha_colors(sheet_id);
