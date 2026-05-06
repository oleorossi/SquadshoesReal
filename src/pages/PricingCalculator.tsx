import AppLayout from "@/components/layout/AppLayout";
import PricingCalculatorPanel from '@/components/financial/PricingCalculatorPanel';

export default function PricingCalculator() {
  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Markup</h1>
          <p className="text-muted-foreground">Simulador de precificação com markup e antecipação</p>
        </div>
        <PricingCalculatorPanel />
      </div>
    </AppLayout>
  );
}
