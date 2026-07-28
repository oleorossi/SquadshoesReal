-- Batch 4-RH: RLS de folha e ponto por papel (RH + gerente + admin).
-- JÁ APLICADA via MCP. Idempotente. Antes qualquer aprovado (produção/almox/
-- comercial/consulta/nfe) lia/escrevia folha, pagamentos e ponto de todos (P09).

drop policy if exists "approved users modify payroll" on public.payroll_runs;
drop policy if exists "approved users select payroll" on public.payroll_runs;
drop policy if exists payroll_runs_read  on public.payroll_runs;
drop policy if exists payroll_runs_write on public.payroll_runs;
create policy payroll_runs_read on public.payroll_runs
  for select to authenticated using (public.user_has_any_role(array['admin','gerente','rh']));
create policy payroll_runs_write on public.payroll_runs
  for all to authenticated
  using (public.user_has_any_role(array['admin','gerente','rh']))
  with check (public.user_has_any_role(array['admin','gerente','rh']));

drop policy if exists "Approved users can read payroll_payments"   on public.payroll_payments;
drop policy if exists "Approved users can insert payroll_payments" on public.payroll_payments;
drop policy if exists "Approved users can update payroll_payments" on public.payroll_payments;
drop policy if exists "Approved users can delete payroll_payments" on public.payroll_payments;
drop policy if exists payroll_payments_read  on public.payroll_payments;
drop policy if exists payroll_payments_write on public.payroll_payments;
create policy payroll_payments_read on public.payroll_payments
  for select to authenticated using (public.user_has_any_role(array['admin','gerente','rh']));
create policy payroll_payments_write on public.payroll_payments
  for all to authenticated
  using (public.user_has_any_role(array['admin','gerente','rh']))
  with check (public.user_has_any_role(array['admin','gerente','rh']));

-- ponto: leitura p/ aprovados (supervisão vê presença); escrita só RH/gerente/admin
drop policy if exists "Approved users can view time_records"   on public.time_records;
drop policy if exists "Approved users can insert time_records" on public.time_records;
drop policy if exists "Approved users can update time_records" on public.time_records;
drop policy if exists "Approved users can delete time_records" on public.time_records;
drop policy if exists time_records_read  on public.time_records;
drop policy if exists time_records_write on public.time_records;
create policy time_records_read on public.time_records
  for select to authenticated using (public.is_approved_user());
create policy time_records_write on public.time_records
  for all to authenticated
  using (public.user_has_any_role(array['admin','gerente','rh']))
  with check (public.user_has_any_role(array['admin','gerente','rh']));
