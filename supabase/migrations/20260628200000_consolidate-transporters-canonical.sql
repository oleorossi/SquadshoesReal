-- Consolidação de transportadoras: `transporters` é a tabela CANÔNICA (4 FKs, schema
-- fiscal completo + gestaoclick_id). `economic_groups.default_transport_company_id` passa
-- a referenciar transporters (antes apontava p/ transport_companies).
-- Pré-condição verificada em 2026-06-28: transporters=0, transport_companies=0,
-- transport_company_rates=0, e TODAS as FKs vazias → NÃO há migração de dado.
-- transport_companies NÃO é dropada aqui (CarriersTab ainda escreve nela; DROP = PR 2).
-- sale_orders.transport_company_id NÃO é dropada (redundante de transporter_id, vazia) —
-- só os leitores de UI são repontados pro embed transporter_id. Idempotente.
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-06-28.
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM economic_groups WHERE default_transport_company_id IS NOT NULL;
  IF v > 0 THEN
    RAISE EXCEPTION 'Abortado: economic_groups.default_transport_company_id tem % valor(es) preenchido(s) — backfill manual antes de repontar a FK.', v;
  END IF;
END $$;

ALTER TABLE economic_groups DROP CONSTRAINT IF EXISTS economic_groups_default_transport_company_id_fkey;
ALTER TABLE economic_groups ADD CONSTRAINT economic_groups_default_transport_company_id_fkey
  FOREIGN KEY (default_transport_company_id) REFERENCES transporters(id) ON DELETE SET NULL;
</content>
