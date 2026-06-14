-- ════════════════════════════════════════════════════════════════════════
-- Terceirização proativa no PV, por setor (Fase A)
--
-- Permite definir, JÁ NO PEDIDO DE VENDA, que um SETOR vai pra fora (prestador),
-- de propósito, pra evitar gargalo. Antes a terceirização só acontecia depois,
-- na produção (overflow de capacidade ou marcação manual da OP).
--
-- Quando o PV vira OPs (trigger tg_sale_order_creates_ops_on_production), cada OP
-- nova herda o prestador+setor escolhido no PV via um trigger ISOLADO BEFORE
-- INSERT em orders (não toca no trigger gigante de criação de OPs). A OP marcada
-- já aparece no hub Terceiros "Na Rua" (a view v_outsourced_in_field inclui OPs
-- terceirizadas) — sem criar service_order aqui (cost/OS é passo posterior).
-- ════════════════════════════════════════════════════════════════════════

alter table public.sale_orders
  add column if not exists outsource_to_contractor_id uuid references public.contractors(id) on delete set null,
  add column if not exists outsource_to_sector text;

comment on column public.sale_orders.outsource_to_contractor_id is
  'Prestador pra quem o setor outsource_to_sector deste PV vai (terceirização planejada). NULL = sem.';
comment on column public.sale_orders.outsource_to_sector is
  'Setor (label, ex.: Solagem/Costura) que sai pra fora neste PV. Aplicado às OPs no BEFORE INSERT.';

-- Marca a OP recém-criada com o prestador/setor escolhido no PV.
create or replace function public.tg_apply_pv_outsourcing_to_op()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  v_contractor uuid;
  v_sector text;
begin
  -- Só age quando a OP nasce de um PV e ainda não tem terceirização explícita.
  if new.sale_order_id is null or new.outsourced_to_contractor_id is not null then
    return new;
  end if;

  select outsource_to_contractor_id, outsource_to_sector
    into v_contractor, v_sector
    from public.sale_orders
   where id = new.sale_order_id;

  if v_contractor is not null then
    new.outsourced_to_contractor_id := v_contractor;
    new.outsourced_sector := v_sector;
    new.outsourced_at := now();
  end if;

  return new;
end;
$func$;

drop trigger if exists trg_apply_pv_outsourcing_to_op on public.orders;
create trigger trg_apply_pv_outsourcing_to_op
  before insert on public.orders
  for each row execute function public.tg_apply_pv_outsourcing_to_op();
