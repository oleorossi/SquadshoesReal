-- =============================================================================
-- 20260628120000 — UNIQUE em nfe_emitidas.provider_nfe_id (preparar sync)
-- =============================================================================
--
-- Necessário pra `sync-nfe-from-provider` poder fazer UPSERT idempotente
-- (ON CONFLICT). Índice parcial pra não conflitar com NF-es legadas que ainda
-- não têm provider_nfe_id preenchido (created pelo Focus NFe antigo).

DROP INDEX IF EXISTS public.idx_nfe_emitidas_provider_nfe_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_nfe_emitidas_provider_nfe_id
  ON public.nfe_emitidas (provider_nfe_id)
  WHERE provider_nfe_id IS NOT NULL;

COMMENT ON INDEX public.uq_nfe_emitidas_provider_nfe_id IS
  'Idempotência da sync com GestaoClick: 1 registro local por NF-e do provedor. '
  'Parcial (WHERE NOT NULL) pra não impactar legado sem provider_nfe_id.';
