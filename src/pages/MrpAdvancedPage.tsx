import { MrpNeedsTable } from "@/components/mrp/MrpNeedsTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

export default function MrpAdvancedPage() {
  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="SUPRIMENTOS · MRP"
        title="MRP — Necessidade de Materiais"
        description="Demanda projetada a partir de todos os pedidos pendentes, descontando estoque disponível, reservas e pedidos de compra em aberto."
      />
      <Card>
        <CardHeader>
          <CardTitle>Sugestões de compra</CardTitle>
        </CardHeader>
        <CardContent>
          <MrpNeedsTable />
        </CardContent>
      </Card>
    </div>
  );
}
