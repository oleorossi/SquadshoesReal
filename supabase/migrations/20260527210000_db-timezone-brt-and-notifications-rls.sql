-- Dois fixes de impacto sistêmico encontrados na auditoria:
--
-- =============================================================================
-- 1) Timezone do banco: UTC → America/Sao_Paulo (BRT, UTC-3)
-- =============================================================================
-- 21 migrations usam CURRENT_DATE / now()::date / agora() bare, sem
-- AT TIME ZONE explícito. Em Supabase, o timezone default da sessão é UTC,
-- então todas essas comparações ficam off-by-3-hours em horário noturno BRT.
--
-- Exemplo do bug em auto_start_due_waves (20260429010911):
--   - 2026-05-06 22:00 BRT = 2026-05-07 01:00 UTC
--   - CURRENT_DATE retorna '2026-05-07' (UTC)
--   - Wave com corte_start_date='2026-05-07' auto-start 3h antes do planejado
--
-- Setando o timezone default do DB para BRT, todas as 21 ocorrências de
-- CURRENT_DATE/now() automaticamente retornam o "hoje" do calendário civil
-- brasileiro, sem precisar mexer em cada migration.
--
-- O storage de timestamptz é UTC interno (não muda); só a renderização e o
-- comportamento de CURRENT_DATE/now() mudam.

ALTER DATABASE postgres SET timezone TO 'America/Sao_Paulo';

-- =============================================================================
-- 2) RLS de notifications: USING(true) → proteção por user_id
-- =============================================================================
-- A policy rls_notifications_all (20260429240000) era
--   FOR ALL TO authenticated USING (true) WITH CHECK (true)
-- Qualquer usuário autenticado podia LER, MODIFICAR (mark-read fake) e
-- EXCLUIR notificações de qualquer outro usuário. Cross-sector info leak
-- + risco de manipulação de leitura.
--
-- Fix: SELECT permanece aberto (necessário para Kanban/Dashboard ver
-- notificações de setor com user_id IS NULL = broadcast). UPDATE e DELETE
-- ficam restritos a notificações do próprio usuário OU broadcasts. INSERT
-- exige usuário aprovado (impede usuários comuns de poluir o sistema com
-- notificações falsas).

DROP POLICY IF EXISTS "rls_notifications_all" ON public.notifications;

-- SELECT: aberto a authenticated (broadcasts + próprias)
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT TO authenticated USING (true);

-- INSERT: só usuários aprovados podem criar (triggers SECURITY DEFINER
-- bypassam RLS, então notificações de sistema continuam funcionando)
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user());

-- UPDATE: só pode atualizar notificações próprias (mark-read) ou
-- broadcasts sem user_id atribuído
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL)
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- DELETE: só pode excluir notificações próprias
CREATE POLICY "notifications_delete" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
