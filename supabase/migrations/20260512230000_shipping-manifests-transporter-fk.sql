-- =============================================================================
-- 20260512230000 — FK ausente: shipping_manifests.transporter_id → transporters.id
-- =============================================================================
-- Sem essa FK, o PostgREST do Supabase não enxerga a relação no schema cache
-- e qualquer query do tipo `.select('*, transporters(name)')` em
-- src/pages/Manifests.tsx falha com:
--   "Could not find a relationship between 'shipping_manifests' and
--    'transporters' in the schema cache"
--
-- Coluna transporter_id já existia há tempo (uuid nullable), só estava sem
-- FK declarada. ON DELETE SET NULL pra preservar histórico de romaneios mesmo
-- que a transportadora seja removida do cadastro.
-- =============================================================================

ALTER TABLE shipping_manifests
  ADD CONSTRAINT shipping_manifests_transporter_id_fkey
  FOREIGN KEY (transporter_id) REFERENCES transporters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shipping_manifests_transporter_id
  ON shipping_manifests(transporter_id);

NOTIFY pgrst, 'reload schema';
