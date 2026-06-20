-- Ficha de Montadores — produtividade por montador (2026-06-20)
-- Adiciona vínculo a funcionário (montador) e produto (solado) + valor por par
-- (pagamento por produção). Antes montador/solado eram texto livre → relatório
-- de rendimento por pessoa era frágil. Aplicado via MCP (idempotente).
alter table public.ficha_montadores
  add column if not exists montador_id uuid references public.employees(id) on delete set null,
  add column if not exists solado_id uuid references public.products(id) on delete set null,
  add column if not exists valor_par numeric not null default 0;

create index if not exists ficha_montadores_montador_idx on public.ficha_montadores(montador_id);

-- Backfill best-effort do texto livre 'montador' → funcionário pelo nome (case/acento
-- insensível). Idempotente; no-op quando a tabela está vazia.
do $$
declare v_schema text;
begin
  select n.nspname into v_schema from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where p.proname='unaccent' limit 1;
  if v_schema is null then
    update public.ficha_montadores fm set montador_id = e.id
      from public.employees e
     where fm.montador_id is null and coalesce(btrim(fm.montador),'')<>''
       and lower(btrim(e.name)) = lower(btrim(fm.montador));
  else
    execute format($f$update public.ficha_montadores fm set montador_id = e.id
      from public.employees e
     where fm.montador_id is null and coalesce(btrim(fm.montador),'')<>''
       and lower(btrim(%I.unaccent(e.name))) = lower(btrim(%I.unaccent(fm.montador)))$f$, v_schema, v_schema);
  end if;
end $$;
