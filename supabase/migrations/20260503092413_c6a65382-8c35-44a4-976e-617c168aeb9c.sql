ALTER TABLE public.nfe_emitidas
  ADD COLUMN IF NOT EXISTS protocolo_cancelamento text;

COMMENT ON COLUMN public.nfe_emitidas.protocolo_cancelamento IS
  'Protocolo do evento de cancelamento retornado pela SEFAZ '
  '(distinto de `protocolo` que guarda o protocolo de autorização).';