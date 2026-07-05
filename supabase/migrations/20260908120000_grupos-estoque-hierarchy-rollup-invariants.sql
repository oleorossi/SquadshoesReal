-- Reorganização dos Grupos de Estoque — árvore Setor → Família → Grupo
-- Ver specs/grupos-estoque.md
--
-- Esta migração é IDEMPOTENTE (create or replace / drop if exists / DML guardada).
-- Ordem importa: (1) corrige o dado legado que viola o invariante container ANTES
-- de criar os triggers de guarda; (2) cria o read model + sugestões; (3) cria os
-- triggers de invariante e a cascata de setor para subgrupos.
--
-- Modelo: o Setor é a coluna `product_groups.sector` (9 valores fixos, já com CHECK
-- e cascade para products.category) renderizada como raiz na UI — NÃO há linha física
-- de setor. Família = grupo com filhos (parent_group_id null + tem filhos). Grupo-folha
-- = grupo sem filhos (recebe itens). Família nunca recebe item direto (invariante).

-- =====================================================================
-- (1) FIX LEGADO — COMPONENTES tinha 4 subgrupos E 7 itens diretos, o que
--     viola "família não recebe item direto". Move os 7 itens para um novo
--     grupo-folha "COMPONENTES DIVERSOS" sob COMPONENTES (mesmo setor →
--     products.category não muda). Feito ANTES dos triggers de guarda.
-- =====================================================================
do $$
declare
  v_parent uuid;
  v_sector text;
  v_child  uuid;
begin
  select id, sector into v_parent, v_sector
  from public.product_groups
  where lower(btrim(name)) = 'componentes'
  limit 1;

  if v_parent is not null and exists (select 1 from public.products where group_id = v_parent) then
    select id into v_child
    from public.product_groups
    where lower(btrim(name)) = 'componentes diversos'
    limit 1;

    if v_child is null then
      insert into public.product_groups (name, sector, parent_group_id, description)
      values ('COMPONENTES DIVERSOS', v_sector, v_parent,
              'Itens diversos migrados de COMPONENTES (reorganização de grupos, spec grupos-estoque).')
      returning id into v_child;
    end if;

    update public.products
    set group_id = v_child
    where group_id = v_parent;
  end if;
end $$;

-- =====================================================================
-- (2a) READ MODEL — agregados de estoque por grupo-folha.
--      TS rola Família/Setor somando os grupos descendentes.
--      `stock_unit` só é significativo quando unit_count = 1.
-- =====================================================================
create or replace function public.get_group_stock_rollups()
returns table (
  group_id        uuid,
  item_count      integer,
  stock_value     numeric,
  reserved        numeric,
  available       numeric,
  below_min_count integer,
  unit_count      integer,
  stock_unit      text
)
language sql
stable
as $$
  select
    p.group_id,
    count(*)::int                                                                  as item_count,
    coalesce(sum(coalesce(p.quantity,0) * coalesce(p.unit_price,0)), 0)            as stock_value,
    coalesce(sum(coalesce(p.reserved_stock,0)), 0)                                 as reserved,
    coalesce(sum(coalesce(p.quantity,0) - coalesce(p.reserved_stock,0)), 0)        as available,
    count(*) filter (
      where coalesce(p.min_stock,0) > 0
        and (coalesce(p.quantity,0) - coalesce(p.reserved_stock,0)) < coalesce(p.min_stock,0)
    )::int                                                                          as below_min_count,
    count(distinct p.unit)::int                                                     as unit_count,
    max(p.unit)                                                                     as stock_unit
  from public.products p
  where p.group_id is not null
  group by p.group_id;
$$;

grant execute on function public.get_group_stock_rollups() to authenticated;

-- =====================================================================
-- (2b) SUGESTÕES DE FAMÍLIA (read-only, opt-in) — agrupa grupos-folha
--      SOLTOS (sem pai, sem filhos) por prefixo da 1ª palavra do nome,
--      dentro do MESMO setor. Não aplica nada.
-- =====================================================================
create or replace function public.suggest_group_families()
returns table (
  suggested_family text,
  sector           text,
  member_group_ids uuid[],
  member_names     text[]
)
language sql
stable
as $$
  with leaf_loose as (
    select
      g.id,
      g.name,
      g.sector,
      upper(split_part(btrim(g.name), ' ', 1)) as prefix
    from public.product_groups g
    where g.parent_group_id is null
      and not exists (select 1 from public.product_groups c where c.parent_group_id = g.id)
  ),
  grp as (
    select
      prefix,
      sector,
      array_agg(id order by name)   as ids,
      array_agg(name order by name) as names,
      count(*)                      as c
    from leaf_loose
    where length(prefix) >= 3
    group by prefix, sector
  )
  select prefix as suggested_family, sector, ids as member_group_ids, names as member_names
  from grp
  where c >= 2
  order by c desc, prefix;
$$;

grant execute on function public.suggest_group_families() to authenticated;

-- =====================================================================
-- (3a) INVARIANTE — item só entra em grupo-folha (grupo sem filhos).
--      Guarda só na MUDANÇA de group_id (ou INSERT), não em updates
--      de outras colunas. Grupo com filhos = família = container.
-- =====================================================================
create or replace function public.fn_guard_product_group_is_leaf()
returns trigger
language plpgsql
as $$
begin
  if new.group_id is not null
     and (tg_op = 'INSERT' or new.group_id is distinct from old.group_id)
     and exists (select 1 from public.product_groups c where c.parent_group_id = new.group_id)
  then
    raise exception 'Este grupo é uma família (container) e não recebe itens diretamente. Escolha um grupo-folha.'
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists tg_guard_product_group_is_leaf on public.products;
create trigger tg_guard_product_group_is_leaf
  before insert or update of group_id on public.products
  for each row execute function public.fn_guard_product_group_is_leaf();

-- =====================================================================
-- (3b) INVARIANTE — hierarquia de grupos: profundidade máx. 3
--      (Setor › Família › Grupo), família de destino sem itens diretos,
--      e subgrupo no MESMO setor da família.
-- =====================================================================
create or replace function public.fn_guard_group_parent()
returns trigger
language plpgsql
as $$
declare
  v_parent public.product_groups%rowtype;
begin
  if new.parent_group_id is not null
     and (tg_op = 'INSERT'
          or new.parent_group_id is distinct from old.parent_group_id
          or new.sector is distinct from old.sector)
  then
    if new.parent_group_id = new.id then
      raise exception 'Um grupo não pode ser pai de si mesmo.' using errcode = '23514';
    end if;

    select * into v_parent from public.product_groups where id = new.parent_group_id;
    if v_parent.id is null then
      raise exception 'Família (pai) não encontrada.' using errcode = '23514';
    end if;

    -- profundidade: pai precisa ser raiz (sem família dentro de família)
    if v_parent.parent_group_id is not null then
      raise exception 'Não é permitido aninhar família dentro de família (máx.: Setor › Família › Grupo).'
        using errcode = '23514';
    end if;

    -- família de destino não pode ter itens diretos
    if exists (select 1 from public.products where group_id = new.parent_group_id) then
      raise exception 'A família de destino tem itens diretos; esvazie-a antes de receber subgrupos.'
        using errcode = '23514';
    end if;

    -- mono-setor: subgrupo segue o setor da família
    if new.sector is distinct from v_parent.sector then
      raise exception 'O subgrupo deve estar no mesmo setor da família (%). Ajuste o setor ao vincular.', v_parent.sector
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tg_guard_group_parent on public.product_groups;
create trigger tg_guard_group_parent
  before insert or update of parent_group_id, sector on public.product_groups
  for each row execute function public.fn_guard_group_parent();

-- =====================================================================
-- (3c) CASCATA DE SETOR PARA SUBGRUPOS — ao mover uma FAMÍLIA de setor,
--      os subgrupos seguem (e cada subgrupo cascateia para seus produtos
--      via tg_group_sector_cascade). Profundidade máx. 3 garante término.
-- =====================================================================
create or replace function public.fn_group_sector_cascade_children()
returns trigger
language plpgsql
as $$
begin
  if new.sector is distinct from old.sector then
    update public.product_groups
    set sector = new.sector
    where parent_group_id = new.id
      and sector is distinct from new.sector;
  end if;
  return null;
end $$;

drop trigger if exists tg_group_sector_cascade_children on public.product_groups;
create trigger tg_group_sector_cascade_children
  after update of sector on public.product_groups
  for each row execute function public.fn_group_sector_cascade_children();

-- =====================================================================
-- (4) Substitui o índice único legado por um único case-insensitive.
--     `product_groups_name_ci_unique` já existe; o UNIQUE(name) plano
--     (product_groups_name_key) é redundante e case-sensitive — mantido
--     por segurança (não atrapalha). Sem alteração destrutiva aqui.
-- =====================================================================
