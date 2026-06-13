-- ════════════════════════════════════════════════════════════════════════
-- Busca insensível a acento/caixa/espaço — paridade server-side com o helper JS
--
-- Problema: `.ilike` do PostgREST é case-insensitive mas SENSÍVEL a acento
-- ('TÂMARA' ilike '%tamara%' = false), então buscar "tamara" não achava a cor
-- "TÂMARA" (NAPA SOFT TÂMARA) na busca global. O helper client-side
-- `normalizeForSearch` (src/lib/searchUtils.ts) já normaliza (lower + sem acento
-- + só alfanumérico) — esta migration espelha EXATAMENTE essa transformação no
-- banco e expõe colunas geradas `search_norm` pro `.ilike` casar igual.
--
-- Tabelas pequenas (clients 42, products 151, sale_orders 51, technical_sheets
-- 43, suppliers 11, economic_groups) → coluna STORED é instantânea; sem índice
-- trigram (desnecessário nessa escala; pg_trgm nem está instalado).
-- ════════════════════════════════════════════════════════════════════════

-- Função IMMUTABLE espelho de normalizeForSearch: lower + unaccent + só [a-z0-9].
-- Usa a forma 2-arg de unaccent com regdictionary (IMMUTABLE, exigência de coluna
-- gerada) e qualifica `extensions.` pra rodar sob search_path restrito da migration.
create or replace function public.normalize_search(text)
returns text
language sql
immutable
parallel safe
strict
as $func$
  select regexp_replace(
           lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce($1, ''))),
           '[^a-z0-9]', '', 'g'
         )
$func$;

comment on function public.normalize_search(text) is
  'Normaliza texto pra busca (lower + sem acento + só alfanumérico). Espelho SQL '
  'do normalizeForSearch (src/lib/searchUtils.ts). Use em colunas geradas search_norm.';

-- Colunas geradas search_norm — cada uma concatena os campos que aquela busca
-- cobre (mesma cobertura que os antigos multiWordOr do GlobalSearch).
alter table public.products add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(name,'') || ' ' || coalesce(sku,'') || ' ' ||
    coalesce(color,'') || ' ' || coalesce(technical_name,'')
  )) stored;

alter table public.clients add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(razao_social,'') || ' ' || coalesce(nome_fantasia,'') || ' ' ||
    coalesce(client_number::text,'')
  )) stored;

alter table public.sale_orders add column if not exists search_norm text
  generated always as (public.normalize_search(coalesce(client_name,''))) stored;

alter table public.technical_sheets add column if not exists search_norm text
  generated always as (public.normalize_search(coalesce(name,''))) stored;

alter table public.suppliers add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(name,'') || ' ' || coalesce(trade_name,'')
  )) stored;

alter table public.economic_groups add column if not exists search_norm text
  generated always as (public.normalize_search(coalesce(name,''))) stored;
