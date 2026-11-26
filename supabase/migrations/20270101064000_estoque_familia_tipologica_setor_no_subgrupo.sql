-- Família tipológica (o que o material é) × setor no subgrupo (onde se aplica).
--
-- Diagnóstico: a árvore Setor → Família → Grupo + o invariante mono-setor
-- impediam, por exemplo, TIRA STRASS (Componente, tira pronta) e TIRA OVERLOCK
-- (Material Base, artesanal) de viverem na mesma família TIRAS. Também
-- impediam NAPA SOFT (Forração da Palmilha) e NAPA TITANIUM (Cabedal) de
-- viverem na família FORRAÇÃO. A cascata de setor da família ainda
-- reclassificaria todos os filhos ao trocar o setor-padrão da família.
--
-- Esta migration NÃO move, NÃO renomeia e NÃO reclassifica grupos ou
-- produtos existentes. Só relaxa o invariante e interrompe a cascata
-- silenciosa. A reorganização dos cadastros atuais fica numa proposta
-- explícita, aplicada só com autorização.

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
      raise exception 'Família principal precisa ficar na raiz; não pode pertencer a outra família.'
        using errcode = '23514';
    end if;

    if exists (select 1 from public.products where group_id = new.id) then
      raise exception 'Este grupo ainda possui itens. Mova os itens antes de transformá-lo em família principal.'
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
      raise exception 'Família principal não encontrada.' using errcode = '23514';
    end if;

    if not coalesce(v_parent.is_family, false) then
      raise exception 'O destino precisa estar cadastrado como família principal.' using errcode = '23514';
    end if;

    if v_parent.parent_group_id is not null then
      raise exception 'Não é permitido aninhar família dentro de família (máx.: Família › Subgrupo › Cores).'
        using errcode = '23514';
    end if;

    if exists (select 1 from public.products where group_id = new.parent_group_id) then
      raise exception 'A família de destino tem itens diretos; esvazie-a antes de receber subgrupos.'
        using errcode = '23514';
    end if;

    -- O setor fica no subgrupo (onde o material é aplicado) e NÃO precisa
    -- coincidir com o setor-padrão da família (o que o material é).
    -- Vincular não reclassifica products.category.
  end if;
  return new;
end $$;

-- Trocar o setor-padrão da família não reclassifica os subgrupos.
-- Reclassificar um subgrupo continua ação explícita nele (e aí sim
-- cascateia para products.category pelo trigger já existente).
create or replace function public.fn_group_sector_cascade_children()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return null;
end $$;
