import MaterialConsumptionTab from '@/components/production/MaterialConsumptionTab';
import FichaVariancePanel from '@/components/production/FichaVariancePanel';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

export default function MaterialConsumption() {
  return (
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="SUPRIMENTOS · CONSUMO MATERIAL"
          title="Consumo de Material"
          description="Explosão da ficha por pedido e auditoria teórico × real baixado"
        />
        <MaterialConsumptionTab />
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Auditoria ficha × estoque
          </h2>
          <FichaVariancePanel />
        </div>
      </div>
  );
}
