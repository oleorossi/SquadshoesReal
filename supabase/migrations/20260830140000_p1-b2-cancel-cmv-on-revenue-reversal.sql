-- B2 (auditoria de sistema 2026-06-29) — aplicada via MCP; registro no repo.
--
-- Receita de PV estornada via cancel-nfe (que reabre o PV p/ 'Em Produção') ou
-- via tg_reverse_revenue_on_untracked_cancel NÃO estornava o CMV automático
-- (sale_order_cmv). revert_invoiced_sale_order já trata (patch F2 2026-06-10),
-- mas os outros caminhos não → 26 PVs com receita 'estornado' e CMV 'pendente'
-- (~R$136k de CMV-fantasma; inócuo na DRE caixa hoje pois 0 AR têm caixa, mas
-- vira CMV-fantasma assim que qualquer pagamento entrar).
--
-- Centraliza num trigger em financial_entries: quando a RECEITA do PV vira
-- estornada/cancelada, cancela o CMV do mesmo PV. Setar status='cancelado'
-- dispara trg_cmv_entry_recompute → recompute_sale_order_cmv_recognition zera a
-- recognition. Guard: só cancela se NÃO restar receita ATIVA do PV (um PV
-- re-faturado após estorno mantém o CMV).
create or replace function public.tg_cancel_cmv_on_revenue_reversal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.reference_type not in ('sale_order','sale_order_factoring') then
    return NEW;
  end if;
  if NEW.status not in ('estornado','cancelado','cancelada','cancelled') then
    return NEW;
  end if;
  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  update public.financial_entries cmv
     set status = 'cancelado'
   where cmv.reference_type = 'sale_order_cmv'
     and cmv.reference_id = NEW.reference_id
     and cmv.status not in ('cancelado','cancelled','estornado')
     and not exists (
       select 1 from public.financial_entries rev2
        where rev2.reference_type in ('sale_order','sale_order_factoring')
          and rev2.reference_id = NEW.reference_id
          and rev2.status not in ('estornado','cancelado','cancelada','cancelled')
     );

  return NEW;
end;
$function$;

revoke execute on function public.tg_cancel_cmv_on_revenue_reversal() from public, anon;

drop trigger if exists trg_cancel_cmv_on_revenue_reversal on public.financial_entries;
create trigger trg_cancel_cmv_on_revenue_reversal
  after update of status on public.financial_entries
  for each row execute function public.tg_cancel_cmv_on_revenue_reversal();

-- ── Backfill dos PVs com receita estornada e CMV ainda ativo (sem receita ativa) ──
update public.financial_entries cmv
   set status = 'cancelado'
 where cmv.reference_type = 'sale_order_cmv'
   and cmv.status not in ('cancelado','cancelled','estornado')
   and exists (
     select 1 from public.financial_entries rev
      where rev.reference_type in ('sale_order','sale_order_factoring')
        and rev.reference_id = cmv.reference_id
        and rev.status in ('estornado','cancelado','cancelada','cancelled')
   )
   and not exists (
     select 1 from public.financial_entries rev2
      where rev2.reference_type in ('sale_order','sale_order_factoring')
        and rev2.reference_id = cmv.reference_id
        and rev2.status not in ('estornado','cancelado','cancelada','cancelled')
   );
