-- Corte a fio: quando true, o cabedal não passa por costura (borda crua do corte).
-- Usado pela ficha de operador 'Costura Cabedal' (só camada de impressão).
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS upper_corte_a_fio boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.technical_sheets.upper_corte_a_fio IS
  'Corte a fio: true = cabedal sem costura (não gera ficha Costura Cabedal); false = cabedal vai para costura.';
