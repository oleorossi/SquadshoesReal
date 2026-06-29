-- B1 (auditoria de sistema 2026-06-29) — aplicada via MCP; registro no repo.
--
-- Editar a BOM (sheet_materials) NÃO marcava os PVs como dirty: havia trigger de
-- costs_dirty_at só em technical_sheets (colunas da ficha), nada em sheet_materials.
-- Como calculate_order_consumption lê sheet_materials e isso dirige material_cost,
-- corrigir uma BOM inflada (caso cola) deixava o custo velho no order_costs até
-- algo mais tocar o PV. Espelha tg_mark_so_costs_dirty_from_sheet, chaveado pelo
-- sheet_id da linha BOM. process_dirty_order_costs continua pulando terminais
-- (preserva snapshot congelado).
create or replace function public.tg_mark_so_costs_dirty_from_bom()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_sheet uuid := coalesce(NEW.sheet_id, OLD.sheet_id);
begin
  if v_sheet is null then
    return coalesce(NEW, OLD);
  end if;

  update public.sale_orders so
     set costs_dirty_at = now()
   where so.id in (
     select distinct soi.sale_order_id
       from public.sale_order_items soi
      where soi.reference_id = v_sheet
   )
     and so.status not in ('Cancelado', 'Cancelada', 'Rascunho');

  update public.technical_sheet_snapshots
     set outdated_at = now()
   where sheet_id = v_sheet
     and outdated_at is null;

  update public.sale_orders so
     set reservations_outdated_at = now()
   where so.id in (
     select distinct soi.sale_order_id
       from public.sale_order_items soi
      where soi.reference_id = v_sheet
   )
     and so.status in ('Pendente', 'Aprovado', 'Em Produção');

  return coalesce(NEW, OLD);
end;
$function$;

revoke execute on function public.tg_mark_so_costs_dirty_from_bom() from public, anon;

drop trigger if exists trg_mark_so_costs_dirty_from_bom on public.sheet_materials;
create trigger trg_mark_so_costs_dirty_from_bom
  after insert or update or delete on public.sheet_materials
  for each row execute function public.tg_mark_so_costs_dirty_from_bom();
