-- Família técnica explícita no estoque calçadista.
--
-- Antes, uma família só era reconhecida depois de ganhar o primeiro filho.
-- Enquanto vazia, ela era indistinguível de um grupo/linha e aceitava produtos.
-- `is_family` preserva a intenção do cadastro desde a criação.

alter table public.product_groups
  add column if not exists is_family boolean not null default false;

update public.product_groups family
set is_family = true
where exists (
  select 1
  from public.product_groups child
  where child.parent_group_id = family.id
);

comment on column public.product_groups.is_family is
  'Família técnica/container. Organiza grupos/linhas e nunca recebe produtos diretamente.';

create or replace function public.fn_guard_product_group_is_leaf()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_group public.product_groups%rowtype;
begin
  if new.group_id is not null
     and (
       tg_op = 'INSERT'
       or new.group_id is distinct from old.group_id
       or new.unit is distinct from old.unit
     )
  then
    -- UPDATE serializa produto × filho × edição do grupo. SHARE seria compatível
    -- com o lock tomado ao vincular um filho e permitiria que ambos enxergassem o
    -- container vazio. O row lock também evita a inversão advisory → FK.
    select * into v_group
    from public.product_groups
    where id = new.group_id
    for update;

    if coalesce(v_group.is_family, false)
       or exists (select 1 from public.product_groups c where c.parent_group_id = new.group_id)
    then
      raise exception 'Este cadastro é uma família técnica e não recebe itens diretamente. Escolha um grupo/linha.'
        using errcode = '23514';
    end if;

    if v_group.sector in ('Cabedal', 'Forração da Palmilha', 'Palmilha')
       and lower(btrim(coalesce(new.unit, ''))) in ('m', 'meters', 'metros', 'metro', 'mt', 'cm', 'm linear')
       and (
         coalesce(v_group.dimensions_width, 0) <= 0
         or coalesce(v_group.dimensions_width::text, '') in ('NaN', 'Infinity', '-Infinity')
       )
    then
      raise exception 'Material de área em unidade linear exige largura útil no grupo. Salve a aba Dimensões antes de vincular o item.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tg_guard_product_group_is_leaf on public.products;
create trigger tg_guard_product_group_is_leaf
  before insert or update of group_id, unit on public.products
  for each row execute function public.fn_guard_product_group_is_leaf();

create or replace function public.fn_guard_group_parent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent public.product_groups%rowtype;
  v_has_children boolean := false;
begin
  if new.parent_group_id = new.id then
    raise exception 'Um grupo não pode ser pai de si mesmo.' using errcode = '23514';
  end if;

  -- A própria linha NEW já está bloqueada pelo UPDATE. Ao vincular, também
  -- bloqueia exclusivamente a família lida: mudança de setor/tipo, vínculo de
  -- outro filho e entrada de produto terminam antes desta validação, ou esperam.
  if new.parent_group_id is not null then
    select * into v_parent
    from public.product_groups
    where id = new.parent_group_id
    for update;
  end if;

  select exists (
    select 1 from public.product_groups child where child.parent_group_id = new.id
  ) into v_has_children;

  if v_has_children and not coalesce(new.is_family, false) then
    raise exception 'Uma família com grupos vinculados não pode virar grupo/linha. Desvincule os grupos primeiro.'
      using errcode = '23514';
  end if;

  if coalesce(new.is_family, false) then
    if new.parent_group_id is not null then
      raise exception 'Família técnica precisa ficar diretamente no setor; não pode pertencer a outra família.'
        using errcode = '23514';
    end if;

    if exists (select 1 from public.products where group_id = new.id) then
      raise exception 'Este grupo ainda possui itens. Mova os itens antes de transformá-lo em família técnica.'
        using errcode = '23514';
    end if;
  end if;

  if not coalesce(new.is_family, false)
     and new.sector in ('Cabedal', 'Forração da Palmilha', 'Palmilha')
     and (
       coalesce(new.dimensions_width, 0) <= 0
       or coalesce(new.dimensions_width::text, '') in ('NaN', 'Infinity', '-Infinity')
     )
     and exists (
       select 1
       from public.products p
       where p.group_id = new.id
         and lower(btrim(coalesce(p.unit, ''))) in ('m', 'meters', 'metros', 'metro', 'mt', 'cm', 'm linear')
     )
  then
    raise exception 'Este grupo possui itens lineares de área. Cadastre a largura útil na aba Dimensões antes de mudar o setor.'
      using errcode = '23514';
  end if;

  if new.parent_group_id is not null
     and (tg_op = 'INSERT'
          or new.parent_group_id is distinct from old.parent_group_id
          or new.sector is distinct from old.sector
          or new.is_family is distinct from old.is_family)
  then
    if v_parent.id is null then
      raise exception 'Família técnica não encontrada.' using errcode = '23514';
    end if;

    if not coalesce(v_parent.is_family, false) then
      raise exception 'O destino precisa estar cadastrado como família técnica.' using errcode = '23514';
    end if;

    if v_parent.parent_group_id is not null then
      raise exception 'Não é permitido aninhar família dentro de família (máx.: Setor › Família › Grupo).'
        using errcode = '23514';
    end if;

    if exists (select 1 from public.products where group_id = new.parent_group_id) then
      raise exception 'A família de destino tem itens diretos; esvazie-a antes de receber grupos.'
        using errcode = '23514';
    end if;

    if new.sector is distinct from v_parent.sector then
      raise exception 'O grupo deve estar no mesmo setor da família (%). Ajuste o setor ao vincular.', v_parent.sector
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tg_guard_group_parent on public.product_groups;
drop trigger if exists tg_aa_guard_group_parent on public.product_groups;
create trigger tg_aa_guard_group_parent
  before insert or update of parent_group_id, sector, is_family on public.product_groups
  for each row execute function public.fn_guard_group_parent();

create or replace function public.suggest_group_families()
returns table (
  suggested_family text,
  sector text,
  member_group_ids uuid[],
  member_names text[]
)
language sql
stable
set search_path = public, pg_temp
as $$
  with leaf_loose as (
    select
      g.id,
      g.name,
      g.sector,
      upper(split_part(btrim(g.name), ' ', 1)) as prefix
    from public.product_groups g
    where g.parent_group_id is null
      and not coalesce(g.is_family, false)
      and not exists (select 1 from public.product_groups c where c.parent_group_id = g.id)
  ), grouped as (
    select
      prefix,
      sector,
      array_agg(id order by name) as ids,
      array_agg(name order by name) as names,
      count(*) as member_count
    from leaf_loose
    where length(prefix) >= 3
    group by prefix, sector
  )
  select prefix, sector, ids, names
  from grouped
  where member_count >= 2
  order by member_count desc, prefix;
$$;

grant execute on function public.suggest_group_families() to authenticated;

-- Porta transacional única das dimensões. O grupo é a fonte de cadastro; as
-- fichas recebem a cópia enquanto os motores de consumo ainda leem delas.
create or replace function public.update_material_group_dimensions(
  p_group_id uuid,
  p_length numeric,
  p_width numeric,
  p_thickness numeric,
  p_unit text
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_sheet_count integer := 0;
begin
  if p_width is null
     or p_width::text in ('NaN', 'Infinity', '-Infinity')
     or p_width <= 0
  then
    raise exception 'A largura útil precisa ser maior que zero.' using errcode = '23514';
  end if;

  if p_length is not null
     and (p_length::text in ('NaN', 'Infinity', '-Infinity') or p_length < 0)
  then
    raise exception 'O comprimento não pode ser negativo ou não finito.' using errcode = '23514';
  end if;

  if p_thickness is not null
     and (p_thickness::text in ('NaN', 'Infinity', '-Infinity') or p_thickness < 0)
  then
    raise exception 'A espessura não pode ser negativa ou não finita.' using errcode = '23514';
  end if;

  if p_unit is null or p_unit not in ('mm', 'cm', 'm') then
    raise exception 'Unidade de dimensão inválida: %.', p_unit using errcode = '23514';
  end if;

  update public.product_groups
  set dimensions_length = coalesce(p_length, 0),
      dimensions_width = p_width,
      dimensions_thickness = coalesce(p_thickness, 0),
      dimensions_unit = p_unit
  where id = p_group_id
    and not coalesce(is_family, false);

  if not found then
    raise exception 'Grupo/linha não encontrado ou o cadastro é uma família técnica.' using errcode = 'P0002';
  end if;

  -- Não basta atualizar fichas existentes: a primeira variante de um grupo novo
  -- também precisa da ficha que os motores de conversão leem. O INSERT é
  -- idempotente pelo UNIQUE(product_id) e mantém a operação inteira atômica.
  insert into public.component_sheets (
    product_id,
    group_id,
    dimensions_length,
    dimensions_width,
    dimensions_thickness,
    dimensions_unit
  )
  select
    p.id,
    p_group_id,
    coalesce(p_length, 0),
    p_width,
    coalesce(p_thickness, 0),
    p_unit
  from public.products p
  where p.group_id = p_group_id
  on conflict (product_id) do nothing;

  update public.component_sheets cs
  set group_id = p_group_id,
      dimensions_length = coalesce(p_length, 0),
      dimensions_width = p_width,
      dimensions_thickness = coalesce(p_thickness, 0),
      dimensions_unit = p_unit
  where exists (
    select 1
    from public.products p
    where p.id = cs.product_id
      and p.group_id = p_group_id
  );

  get diagnostics v_sheet_count = row_count;
  return v_sheet_count;
end $$;

grant execute on function public.update_material_group_dimensions(uuid, numeric, numeric, numeric, text) to authenticated;

-- Compensação segura do cadastro rápido. O row lock é o mesmo que produtos
-- tomam em SHARE antes de apontar para o grupo: não existe janela COUNT→DELETE
-- capaz de desagrupar um SKU concorrente pelo FK ON DELETE SET NULL.
create or replace function public.delete_empty_material_group(p_group_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid;
begin
  select id into v_group_id
  from public.product_groups
  where id = p_group_id
  for update;

  if v_group_id is null then return false; end if;

  if exists (select 1 from public.products where group_id = p_group_id)
     or exists (select 1 from public.product_groups where parent_group_id = p_group_id)
  then
    return false;
  end if;

  delete from public.product_groups where id = p_group_id;
  return found;
end $$;

grant execute on function public.delete_empty_material_group(uuid) to authenticated;

-- O trigger histórico herdava a ficha somente de uma cor irmã. Num grupo novo,
-- a primeira cor não tinha irmã e podia nascer sem component_sheet apesar de a
-- largura já estar no grupo. Dimensão do grupo tem precedência sobre qualquer
-- irmão legado divergente; o modelo fornece somente rendimento/notas e funciona
-- como fallback quando o grupo realmente ainda não tem medida.
create or replace function public.tg_inherit_component_sheet_on_product()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model public.component_sheets%rowtype;
  v_group public.product_groups%rowtype;
  v_length numeric;
  v_width numeric;
  v_thickness numeric;
  v_unit text;
begin
  if new.group_id is null then return new; end if;
  if exists (select 1 from public.component_sheets where product_id = new.id) then
    return new;
  end if;

  select * into v_group
  from public.product_groups
  where id = new.group_id;

  select cs.* into v_model
  from public.component_sheets cs
  join public.products sibling on sibling.id = cs.product_id
  where sibling.group_id = new.group_id
    and cs.product_id <> new.id
    and cs.dimensions_width > 0
  order by cs.updated_at desc
  limit 1;

  if coalesce(v_group.dimensions_width, 0) > 0 then
    v_length := coalesce(v_group.dimensions_length, 0);
    v_width := v_group.dimensions_width;
    v_thickness := coalesce(v_group.dimensions_thickness, 0);
    v_unit := coalesce(nullif(v_group.dimensions_unit, ''), 'mm');
  elsif coalesce(v_model.dimensions_width, 0) > 0 then
    v_length := coalesce(v_model.dimensions_length, 0);
    v_width := v_model.dimensions_width;
    v_thickness := coalesce(v_model.dimensions_thickness, 0);
    v_unit := coalesce(nullif(v_model.dimensions_unit, ''), 'mm');
  end if;

  if coalesce(v_width, 0) > 0 then
    insert into public.component_sheets (
      product_id, group_id, dimensions_length, dimensions_width, dimensions_thickness,
      dimensions_unit, yield_per_size, yield_per_sole, default_sole_group_id, notes
    ) values (
      new.id, new.group_id, v_length, v_width, v_thickness, v_unit,
      case when coalesce(v_group.shared_specs, false) then coalesce(v_model.yield_per_size, '{}'::jsonb) else '{}'::jsonb end,
      case when coalesce(v_group.shared_specs, false) then coalesce(v_model.yield_per_sole, '{}'::jsonb) else '{}'::jsonb end,
      case when coalesce(v_group.shared_specs, false) then v_model.default_sole_group_id else null end,
      case when coalesce(v_group.shared_specs, false) then coalesce(v_model.notes, '') else '' end
    )
    on conflict (product_id) do nothing;
  end if;

  return new;
end $$;

-- Mover um SKU precisa mover também a ficha que governa a conversão física.
-- O grupo de destino prevalece; se ele ainda não tem dimensão, uma ficha irmã
-- pode servir de fallback legado. Ao desvincular, preserva a medida do item e
-- apenas remove o vínculo, evitando perda de cadastro ao excluir um grupo.
create or replace function public.tg_sync_component_sheet_on_product_group_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group public.product_groups%rowtype;
  v_model public.component_sheets%rowtype;
  v_length numeric := 0;
  v_width numeric := 0;
  v_thickness numeric := 0;
  v_unit text := 'mm';
begin
  if new.group_id is not distinct from old.group_id then return new; end if;

  if new.group_id is null then
    update public.component_sheets
    set group_id = null
    where product_id = new.id;
    return new;
  end if;

  select * into v_group
  from public.product_groups
  where id = new.group_id;

  select cs.* into v_model
  from public.component_sheets cs
  join public.products sibling on sibling.id = cs.product_id
  where sibling.group_id = new.group_id
    and sibling.id <> new.id
    and cs.dimensions_width > 0
  order by cs.updated_at desc
  limit 1;

  if coalesce(v_group.dimensions_width, 0) > 0 then
    v_length := coalesce(v_group.dimensions_length, 0);
    v_width := v_group.dimensions_width;
    v_thickness := coalesce(v_group.dimensions_thickness, 0);
    v_unit := coalesce(nullif(v_group.dimensions_unit, ''), 'mm');
  elsif coalesce(v_model.dimensions_width, 0) > 0 then
    v_length := coalesce(v_model.dimensions_length, 0);
    v_width := v_model.dimensions_width;
    v_thickness := coalesce(v_model.dimensions_thickness, 0);
    v_unit := coalesce(nullif(v_model.dimensions_unit, ''), 'mm');
  end if;

  if v_width > 0 then
    update public.component_sheets cs
    set group_id = new.group_id,
        dimensions_length = v_length,
        dimensions_width = v_width,
        dimensions_thickness = v_thickness,
        dimensions_unit = v_unit,
        yield_per_size = case
          when coalesce(v_group.shared_specs, false) and v_model.id is not null then v_model.yield_per_size
          else cs.yield_per_size
        end,
        yield_per_sole = case
          when coalesce(v_group.shared_specs, false) and v_model.id is not null then v_model.yield_per_sole
          else cs.yield_per_sole
        end,
        default_sole_group_id = case
          when coalesce(v_group.shared_specs, false) and v_model.id is not null then v_model.default_sole_group_id
          else cs.default_sole_group_id
        end
    where cs.product_id = new.id;

    if not found then
      insert into public.component_sheets (
        product_id, group_id, dimensions_length, dimensions_width, dimensions_thickness,
        dimensions_unit, yield_per_size, yield_per_sole, default_sole_group_id
      ) values (
        new.id, new.group_id, v_length, v_width, v_thickness, v_unit,
        case when coalesce(v_group.shared_specs, false) then coalesce(v_model.yield_per_size, '{}'::jsonb) else '{}'::jsonb end,
        case when coalesce(v_group.shared_specs, false) then coalesce(v_model.yield_per_sole, '{}'::jsonb) else '{}'::jsonb end,
        case when coalesce(v_group.shared_specs, false) then v_model.default_sole_group_id else null end
      )
      on conflict (product_id) do nothing;
    end if;
  else
    -- Coleções sem dimensão compartilhada preservam a ficha individual. Só o
    -- vínculo muda; zerar a medida faria o item perder seu cadastro técnico.
    update public.component_sheets
    set group_id = new.group_id
    where product_id = new.id;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_component_sheet_on_product_group_change on public.products;
create trigger trg_sync_component_sheet_on_product_group_change
  after update of group_id on public.products
  for each row execute function public.tg_sync_component_sheet_on_product_group_change();

-- Guarda concorrente para LINHAS COM VARIANTES. Coleções de itens independentes
-- podem conter a mesma cor em SKUs tecnicamente distintos; por isso a trava só
-- entra quando o grupo declara specs compartilhadas ou origina cores no BOM.
create or replace function public.fn_guard_unique_active_group_color()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_enforce boolean := false;
begin
  if new.group_id is not null then
    select (
      not coalesce(g.is_color_agnostic, false)
      and (coalesce(g.shared_specs, false) or coalesce(g.is_bom_color_source, false))
    )
    into v_enforce
    from public.product_groups g
    where g.id = new.group_id
    for share;

    -- O row lock vem antes da trava de cor, inclusive em UPDATE apenas da cor.
    -- Assim ativar o modelo e inserir/editar uma variante são serializados sem
    -- snapshot antigo nem inversão com a FK.
    perform pg_advisory_xact_lock(hashtextextended('group-color:' || new.group_id::text, 0));
  end if;

  if v_enforce
     and coalesce(new.active, true)
     and new.group_id is not null
     and nullif(btrim(coalesce(new.color, '')), '') is not null
  then
    if exists (
       select 1
       from public.products other
       where other.group_id = new.group_id
         and other.id is distinct from new.id
         and coalesce(other.active, true)
         and translate(lower(btrim(coalesce(other.color, ''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
             = translate(lower(btrim(new.color)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
     )
    then
      raise exception 'Já existe uma variante ativa com a cor "%" nesta linha.', new.color
        using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

create or replace function public.fn_guard_group_color_variant_model()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_enforce boolean;
begin
  v_enforce := (
    not coalesce(new.is_color_agnostic, false)
    and (coalesce(new.shared_specs, false) or coalesce(new.is_bom_color_source, false))
  );

  if v_enforce then
    -- O UPDATE do grupo já segura o row lock; produtos tomam FOR SHARE antes da
    -- trava de cor. Mantém a mesma ordem row-do-grupo → group-color.
    perform pg_advisory_xact_lock(hashtextextended('group-color:' || new.id::text, 0));

    if exists (
      select 1
      from (
        select translate(
          lower(btrim(p.color)),
          'áàâãäéèêëíìîïóòôõöúùûüç',
          'aaaaaeeeeiiiiooooouuuuc'
        ) as color_key
        from public.products p
        where p.group_id = new.id
          and coalesce(p.active, true)
          and nullif(btrim(coalesce(p.color, '')), '') is not null
        group by 1
        having count(*) > 1
      ) duplicate_colors
    )
    then
      raise exception 'Há cores ativas duplicadas. Revise ou funda as variantes antes de ativar "Linha com variantes".'
        using errcode = '23514';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists tg_guard_group_color_variant_model on public.product_groups;
create trigger tg_guard_group_color_variant_model
  before insert or update of shared_specs, is_bom_color_source, is_color_agnostic on public.product_groups
  for each row execute function public.fn_guard_group_color_variant_model();

drop trigger if exists tg_guard_unique_active_group_color on public.products;
create trigger tg_guard_unique_active_group_color
  before insert or update of group_id, color, active on public.products
  for each row execute function public.fn_guard_unique_active_group_color();
