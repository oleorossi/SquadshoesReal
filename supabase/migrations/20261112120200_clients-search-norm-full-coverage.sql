-- =============================================================================
-- clients.search_norm — cobrir os campos que a tela já buscava
-- =============================================================================
--
-- Contexto (03/08/2026)
-- ---------------------
-- A listagem de clientes filtrava em JS por
--   razao_social, nome_fantasia, cnpj, cidade, estado, telefone, email,
--   client_number
-- mas `clients.search_norm` só cobria 3 desses (razao_social, nome_fantasia,
-- client_number). Mover a busca pro banco usando a coluna como estava teria
-- REGREDIDO em silêncio: procurar cliente por CNPJ, cidade ou telefone —
-- que funciona hoje — pararia de achar.
--
-- Todos os campos moram na própria `clients`, então não é preciso view: basta
-- ampliar a coluna gerada. Vantagem sobre a view: quem já consome
-- `clients.search_norm` (busca global, seletor de cliente do PV) ganha a
-- cobertura maior de graça.
--
-- Seguro dropar e recriar: não há índice sobre a coluna nem view dependendo
-- dela (verificado em pg_indexes e pg_depend antes da migration).
--
-- `normalize_search` remove tudo que não é [a-z0-9], então CNPJ e telefone
-- ficam só com dígitos — "12.345.678/0001-90" casa "12345678000190" e também
-- a digitação parcial "12345678".
-- =============================================================================

ALTER TABLE public.clients DROP COLUMN IF EXISTS search_norm;

ALTER TABLE public.clients
  ADD COLUMN search_norm text
  GENERATED ALWAYS AS (
    public.normalize_search(
      COALESCE(razao_social, '')   || ' ' ||
      COALESCE(nome_fantasia, '')  || ' ' ||
      COALESCE(client_number, '')  || ' ' ||
      COALESCE(cnpj, '')           || ' ' ||
      COALESCE(cidade, '')         || ' ' ||
      COALESCE(estado, '')         || ' ' ||
      COALESCE(telefone, '')       || ' ' ||
      COALESCE(email, '')
    )
  ) STORED;

COMMENT ON COLUMN public.clients.search_norm IS 'Busca normalizada (sem acento/caixa/pontuacao). Cobre os mesmos campos que a listagem filtrava em JS, inclusive CNPJ, cidade, estado, telefone e email.';
