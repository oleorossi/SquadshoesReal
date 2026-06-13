-- ════════════════════════════════════════════════════════════════════════
-- labor_cost_results — resultados salvos da calculadora manual de custo de MO.
--
-- A aba "Mão de Obra" (/pricing-calculator) deixa o usuário salvar o cálculo
-- de uma referência: rótulo + linhas (setor/horas) + total. Guarda um SNAPSHOT
-- do valor-hora de cada linha pra o total salvo ficar estável mesmo que o
-- valor-hora do setor (sector_labor_rates) mude depois.
--
-- `lines` (jsonb): [{ sector_key, hours, hourly_rate, cost }, ...]
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.labor_cost_results (
  id          uuid primary key default gen_random_uuid(),
  reference   text not null,
  lines       jsonb not null default '[]'::jsonb,
  total_cost  numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_labor_cost_results_updated on public.labor_cost_results (updated_at desc);

alter table public.labor_cost_results enable row level security;

drop policy if exists "Auth users can view labor_cost_results" on public.labor_cost_results;
create policy "Auth users can view labor_cost_results"
  on public.labor_cost_results for select to authenticated using (true);

drop policy if exists "Auth users can insert labor_cost_results" on public.labor_cost_results;
create policy "Auth users can insert labor_cost_results"
  on public.labor_cost_results for insert to authenticated with check (true);

drop policy if exists "Auth users can update labor_cost_results" on public.labor_cost_results;
create policy "Auth users can update labor_cost_results"
  on public.labor_cost_results for update to authenticated using (true);

drop policy if exists "Auth users can delete labor_cost_results" on public.labor_cost_results;
create policy "Auth users can delete labor_cost_results"
  on public.labor_cost_results for delete to authenticated using (true);
