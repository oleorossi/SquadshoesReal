-- ════════════════════════════════════════════════════════════════════════
-- sector_labor_rates — valor-hora (R$/h) por setor produtivo.
--
-- Fonte da calculadora manual de custo de MO (aba "Mão de Obra" em
-- /pricing-calculator). O usuário cadastra um valor-hora por setor; a aba
-- puxa esse valor e multiplica pelo tempo (horas) que ele preenche.
--
-- Chave = SectorKey canônico de src/lib/sectors.ts (corte_palmilha,
-- corte_forracao, costura, mesa, silk, colagem, montagem, solagem,
-- acabamento, expedicao) — NÃO o label de exibição, pra não sofrer drift.
--
-- Tabela própria e independente da folha (employees.salary) e do custeio por
-- operação (labor_costs, que está vazio neste banco).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.sector_labor_rates (
  sector_key  text primary key,
  hourly_rate numeric not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.sector_labor_rates enable row level security;

drop policy if exists "Auth users can view sector_labor_rates" on public.sector_labor_rates;
create policy "Auth users can view sector_labor_rates"
  on public.sector_labor_rates for select to authenticated using (true);

drop policy if exists "Auth users can insert sector_labor_rates" on public.sector_labor_rates;
create policy "Auth users can insert sector_labor_rates"
  on public.sector_labor_rates for insert to authenticated with check (true);

drop policy if exists "Auth users can update sector_labor_rates" on public.sector_labor_rates;
create policy "Auth users can update sector_labor_rates"
  on public.sector_labor_rates for update to authenticated using (true);

drop policy if exists "Auth users can delete sector_labor_rates" on public.sector_labor_rates;
create policy "Auth users can delete sector_labor_rates"
  on public.sector_labor_rates for delete to authenticated using (true);

-- Semeia os setores canônicos com valor-hora 0 (usuário preenche na aba).
insert into public.sector_labor_rates (sector_key, hourly_rate) values
  ('corte_palmilha', 0),
  ('corte_forracao', 0),
  ('costura',        0),
  ('mesa',           0),
  ('silk',           0),
  ('colagem',        0),
  ('montagem',       0),
  ('solagem',        0),
  ('acabamento',     0),
  ('expedicao',      0)
on conflict (sector_key) do nothing;
