-- Ensaio (ROLLBACK no final): família tipológica pode receber subgrupo
-- de outro setor, sem reclassificar o setor nem o estoque.
-- Não toca PV-00249, PV-00250, PV-00251 nem LOTE-00004.
-- Não liga auto_motor_enabled nem urgent_release_without_material.

begin;

do $$
declare
  v_family uuid;
  v_child uuid;
  v_family_sector text;
  v_child_sector text;
  v_child_qty numeric;
begin
  select id, sector into v_family, v_family_sector
  from public.product_groups
  where name = 'TIRA' and coalesce(is_family, false) = true
  limit 1;
  if v_family is null then
    raise exception 'Família TIRA não encontrada neste ambiente.';
  end if;

  select g.id, g.sector, coalesce(sum(p.quantity), 0)
    into v_child, v_child_sector, v_child_qty
  from public.product_groups g
  left join public.products p on p.group_id = g.id
  where g.name = 'TIRA STRASS 6MM'
  group by g.id, g.sector;
  if v_child is null then
    raise exception 'Subgrupo TIRA STRASS 6MM não encontrado.';
  end if;
  if v_child_sector is not distinct from v_family_sector then
    raise exception 'O ensaio espera setores diferentes (família % vs subgrupo %).', v_family_sector, v_child_sector;
  end if;

  update public.product_groups
     set parent_group_id = v_family
   where id = v_child;

  if not exists (
    select 1 from public.product_groups
    where id = v_child and parent_group_id = v_family and sector is not distinct from v_child_sector
  ) then
    raise exception 'Vínculo falhou ou o setor do subgrupo mudou.';
  end if;

  if exists (
    select 1 from public.products p
    where p.group_id = v_child and p.category is distinct from v_child_sector
  ) then
    raise exception 'Reclassificação indevida de products.category.';
  end if;

  raise notice 'Ensaio ok: STRASS 6MM vinculado a TIRA, setor % e saldo % preservados.', v_child_sector, v_child_qty;
end $$;

rollback;
