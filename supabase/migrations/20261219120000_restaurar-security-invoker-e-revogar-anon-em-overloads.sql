-- =============================================================================
-- P0 — `v_production_overloads` voltou a ser legível SEM LOGIN. Regressão minha.
--
-- O QUE ACONTECEU
-- A migration `20261214120000` (métricas honestas) precisava acrescentar duas
-- colunas à view e, como a lista de colunas muda no meio dos UNIONs, usou
-- `DROP VIEW` + `CREATE VIEW`. Isso apagou DUAS proteções que não estavam no
-- corpo do SELECT e por isso passaram despercebidas:
--
--   1. o `WITH (security_invoker = on)` que a view tinha desde a origem
--      (`20260912120100`, reafirmado em `20260913120001`);
--   2. o estado de ACL — view nova nasce com o default privilege do Supabase,
--      que concede SELECT a `anon`.
--
-- ⚠ A LIÇÃO, que vale pra QUALQUER view daqui pra frente: `CREATE OR REPLACE`
-- preserva opções e ACL; `DROP` + `CREATE` **não preserva nada**. Trocar um pelo
-- outro pra "só acrescentar uma coluna" é uma mudança de segurança silenciosa —
-- o diff do SQL parece aditivo e a proteção some sem deixar rastro.
--
-- CONFIRMADO AO VIVO ANTES DESTA MIGRATION (projeto ssvxfoybzmjlypnipqzn):
--   pg_class.reloptions = NULL  (era '{security_invoker=on}')
--   has_table_privilege('anon','public.v_production_overloads','SELECT') = true
--   set role anon; select count(*), count(distinct client_name)
--     from v_production_overloads;  →  30 linhas, 4 clientes
--
-- Ou seja: qualquer requisição com a VITE_SUPABASE_PUBLISHABLE_KEY — que vai no
-- bundle do navegador — lia número de OP, referência, cor, quantidade, número do
-- PV, RAZÃO SOCIAL DO CLIENTE e prazo de entrega, sem autenticação. É exatamente
-- a exposição que `20261122120000` fechou para outras 13 views.
--
-- O CONSERTO segue o padrão daquela migration: o REVOKE é a proteção
-- load-bearing (o `anon` tem grant PRÓPRIO, não herdado de PUBLIC), e o
-- `security_invoker` é restaurado por ser o estado original da view.
-- `authenticated` e `service_role` mantêm SELECT — nenhuma tela logada perde
-- acesso (a view é lida só por `/producao/estouro`, atrás de ProtectedRoute).
-- =============================================================================

ALTER VIEW public.v_production_overloads SET (security_invoker = on);

REVOKE SELECT ON public.v_production_overloads FROM anon;
GRANT SELECT ON public.v_production_overloads TO authenticated, service_role;

COMMENT ON VIEW public.v_production_overloads IS
  'Estouros do motor de produção. ⚠ Contém razão social de cliente e prazo: '
  'NUNCA conceder SELECT a `anon`. Se precisar acrescentar coluna, prefira '
  'CREATE OR REPLACE — DROP+CREATE apaga security_invoker e ACL em silêncio '
  '(foi assim que a exposição sem login voltou em 06/08/2026).';
