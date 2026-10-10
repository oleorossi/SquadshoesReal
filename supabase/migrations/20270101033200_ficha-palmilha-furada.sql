-- Palmilha furada (10/10/2026): especificação da ficha técnica que indica que a
-- palmilha da referência precisa sair FURADA. Só camada de impressão — as
-- fichas de operador de Silk e de Palmilha (Fibra/Forração/Acabamento) mostram
-- um destaque "PALMILHA FURADA". Não altera consumo, débito nem roteiro.
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_perforated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.technical_sheets.insole_perforated IS
  'true = a palmilha desta referência é furada. Destaque nas fichas de operador de Silk e Palmilha. Só impressão.';
