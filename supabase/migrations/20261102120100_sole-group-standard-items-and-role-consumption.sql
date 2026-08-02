-- ============================================================================
-- Fase 2 do épico "Consumo padrão por modelo de solado".
--
-- OBJETIVO: um único cadastro de consumo padrão POR MODELO (grupo) de solado,
-- com duas naturezas de linha:
--
--   ITEM  — o solado manda no material E na quantidade (cola, linha, EVA).
--           Mora aqui, em `sole_group_standard_items`.
--
--   PAPEL — o solado manda só na quantidade; o material é escolhido pela ficha
--           do modelo / PV (forro do cabedal, placa e forração da palmilha,
--           fachete). Continua morando em `sole_technical_specs`, que é a fonte
--           canônica lida pelo motor TS (orderConsumption.ts) E pelo SQL
--           (calculate_order_consumption_by_grade). NÃO movemos esse dado: a
--           reescrita da resolução de forro/palmilha nos dois motores é a parte
--           mais delicada do sistema e não é pré-requisito da tela única.
--           O que muda é a ESCRITA — passa a ser por grupo, via
--           `set_sole_group_role_consumption`, espelhando em todas as cores.
--
-- POR QUE POR GRUPO: hoje `sole_technical_specs.sole_id` aponta pro PRODUTO,
-- então cada modelo é preenchido uma vez por cor (11 SKUs para 5 modelos).
-- Auditoria de 02/08/2026: os valores são IDÊNTICOS entre PRETO e CARAMELO em
-- todas as 7 numerações dos 5 grupos — zero divergência. Consolidar é sem perda.
-- ============================================================================

-- 1) ITEM: consumo padrão por grupo de solado ---------------------------------
create table if not exists public.sole_group_standard_items (
  id uuid primary key default gen_random_uuid(),
  sole_group_id uuid not null references public.product_groups(id) on delete cascade,
  material_product_id uuid not null references public.products(id) on delete restrict,

  -- Quantidade por par. É o caminho normal: um número, sem grade.
  consumption_per_pair numeric not null default 0 check (consumption_per_pair >= 0),

  -- Grade opcional { "33": 0.28, "34": 0.30, ... }. Só para itens que escalam
  -- com o tamanho. Vazio = usa `consumption_per_pair` em todas as numerações.
  consumption_per_size jsonb not null default '{}'::jsonb,

  -- Unidade de consumo. NULL = herda `products.unit` do material.
  unit text,

  -- Espelha a semântica já usada em sole_standard_materials.
  applies_to text not null default 'any'
    check (applies_to in ('any', 'palmilha_cortada', 'palmilha_pronta')),

  notes text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sole_group_standard_items_unique
    unique (sole_group_id, material_product_id, applies_to)
);

comment on table public.sole_group_standard_items is
  'Consumo padrão de materiais por MODELO (grupo) de solado — linhas do tipo ITEM. Toda referência que usar um solado deste grupo herda estes materiais por vínculo vivo (sem cópia no BOM da ficha).';
comment on column public.sole_group_standard_items.consumption_per_size is
  'Grade opcional por numeração. Vazio ⇒ consumption_per_pair vale para todas.';

create index if not exists idx_sgsi_group on public.sole_group_standard_items(sole_group_id);
create index if not exists idx_sgsi_material on public.sole_group_standard_items(material_product_id);

drop trigger if exists tg_sgsi_updated_at on public.sole_group_standard_items;
create trigger tg_sgsi_updated_at
  before update on public.sole_group_standard_items
  for each row execute function public.set_updated_at();

alter table public.sole_group_standard_items enable row level security;

drop policy if exists sole_group_standard_items_select on public.sole_group_standard_items;
create policy sole_group_standard_items_select
  on public.sole_group_standard_items for select using (true);

drop policy if exists sole_group_standard_items_write on public.sole_group_standard_items;
create policy sole_group_standard_items_write
  on public.sole_group_standard_items for all
  using (public.user_has_any_role(array['admin', 'gerente']))
  with check (public.user_has_any_role(array['admin', 'gerente']));

-- 2) Migra o legado por PRODUTO para o novo cadastro por GRUPO ----------------
-- `sole_standard_items_consumption` tem 42 linhas: 3 colas no SOLADO 01, cada
-- uma com 14 numerações e valor CONSTANTE (min = max). Vira 1 linha por cola.
insert into public.sole_group_standard_items
  (sole_group_id, material_product_id, consumption_per_pair, consumption_per_size, unit, notes)
select
  p_sole.group_id,
  c.standard_item_id,
  round(avg(c.consumption)::numeric, 4),
  case
    when count(distinct c.consumption) > 1
      then jsonb_object_agg(c.size::text, c.consumption)
    else '{}'::jsonb
  end,
  max(c.unit),
  'Migrado de sole_standard_items_consumption em 02/08/2026'
from public.sole_standard_items_consumption c
join public.products p_sole on p_sole.id = c.sole_product_id
where p_sole.group_id is not null
group by p_sole.group_id, c.standard_item_id
on conflict (sole_group_id, material_product_id, applies_to) do nothing;

-- 3) PAPEL: escrita por GRUPO, espelhada em todas as cores --------------------
-- SECURITY INVOKER de propósito: a RLS de sole_technical_specs
-- (rls_sole_technical_specs_write, admin/gerente) continua valendo. Um
-- SECURITY DEFINER aqui seria executável via anon key — ver auditoria P0 de
-- 01/08/2026 sobre RPCs SECURITY DEFINER sem guard.
create or replace function public.set_sole_group_role_consumption(
  p_sole_group_id uuid,
  p_role text,
  p_per_pair numeric,
  p_per_size jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_scalar_col text;
  v_persize_col text;
  v_rows integer := 0;
  v_sole record;
  v_size numeric;
  v_value numeric;
begin
  -- Mapeia o papel para as colunas canônicas de sole_technical_specs.
  case p_role
    when 'forro_cabedal'      then v_scalar_col := 'lining_consumption_dm2';
                                   v_persize_col := 'lining_consumption_per_size';
    when 'placa_palmilha'     then v_scalar_col := 'insole_consumption_dm2';
                                   v_persize_col := 'insole_consumption_per_size';
    when 'forracao_palmilha'  then v_scalar_col := 'insole_lining_consumption_dm2';
                                   v_persize_col := 'insole_lining_consumption_per_size';
    when 'fachete'            then v_scalar_col := 'fachete_lining_consumption_dm2';
                                   v_persize_col := 'fachete_lining_consumption_per_size';
    else raise exception 'Papel desconhecido: %. Use forro_cabedal, placa_palmilha, forracao_palmilha ou fachete.', p_role;
  end case;

  -- Para cada SKU de cor do grupo, para cada numeração já existente na grade
  -- do solado, grava o valor. A grade é a que já está em sole_technical_specs —
  -- este RPC ajusta consumo, nunca cria numeração nova.
  for v_sole in
    select id from public.products
    where group_id = p_sole_group_id
      and (category ilike '%solado%' or lower(category) = 'sola')
  loop
    for v_size in
      select distinct size from public.sole_technical_specs where sole_id = v_sole.id
    loop
      v_value := coalesce((p_per_size ->> v_size::text)::numeric, p_per_pair);

      execute format(
        'update public.sole_technical_specs set %I = $1, %I = $2, updated_at = now() where sole_id = $3 and size = $4',
        v_scalar_col, v_persize_col
      ) using v_value, p_per_size, v_sole.id, v_size;

      v_rows := v_rows + 1;
    end loop;
  end loop;

  return v_rows;
end;
$$;

comment on function public.set_sole_group_role_consumption(uuid, text, numeric, jsonb) is
  'Grava o consumo de um PAPEL (forro do cabedal, placa/forração da palmilha, fachete) em todas as cores e numerações de um grupo de solado. É o caminho de escrita da tela "Consumo padrão do modelo".';

revoke all on function public.set_sole_group_role_consumption(uuid, text, numeric, jsonb) from anon;
