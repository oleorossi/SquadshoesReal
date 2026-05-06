-- =============================================================================
-- NF-e: gravar protocolo de cancelamento da SEFAZ
-- =============================================================================
--
-- A edge function `cancel-nfe` recebia o protocolo de cancelamento da Focus
-- NFe (resposta `focusData.protocolo` no DELETE) mas não persistia esse valor
-- em lugar nenhum — só gravava `data_cancelamento`, `justificativa_cancelamento`
-- e `status = 'cancelada'`. Sem o protocolo do evento de cancelamento, não há
-- prova fiscal de que a SEFAZ aceitou a operação.
--
-- Esta migration adiciona a coluna `protocolo_cancelamento` em `nfe_emitidas`.
-- A coluna `protocolo` já existente continua dedicada ao protocolo de
-- AUTORIZAÇÃO (emissão), não devendo ser sobrescrita pelo cancelamento.
-- =============================================================================

ALTER TABLE public.nfe_emitidas
  ADD COLUMN IF NOT EXISTS protocolo_cancelamento text;

COMMENT ON COLUMN public.nfe_emitidas.protocolo_cancelamento IS
  'Protocolo do evento de cancelamento retornado pela SEFAZ '
  '(distinto de `protocolo` que guarda o protocolo de autorização).';
