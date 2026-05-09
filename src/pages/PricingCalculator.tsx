import PricingCalculatorPanel from '@/components/financial/PricingCalculatorPanel';

export default function PricingCalculator() {
  return (
    <div className="space-y-5 page-enter">
      {/* Header — Novidade editorial */}
      <div>
        <div className="eyebrow">Financeiro · Precificação</div>
        <h1 className="display text-2xl mt-1.5 sm:text-3xl">Markup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Simulador de custo do produto e margem — combina insumos, mão de obra, overhead, frete,
          impostos, comissões e factoring para mostrar o preço de venda mínimo e a margem real por par.
        </p>
      </div>
      <PricingCalculatorPanel />
    </div>
  );
}
