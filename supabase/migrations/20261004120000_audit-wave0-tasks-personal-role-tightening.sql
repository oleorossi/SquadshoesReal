-- Onda 0 da auditoria Codex (2026-07-28): Tarefas pessoais (A1) + tightening de
-- Automações (só admin) e Manutenção (admin+gerente). Decisão do dono do sistema.
-- JÁ APLICADA via Supabase MCP em 2026-07-28. Idempotente (seguro re-aplicar).

-- ==================== note_tasks: modelo PESSOAL (A1) ====================
-- Autoria SEMPRE = usuário logado (default + trigger anti-forjação: antes o
-- created_by vinha do cliente, podia ser nulo ou forjado).
alter table public.note_tasks alter column created_by set default auth.uid();

create or replace function public.tg_note_tasks_set_owner()
returns trigger language plpgsql security definer set search_path to 'public','auth' as $fn$
begin
  new.created_by := auth.uid();
  return new;
end
$fn$;

drop trigger if exists trg_note_tasks_set_owner on public.note_tasks;
create trigger trg_note_tasks_set_owner
  before insert on public.note_tasks
  for each row execute function public.tg_note_tasks_set_owner();

-- RLS pessoal: o dono vê/mexe nas suas; admin vê/mexe em todas (as tarefas
-- legadas com created_by nulo ficam visíveis só pra admin — nada é perdido).
drop policy if exists note_tasks_authenticated_all on public.note_tasks;
drop policy if exists note_tasks_select on public.note_tasks;
drop policy if exists note_tasks_insert on public.note_tasks;
drop policy if exists note_tasks_update on public.note_tasks;
drop policy if exists note_tasks_delete on public.note_tasks;

create policy note_tasks_select on public.note_tasks
  for select to authenticated
  using (created_by = auth.uid() or public.user_has_any_role(array['admin']));

create policy note_tasks_insert on public.note_tasks
  for insert to authenticated
  with check (created_by = auth.uid());

create policy note_tasks_update on public.note_tasks
  for update to authenticated
  using (created_by = auth.uid() or public.user_has_any_role(array['admin']))
  with check (created_by = auth.uid() or public.user_has_any_role(array['admin']));

create policy note_tasks_delete on public.note_tasks
  for delete to authenticated
  using (created_by = auth.uid() or public.user_has_any_role(array['admin']));

-- ==================== automation_*: só admin escreve, aprovados leem ====================
drop policy if exists auto_workflows_mutate on public.automation_workflows;
drop policy if exists auto_workflows_read   on public.automation_workflows;
drop policy if exists auto_workflows_write  on public.automation_workflows;
create policy auto_workflows_read on public.automation_workflows
  for select to authenticated using (public.is_approved_user());
create policy auto_workflows_write on public.automation_workflows
  for all to authenticated
  using (public.user_has_any_role(array['admin']))
  with check (public.user_has_any_role(array['admin']));

drop policy if exists auto_executions_mutate on public.automation_executions;
drop policy if exists auto_executions_read   on public.automation_executions;
drop policy if exists auto_executions_write  on public.automation_executions;
create policy auto_executions_read on public.automation_executions
  for select to authenticated using (public.is_approved_user());
create policy auto_executions_write on public.automation_executions
  for all to authenticated
  using (public.user_has_any_role(array['admin']))
  with check (public.user_has_any_role(array['admin']));

-- ==================== manutenção: aprovados leem, admin+gerente escrevem ====================
-- equipment
drop policy if exists approved_select on public.equipment;
drop policy if exists approved_insert on public.equipment;
drop policy if exists approved_update on public.equipment;
drop policy if exists approved_delete on public.equipment;
drop policy if exists maint_read  on public.equipment;
drop policy if exists maint_write on public.equipment;
create policy maint_read on public.equipment
  for select to authenticated using (public.is_approved_user());
create policy maint_write on public.equipment
  for all to authenticated
  using (public.user_has_any_role(array['admin','gerente']))
  with check (public.user_has_any_role(array['admin','gerente']));

-- maintenance_plans
drop policy if exists approved_select on public.maintenance_plans;
drop policy if exists approved_insert on public.maintenance_plans;
drop policy if exists approved_update on public.maintenance_plans;
drop policy if exists approved_delete on public.maintenance_plans;
drop policy if exists maint_read  on public.maintenance_plans;
drop policy if exists maint_write on public.maintenance_plans;
create policy maint_read on public.maintenance_plans
  for select to authenticated using (public.is_approved_user());
create policy maint_write on public.maintenance_plans
  for all to authenticated
  using (public.user_has_any_role(array['admin','gerente']))
  with check (public.user_has_any_role(array['admin','gerente']));

-- maintenance_logs
drop policy if exists approved_select on public.maintenance_logs;
drop policy if exists approved_insert on public.maintenance_logs;
drop policy if exists approved_update on public.maintenance_logs;
drop policy if exists approved_delete on public.maintenance_logs;
drop policy if exists maint_read  on public.maintenance_logs;
drop policy if exists maint_write on public.maintenance_logs;
create policy maint_read on public.maintenance_logs
  for select to authenticated using (public.is_approved_user());
create policy maint_write on public.maintenance_logs
  for all to authenticated
  using (public.user_has_any_role(array['admin','gerente']))
  with check (public.user_has_any_role(array['admin','gerente']));
