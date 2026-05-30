-- =============================================================================
-- CRM: external_contact_name — contato livre fora da base de clientes (2026-05-29)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-29.
-- Arquivo no repo pra histórico.
--
-- Permite registrar interação/agendamento com prospect/lead que ainda não
-- foi cadastrado como cliente. client_id já era nullable; ganha coluna
-- complementar pra exibir nome no histórico/sino sem precisar criar
-- cliente fictício.
--
-- Constraint crm_interactions_has_identification garante que pelo menos
-- uma identificação (client_id OU external_contact_name) esteja presente.
-- =============================================================================

ALTER TABLE public.crm_interactions
  ADD COLUMN IF NOT EXISTS external_contact_name text;

ALTER TABLE public.crm_interactions
  DROP CONSTRAINT IF EXISTS crm_interactions_has_identification;

ALTER TABLE public.crm_interactions
  ADD CONSTRAINT crm_interactions_has_identification
  CHECK (
    client_id IS NOT NULL
    OR (external_contact_name IS NOT NULL AND length(trim(external_contact_name)) > 0)
  );
