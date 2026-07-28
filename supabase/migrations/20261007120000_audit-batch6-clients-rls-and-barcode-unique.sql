-- Batch 6 (auditoria) + fecha Batch 2. JÁ APLICADA via MCP. Idempotente.

-- Batch 2 (completa): barcode de AP único (duplicata SOARES resolvida manualmente
-- — mantido o boleto de R$ 572,80, removido o de R$ 419,80).
create unique index if not exists uq_accounts_payable_barcode
  on public.accounts_payable (barcode)
  where barcode is not null and length(trim(barcode)) > 0;

-- Batch 6: clients — leitura p/ aprovados; escrita só comercial+gerente+admin
-- (decisão do dono). Antes qualquer aprovado (incl. produção/consulta) editava
-- cadastro/limite de crédito de cliente (fatia P12). Gate de UI (canEdit) no FE.
drop policy if exists "Approved users can read clients"   on public.clients;
drop policy if exists "Approved users can insert clients" on public.clients;
drop policy if exists "Approved users can update clients" on public.clients;
drop policy if exists "Approved users can delete clients" on public.clients;
drop policy if exists clients_read  on public.clients;
drop policy if exists clients_write on public.clients;

create policy clients_read on public.clients
  for select to authenticated using (public.is_approved_user());
create policy clients_write on public.clients
  for all to authenticated
  using (public.user_has_any_role(array['admin','gerente','comercial']))
  with check (public.user_has_any_role(array['admin','gerente','comercial']));
