-- =============================================================================
-- Add codigo_municipio to clients + CNPJ uniqueness constraint
-- =============================================================================
-- emit-nfe/index.ts was sending codigo_municipio_destinatario as missing
-- because clients had no such column.  ViaCEP returns ibge (7-digit IBGE code);
-- sync-cnpj-addresses now extracts and persists it.
--
-- Also adds a unique partial index on normalised CNPJ (digits only) to prevent
-- two clients sharing the same CNPJ — which would cause emit-nfe to pick the
-- wrong fiscal record.
-- =============================================================================

-- 1. Add column (idempotent)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS codigo_municipio text;

-- 2. Unique index on normalised CNPJ (digits only, 11 or 14 chars = CPF or CNPJ)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_cnpj_unique
  ON public.clients (regexp_replace(cnpj, '\D', '', 'g'))
  WHERE cnpj IS NOT NULL
    AND length(regexp_replace(cnpj, '\D', '', 'g')) IN (11, 14);

COMMENT ON COLUMN public.clients.codigo_municipio IS
  '7-digit IBGE municipality code — populated by sync-cnpj-addresses from ViaCEP ibge field. Required for NF-e destinatário.';
