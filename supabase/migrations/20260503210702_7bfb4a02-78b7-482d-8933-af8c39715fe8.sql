ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS codigo_municipio text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_cnpj_unique
  ON public.clients (regexp_replace(cnpj, '\D', '', 'g'))
  WHERE cnpj IS NOT NULL
    AND length(regexp_replace(cnpj, '\D', '', 'g')) IN (11, 14);

COMMENT ON COLUMN public.clients.codigo_municipio IS
  '7-digit IBGE municipality code — populated by sync-cnpj-addresses from ViaCEP ibge field. Required for NF-e destinatário.';