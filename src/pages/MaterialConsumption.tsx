import AppLayout from "@/components/layout/AppLayout";
import MaterialConsumptionTab from '@/components/production/MaterialConsumptionTab';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

export default function MaterialConsumption() {
  return (

      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="SUPRIMENTOS · CONSUMO MATERIAL"
          title="Consumo de Material"
          description="Análise de consumo de materiais por pedido e período"
        />
        <MaterialConsumptionTab />
      </div>

  );
}
