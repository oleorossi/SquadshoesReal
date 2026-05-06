import ReadyStockPanel from "@/components/inventory/ReadyStockPanel";

export default function ProntaEntregaPage() {
  return (
    <div className="space-y-5 page-enter">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Pronta Entrega</h1>
        <p className="text-sm text-muted-foreground">Gestão de estoque de pronta entrega</p>
      </div>
      <ReadyStockPanel />
    </div>
  );
}
