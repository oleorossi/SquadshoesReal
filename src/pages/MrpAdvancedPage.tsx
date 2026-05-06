import { MrpNeedsTable } from "@/components/mrp/MrpNeedsTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MrpAdvancedPage() {
  return (
    <div className="space-y-5 page-enter">
      <div>
        <h1 className="text-xl font-bold tracking-tight">MRP — Necessidade de Materiais</h1>
        <p className="text-muted-foreground">
          Demanda projetada a partir de todos os pedidos pendentes, descontando
          estoque disponível, reservas e pedidos de compra em aberto.
        </p>
      </div>
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
