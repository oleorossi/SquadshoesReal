import AppLayout from "@/components/layout/AppLayout";
import MaterialConsumptionTab from '@/components/production/MaterialConsumptionTab';

export default function MaterialConsumption() {
  return (
    
      <div className="space-y-5 page-enter">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Consumo de Material</h1>
          <p className="text-sm text-muted-foreground">Análise de consumo de materiais por pedido e período</p>
        </div>
        <MaterialConsumptionTab />
      </div>
    
  );
}
