-- Folha → financeiro/DRE (auditoria 2026-07-04, achado #1).
--
-- Até aqui a folha calculava e gravava tudo em `payroll_runs` + `payroll_payments`,
-- mas NADA disso virava lançamento em `financial_entries` — o maior custo da
-- fábrica (salários + HE) ficava INVISÍVEL no DRE. Este trigger fecha o gap:
-- quando uma folha é APROVADA ou PAGA, cria/atualiza uma despesa espelho no
-- razão; quando volta pra rascunho/cancelada (ou zera), cancela a despesa.
--
-- Escopo desta migration (deliberado):
--   • Reconhece o LÍQUIDO da folha (`total_liquido`) como despesa única por run.
--     Vales/adiantamentos e provisões (13º/FGTS/férias) continuam FORA — são
--     gaps separados (ver auditoria), não misturar aqui pra não duplicar.
--   • FORWARD-ONLY: NÃO faz backfill das folhas já aprovadas/pagas (evita inundar
--     o razão retroativamente). Pra lançar histórico, rode um UPDATE manual que
--     re-dispare o status, ou um INSERT direcionado.
--   • account_id resolvido por NOME em runtime (nullable). Hoje não existe conta
--     de folha no plano de contas; a despesa entra sem conta (ainda soma no total
--     de despesas do DRE). Ao criar uma conta "Folha de Pagamento"/"Salários",
--     os próximos lançamentos linkam sozinhos.

-- Índice único parcial: 1 despesa viva por payroll_run (espelha o padrão
-- financial_entries_sale_order_unique). Canceladas/estornadas liberam o slot.
create unique index if not exists financial_entries_payroll_run_unique
  on public.financial_entries (reference_id)
  where reference_type = 'payroll_run' and status not in ('cancelado', 'estornado');

create or replace function public.tg_payroll_sync_financial_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount    numeric;
  v_name      text;
  v_date      date;
  v_status    text;
  v_account   uuid;
  v_desc      text;
begin
  v_amount := round(coalesce(NEW.total_liquido, NEW.net_salary, 0), 2);

  if NEW.status in ('aprovado', 'pago') and v_amount > 0 then
    select name into v_name from public.employees where id = NEW.employee_id;
    v_desc   := 'Folha ' || coalesce(NEW.period, '') || ' — ' || coalesce(v_name, 'funcionário');
    -- pago → confirmado (entra no DRE regime caixa); aprovado → pendente (a pagar).
    v_status := case when NEW.status = 'pago' then 'confirmed' else 'pendente' end;
    v_date   := coalesce(NEW.paid_at, NEW.approved_at, now())::date;
    -- conta de despesa de folha, se existir (nullable, resolve sozinho no futuro).
    select id into v_account from public.chart_of_accounts
      where type = 'despesa'
        and (name ilike '%folha%' or name ilike '%salári%' or name ilike '%pessoal%')
      order by code limit 1;

    update public.financial_entries
       set amount      = v_amount,
           status      = v_status,
           entry_date  = v_date,
           description = v_desc,
           account_id  = coalesce(v_account, account_id),
           updated_at  = now()
     where reference_type = 'payroll_run'
       and reference_id   = NEW.id::text
       and status not in ('cancelado', 'estornado');

    if not found then
      insert into public.financial_entries
        (entry_date, type, description, amount, account_id,
         reference_type, reference_id, status, notes)
      values
        (v_date, 'despesa', v_desc, v_amount, v_account,
         'payroll_run', NEW.id::text, v_status,
         'Gerado automaticamente pela folha (payroll_runs).');
    end if;
  else
    -- rascunho / cancelado / líquido<=0 → cancela a despesa espelho (some do DRE,
    -- libera o índice único). NÃO deleta pra preservar histórico/auditoria.
    update public.financial_entries
       set status = 'cancelado', updated_at = now()
     where reference_type = 'payroll_run'
       and reference_id   = NEW.id::text
       and status not in ('cancelado', 'estornado');
  end if;

  return NEW;
end;
$$;

drop trigger if exists tg_payroll_sync_financial_entry on public.payroll_runs;
create trigger tg_payroll_sync_financial_entry
  after insert or update of status on public.payroll_runs
  for each row execute function public.tg_payroll_sync_financial_entry();
