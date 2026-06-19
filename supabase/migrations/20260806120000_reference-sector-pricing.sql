-- ════════════════════════════════════════════════════════════════════════
-- reference_sector_pricing — custo de MÃO DE OBRA por par de uma referência,
-- detalhado por SETOR e baseado em TEMPO (minutos/par) × custo-hora.
--
-- Alimenta a aba "MOD por Setor" (/pricing-calculator → Markup). Diferente da
-- aba "Mão de Obra" (labor_cost_results), que guarda HORAS por linha, esta
-- guarda MINUTOS/par + custo-hora por setor (override por referência) e o
-- custo derivado. As duas convivem — modelos de dado distintos, retrocompat.
--
-- Fórmula (lado TS em src/lib/sectorPricing.ts, fonte da verdade):
--   custo/par do setor = (tempo_min / 60) × custo_hora
--   MOD/par da referência = Σ (custo/par dos setores)
-- O custo-hora default vem de sector_labor_rates (salário ÷ 220, sem encargos),
-- mas cada referência pode sobrescrever — por isso guardamos um SNAPSHOT do
-- custo-hora em cada linha (o total salvo não muda se o salário mudar depois).
--
-- `lines` (jsonb): [{ sector_key, time_per_pair_min, cost_per_hour, cost }, ...]
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.reference_sector_pricing (
  id          uuid primary key default gen_random_uuid(),
  reference   text not null,
  lines       jsonb not null default '[]'::jsonb,
  total_cost  numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_reference_sector_pricing_updated
  on public.reference_sector_pricing (updated_at desc);

alter table public.reference_sector_pricing enable row level security;

drop policy if exists "Auth users can view reference_sector_pricing" on public.reference_sector_pricing;
create policy "Auth users can view reference_sector_pricing"
  on public.reference_sector_pricing for select to authenticated using (true);

drop policy if exists "Auth users can insert reference_sector_pricing" on public.reference_sector_pricing;
create policy "Auth users can insert reference_sector_pricing"
  on public.reference_sector_pricing for insert to authenticated with check (true);

drop policy if exists "Auth users can update reference_sector_pricing" on public.reference_sector_pricing;
create policy "Auth users can update reference_sector_pricing"
  on public.reference_sector_pricing for update to authenticated using (true);

drop policy if exists "Auth users can delete reference_sector_pricing" on public.reference_sector_pricing;
create policy "Auth users can delete reference_sector_pricing"
  on public.reference_sector_pricing for delete to authenticated using (true);
