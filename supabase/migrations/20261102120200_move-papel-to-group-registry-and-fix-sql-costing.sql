-- ============================================================================
-- Fase 4 do épico "Consumo padrão por modelo de solado" — as duas pontas que
-- ficaram de fora em 20261102120100:
--
--   (1) MOVER o PAPEL (forro do cabedal, placa/forração da palmilha, fachete)
--       para `sole_group_standard_items`, que passa a ser a FONTE DA VERDADE.
--       `sole_technical_specs` vira ESPELHO DERIVADO, mantido por trigger.
--
--   (2) CORRIGIR o custeio/MRP: `calculate_order_consumption_by_grade` passa a
--       enxergar os itens do MODELO (cola, linha, EVA), que hoje só o motor TS
--       via — item novo sem equivalente no legado deixava o custo ABAIXO do
--       consumo real.
--
-- POR QUE ESPELHO E NÃO CORTE SECO: 12 funções SQL leem `sole_technical_specs`
-- (calculate_order_consumption_by_grade, check_stock_availability,
-- consumption_consistency_report, run_consumption_integration_tests,
-- copy_sole_specs_from, get_sole_consumption_per_size…), além do motor TS. O
-- cadastro muda de lugar; os leitores continuam lendo o que sempre leram, com
-- o dado agora sincronizado a partir da origem única. Migrar leitor a leitor
-- fica possível depois, sem pressa e sem risco de paridade.
-- ============================================================================

-- ── 1. PAPEL como linha de primeira classe ───────────────────────────────────

alter table public.sole_group_standard_items
  alter column material_product_id drop not null;

alter table public.sole_group_standard_items
  add column if not exists role text
  check (role is null or role in ('forro_cabedal', 'placa_palmilha', 'forracao_palmilha', 'fachete'));

comment on column public.sole_group_standard_items.role is
  'Preenchido = linha PAPEL (o solado define a quantidade; o material vem da ficha/PV). NULL = linha ITEM (material_product_id define o material).';

-- Exatamente uma das duas naturezas por linha.
alter table public.sole_group_standard_items
  drop constraint if exists sole_group_standard_items_kind;
alter table public.sole_group_standard_items
  add constraint sole_group_standard_items_kind check (
    (material_product_id is not null and role is null)
    or (material_product_id is null and role is not null)
  );

-- A UNIQUE original não trava PAPEL: material_product_id NULL é distinto de si
-- mesmo em Postgres. Um índice parcial cuida do papel.
create unique index if not exists sole_group_standard_items_role_unique
  on public.sole_group_standard_items(sole_group_id, role)
  where role is not null;

-- ── 2. Migra os valores de sole_technical_specs → linhas PAPEL ───────────────
-- Colapsa por grupo: auditoria de 02/08/2026 mediu valores IDÊNTICOS entre as
-- variantes de cor nas 7 numerações dos 5 grupos, então a primeira variante
-- que tiver valor representa o modelo.
with grade as (
  select p.group_id,
         sts.size,
         max(sts.lining_consumption_dm2)         as forro_cabedal,
         max(sts.insole_consumption_dm2)         as placa_palmilha,
         max(sts.insole_lining_consumption_dm2)  as forracao_palmilha,
         max(sts.fachete_lining_consumption_dm2) as fachete
    from public.sole_technical_specs sts
    join public.products p on p.id = sts.sole_id
   where p.group_id is not null
   group by p.group_id, sts.size
),
unpivot as (
  select group_id, size, 'forro_cabedal'     as role, forro_cabedal     as v from grade
  union all select group_id, size, 'placa_palmilha',     placa_palmilha     from grade
  union all select group_id, size, 'forracao_palmilha',  forracao_palmilha  from grade
  union all select group_id, size, 'fachete',            fachete            from grade
),
agg as (
  select group_id, role,
         round(avg(v)::numeric, 4)                       as per_pair,
         jsonb_object_agg(size::text, v)                 as per_size,
         count(distinct v)                               as valores_distintos
    from unpivot
   where v is not null and v > 0
   group by group_id, role
)
insert into public.sole_group_standard_items
  (sole_group_id, role, consumption_per_pair, consumption_per_size, unit, notes, display_order)
select group_id, role, per_pair,
       -- Grade só quando as numerações realmente divergem; senão o valor único
       -- basta e a tela não precisa abrir 7 células.
       case when valores_distintos > 1 then per_size else '{}'::jsonb end,
       'dm²',
       'Migrado de sole_technical_specs em 02/08/2026',
       case role when 'forro_cabedal' then 0 when 'placa_palmilha' then 1
                 when 'forracao_palmilha' then 2 else 3 end
  from agg
on conflict do nothing;

-- ── 3. Espelho: PAPEL → sole_technical_specs ─────────────────────────────────
create or replace function public.tg_mirror_sole_papel_to_specs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_group uuid;
  v_scalar_col text;
  v_persize_col text;
  v_sole record;
  v_size integer;
  v_value numeric;
  v_per_pair numeric;
  v_per_size jsonb;
begin
  -- DELETE zera; INSERT/UPDATE grava o valor vigente.
  if TG_OP = 'DELETE' then
    v_role := OLD.role; v_group := OLD.sole_group_id;
    v_per_pair := 0; v_per_size := '{}'::jsonb;
  else
    v_role := NEW.role; v_group := NEW.sole_group_id;
    v_per_pair := NEW.consumption_per_pair; v_per_size := NEW.consumption_per_size;
  end if;

  if v_role is null then
    return coalesce(NEW, OLD); -- linha ITEM: não espelha
  end if;

  case v_role
    when 'forro_cabedal'     then v_scalar_col := 'lining_consumption_dm2';
                                  v_persize_col := 'lining_consumption_per_size';
    when 'placa_palmilha'    then v_scalar_col := 'insole_consumption_dm2';
                                  v_persize_col := 'insole_consumption_per_size';
    when 'forracao_palmilha' then v_scalar_col := 'insole_lining_consumption_dm2';
                                  v_persize_col := 'insole_lining_consumption_per_size';
    when 'fachete'           then v_scalar_col := 'fachete_lining_consumption_dm2';
                                  v_persize_col := 'fachete_lining_consumption_per_size';
  end case;

  for v_sole in
    select id from public.products
     where group_id = v_group
       and (category ilike '%solado%' or lower(category) = 'sola')
  loop
    for v_size in
      select distinct size from public.sole_technical_specs where sole_id = v_sole.id
    loop
      v_value := coalesce((v_per_size ->> v_size::text)::numeric, v_per_pair);
      execute format(
        'update public.sole_technical_specs set %I = $1, %I = $2, updated_at = now() where sole_id = $3 and size = $4',
        v_scalar_col, v_persize_col
      ) using v_value, v_per_size, v_sole.id, v_size;
    end loop;
  end loop;

  return coalesce(NEW, OLD);
end;
$$;

comment on function public.tg_mirror_sole_papel_to_specs() is
  'Espelha as linhas PAPEL de sole_group_standard_items (fonte da verdade) nas colunas de consumo de sole_technical_specs, em todas as cores e numeracoes do grupo. SECURITY DEFINER de proposito: e um trigger interno, nao ha superficie de chamada direta.';

drop trigger if exists tg_sgsi_mirror_papel on public.sole_group_standard_items;
create trigger tg_sgsi_mirror_papel
  after insert or update or delete on public.sole_group_standard_items
  for each row execute function public.tg_mirror_sole_papel_to_specs();

-- O RPC de escrita por grupo deixa de existir: a escrita agora é um upsert
-- normal na tabela de origem, e o trigger acima cuida do espelho.
drop function if exists public.set_sole_group_role_consumption(uuid, text, numeric, jsonb);

-- ── 4. Custeio/MRP enxergando os itens do MODELO ─────────────────────────────
-- Substitui APENAS o SELECT do laço "Item padrão (solado)" dentro de
-- calculate_order_consumption_by_grade. O cadastro por modelo entra e, para o
-- MESMO produto, VENCE o legado por numeração — idêntico à precedência do
-- motor TS (orderConsumption.ts, `groupStdProductIds`).
do $do$
declare
  v_src text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'calculate_order_consumption_by_grade';

  v_old := 'SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit'
        || E'\n          FROM sole_standard_items_consumption ssic'
        || E'\n         WHERE ssic.sole_product_id = v_sole_product_id AND ssic.size = v_size AND ssic.consumption > 0';

  if position(v_old in v_src) = 0 then
    raise exception 'Trecho alvo nao encontrado em calculate_order_consumption_by_grade — a funcao mudou; revise a migration antes de aplicar.';
  end if;

  v_new := 'SELECT sgsi.material_product_id AS pid,'
        || E'\n               COALESCE(NULLIF((sgsi.consumption_per_size ->> v_size::text)::numeric, 0), sgsi.consumption_per_pair) AS cons,'
        || E'\n               COALESCE(sgsi.unit, pstd.unit) AS unit'
        || E'\n          FROM sole_group_standard_items sgsi'
        || E'\n          JOIN products psole ON psole.id = v_sole_product_id'
        || E'\n          JOIN products pstd  ON pstd.id  = sgsi.material_product_id'
        || E'\n         WHERE sgsi.sole_group_id = psole.group_id'
        || E'\n           AND sgsi.role IS NULL'
        || E'\n           AND COALESCE(NULLIF((sgsi.consumption_per_size ->> v_size::text)::numeric, 0), sgsi.consumption_per_pair) > 0'
        || E'\n        UNION ALL'
        || E'\n        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit'
        || E'\n          FROM sole_standard_items_consumption ssic'
        || E'\n         WHERE ssic.sole_product_id = v_sole_product_id AND ssic.size = v_size AND ssic.consumption > 0'
        || E'\n           AND NOT EXISTS ('
        || E'\n                 SELECT 1 FROM sole_group_standard_items sg2'
        || E'\n                   JOIN products ps2 ON ps2.id = v_sole_product_id'
        || E'\n                  WHERE sg2.sole_group_id = ps2.group_id'
        || E'\n                    AND sg2.role IS NULL'
        || E'\n                    AND sg2.material_product_id = ssic.standard_item_id)';

  execute replace(v_src, v_old, v_new);
end
$do$;
