-- =============================================================================
-- `v_time_pendings` é a ÚNICA das 5 views do módulo de ponto sem
-- `security_invoker` — logo, a única que entrega registro de ponto de RH a
-- usuário autenticado mas NÃO aprovado.
--
-- O QUE ACONTECE
-- View sem `security_invoker=true` roda com os privilégios do DONO (postgres) e
-- a RLS das tabelas de baixo é avaliada como se o dono estivesse consultando.
-- `public.time_records` tem `relrowsecurity=true` e a policy de SELECT é
-- `is_approved_user()` (migration `20260329195057`), mas essa policy nunca chega
-- a ser testada contra o consultante: a view a contorna por construção. Como o
-- papel `authenticated` tem SELECT na view (`20260914120000`), qualquer usuário
-- que apenas se cadastrou — `profiles.approved = false`, o estado em que o
-- trigger `on_auth_user_created` cria a linha — lê batida de ponto, nome e
-- departamento de funcionário.
--
-- ⚠ O `anon` NÃO é o vetor aqui, e é por isso que a varredura anterior não pegou
-- esta view: `20261122120000` já tinha tirado o `r` do ACL de `anon` em
-- `v_time_pendings`. O furo que sobrou é o degrau de dentro — aprovado × não
-- aprovado —, que só o `security_invoker` fecha.
--
-- POR QUE SÓ ESTA FICOU DE FORA
-- As irmãs ganharam a opção no CREATE: `v_pending_time_records` e
-- `v_employee_pending_summary` em `20260613120002` (`WITH (security_invoker =
-- true)`). `v_time_pendings` nasceu em `20260524170001` com `DROP VIEW` +
-- `CREATE VIEW` **sem** a cláusula, e as redefinições seguintes
-- (`20260914120000`) usaram `CREATE OR REPLACE`, que preserva as opções — ou
-- seja, preservou fielmente a ausência delas. Nunca houve um momento em que a
-- opção existisse e fosse perdida; ela simplesmente nunca foi escrita.
--
-- EXPOSIÇÃO REAL HOJE: ZERO. `profiles` tem 3 usuários, todos aprovados e todos
-- com ao menos um papel entre admin/gerente/rh. Isto é prevenção, não incidente.
--
-- POR QUE É SEGURO PARA AS TELAS LOGADAS
-- Com `security_invoker=true` a view passa a exigir do consultante o SELECT nas
-- 4 relações que ela lê. Todas liberam o usuário aprovado:
--   time_records   → policy SELECT `is_approved_user()`   (20260329195057)
--   employees      → policy SELECT `is_approved_user()`   (20260404020742)
--   work_schedules → policy SELECT `true`                 (20260429240000)
--   holidays       → policy SELECT `true`                 (20260527220000)
-- As funções chamadas no SELECT não mudam de contexto: `security_invoker` altera
-- a checagem de RLS/privilégio das TABELAS, não o `current_user` de uma função.
-- `suggest_punches_for_record` e `get_pending_count_by_employee` já são SECURITY
-- INVOKER e já rodavam como o consultante; `calculate_day_summary` e
-- `get_bank_hours_cutoff` não leem tabela.
--
-- Consumidores (ambos atrás de ProtectedRoute + RouteGuard, módulo `rh`):
--   src/hooks/useTimePendings.ts:89  → /rh/pendencias-ponto (SELECT direto)
--   src/pages/RHHub.tsx:139          → badge, via RPC get_pending_count_by_employee
--                                      (LANGUAGE sql, SECURITY INVOKER, lê a view)
--
-- ⚠ A CONFIRMAR NO BANCO ANTES DE APLICAR (esta sessão não teve acesso ao banco:
-- sem MCP do Supabase, sem psql, e a chave publishable é negada em
-- `get_applied_migrations`). O laudo abaixo veio da varredura que originou esta
-- migration — reproduza antes de aplicar:
--
--   select c.relname, c.reloptions
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('v_time_pendings','v_pending_time_records',
--                        'v_employee_pending_summary','v_employee_punch_pattern');
--   -- esperado ANTES: v_time_pendings = NULL, as outras = {security_invoker=true}
--
--   select has_table_privilege('authenticated','public.v_time_pendings','SELECT');
--   -- esperado ANTES: true
--
-- E DEPOIS de aplicar, com um usuário aprovado do RH logado, conferir que
-- /rh/pendencias-ponto e o badge do RH Hub continuam com a mesma contagem.
-- =============================================================================

ALTER VIEW public.v_time_pendings SET (security_invoker = true);

-- Reafirmação idempotente do ACL. O REVOKE é no-op hoje (`20261122120000` já
-- tirou o `r` do anon) e existe para que uma futura recriação por DROP+CREATE —
-- que devolve a view ao default privilege do Supabase, COM select pra anon — não
-- reabra o buraco em silêncio. Ver a lição de `20261219120000`.
REVOKE SELECT ON public.v_time_pendings FROM anon;
GRANT SELECT ON public.v_time_pendings TO authenticated, service_role;

COMMENT ON VIEW public.v_time_pendings IS
  'Pendências de ponto dos últimos 90 dias úteis (lista /rh/pendencias-ponto e '
  'badge do RH Hub). ⚠ Contém batida de ponto, nome e departamento de '
  'funcionário: precisa de security_invoker=true para herdar a RLS de '
  'time_records (is_approved_user()) — sem ele, usuário autenticado e NÃO '
  'aprovado lê a folha de ponto inteira. Se precisar acrescentar coluna, prefira '
  'CREATE OR REPLACE: DROP+CREATE apaga security_invoker e ACL sem deixar rastro '
  'no diff.';
