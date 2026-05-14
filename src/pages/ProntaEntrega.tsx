import ReadyStockPanel from "@/components/inventory/ReadyStockPanel";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";

export default function ProntaEntregaPage() {
  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="Comercial · Estoque"
        title="Pronta Entrega"
        description="Gestão de estoque de pronta entrega"
      />
      <ReadyStockPanel />
    </div>
  );
}
