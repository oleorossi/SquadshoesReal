# Organizar Supabase — reduzir superfície PostgREST

## Problema

Em 28/09/2026 a API REST caiu com `PGRST002` / `57014` ao montar o schema
cache. O site na Vercel servia HTML/JS; o PostgREST não conseguia introspectar
`public` (centenas de funções + ~120 views). Storage e Auth degradaram em
cascata por esgotamento de conexões.

## Decisão

1. **Timeout do `authenticator`** — schema cache sem teto (`statement_timeout=0`).
   Queries de `anon`/`authenticated` continuam com os tetos atuais.
2. **Schema `private`** — implementação interna, sem `USAGE` para roles de API.
   PostgREST só expõe `public` (+ `graphql_public`).
3. **Mover órfãos** — views/funções que o app não chama e sem dependentes
   `public` (checagem `pg_depend`) vão para `private`.

## Migration

`supabase/migrations/20270101029600_organize_postgrest_private_surface.sql`

## O que NÃO se move nesta fase

| Objeto | Por quê |
|---|---|
| RPCs do frontend/edge (~232 + 41) | quebraria o app |
| `apontar_producao_setor_impl` | wrapper public chama `public.*` |
| `trigger_*_cron` | `cron.schedule` referencia `public.*` |
| `run_*_parity*` / `run_*_guard*` / integration tests | SystemDiagnostics + `test:db` |
| Helpers `_calc_*` / `_resolve_*` | callers SQL usam `public._*` — fase 2 |

## Próximas fases (quando a API estiver estável)

1. Reescrever callers dos helpers `_*%` para `private.*` e mover.
2. Avaliar schema `api` fino (views thin) se o cache ainda pesar.
3. Regenerar `src/integrations/supabase/types.ts` após o move.
4. Revisar views legadas ainda em `public` só por relatório SQL.