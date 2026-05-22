-- Cadastro de facas de Corte Cabedal por referência.
-- Cada ficha técnica pode definir buckets de tamanho (P/M/G/PP/GG/etc) que
-- agregam numerações específicas. Usado APENAS no setor de Corte Cabedal:
-- na hora de imprimir a ficha de operador, as quantidades são somadas
-- por faca (ex: P=34+35+36) em vez de mostrar número-a-número.
--
-- Estrutura: array ordenado de objetos { label, sizes }.
-- Ordem do array = ordem visual na ficha (PP antes de P, M, G, GG...).
-- Cada size só pode estar em 1 faca (validado no editor frontend).
-- Refs sem cadastro caem no comportamento atual (mostra sizes individuais).
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS knife_size_ranges JSONB DEFAULT NULL;

COMMENT ON COLUMN public.technical_sheets.knife_size_ranges IS
  'Array ordenado de buckets de faca pra Corte Cabedal: [{"label":"P","sizes":["34","35","36"]},...]. NULL = sem cadastro, ficha de Cabedal mostra sizes individuais.';
