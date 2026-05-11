-- Armazena o id interno da NF-e no provedor (GestaoClick) pra fechar o ciclo
-- de consulta/cancelamento/sync de status. Diferente de `ref_nfe`, que é
-- nossa referência interna determinística (usada como idempotency key).

ALTER TABLE nfe_emitidas
  ADD COLUMN IF NOT EXISTS provider_nfe_id text;

COMMENT ON COLUMN nfe_emitidas.provider_nfe_id IS
  'ID interno da NF-e no GestaoClick (api.gestaoclick.com). Necessário para chamadas de consultar/cancelar/visualizar.';

CREATE INDEX IF NOT EXISTS idx_nfe_emitidas_provider_nfe_id
  ON nfe_emitidas (provider_nfe_id);
