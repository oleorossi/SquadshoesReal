-- Flag pra marcar se o cliente é optante do Simples Nacional.
-- Campo separado do indicador_ie (que classifica pra ICMS: Contribuinte /
-- Isento / Não-contribuinte). É informação de regime tributário do
-- DESTINATÁRIO, útil pra controle comercial.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS optante_simples_nacional boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.clients.optante_simples_nacional IS
  'Cliente é optante do Simples Nacional (sim/não). Separado do indicador_ie (que é sobre ICMS).';
