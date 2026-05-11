-- Sync lazy de clientes/produtos com GestaoClick (ex-ClickNotas, provedor de NF-e).
-- A API exige id_destinatario e produto_id internos do provedor; ao emitir, a
-- edge function emit-nfe cria o cliente/produto se ainda não existe e armazena
-- o id retornado aqui pra reuso nas próximas emissões.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS gestaoclick_id text;

ALTER TABLE technical_sheets
  ADD COLUMN IF NOT EXISTS gestaoclick_id text;

COMMENT ON COLUMN clients.gestaoclick_id IS
  'ID interno do cliente no painel GestaoClick (api.gestaoclick.com). Preenchido lazy na primeira emissão de NF-e.';

COMMENT ON COLUMN technical_sheets.gestaoclick_id IS
  'ID interno do produto no painel GestaoClick. Preenchido lazy na primeira emissão de NF-e que usa essa ref.';
