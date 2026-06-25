-- ════════════════════════════════════════════════════════════════════════
-- reference_sector_pricing.efficiency_pct — eficiência produtiva da MO.
--
-- Contexto: a aba "MOD por Setor" (/pricing-calculator → Markup) custeava a mão
-- de obra como custo-hora ÷ pares/hora, somado por setor. Faltava o único
-- carregamento que o negócio aplica sobre a MO (operadores são MEI ⇒ SEM encargos
-- patronais): a EFICIÊNCIA PRODUTIVA. Hora paga / capacidade teórica não viram
-- 100% de pares — absenteísmo, setup/troca, paradas de máquina, retrabalho e
-- refugo comem parte da jornada. O custo de MO se dilui em MENOS pares, então o
-- custo/par REAL = custo bruto ÷ eficiência (η < 1 ⇒ custo maior).
--
--   total_cost (salvo) = (Σ line.cost) ÷ (efficiency_pct / 100)
--
-- Lado TS (fonte da verdade): src/lib/sectorPricing.ts (adjustForEfficiency).
--
-- Retrocompat: linhas já salvas foram calculadas SEM ajuste (η = 100%). A coluna
-- entra com DEFAULT 100, então o total_cost histórico continua coerente
-- (bruto ÷ 1,00 = bruto) — nada muda pra referências antigas até serem reabertas
-- e re-salvas com a eficiência desejada.
-- ════════════════════════════════════════════════════════════════════════

alter table public.reference_sector_pricing
  add column if not exists efficiency_pct numeric not null default 100;

-- Sanidade: eficiência fora de (0, 100] não faz sentido (η=0 ⇒ custo infinito;
-- η>100 ⇒ desconto). Mantém o dado válido na origem.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reference_sector_pricing_efficiency_pct_range'
  ) then
    alter table public.reference_sector_pricing
      add constraint reference_sector_pricing_efficiency_pct_range
      check (efficiency_pct > 0 and efficiency_pct <= 100);
  end if;
end $$;
