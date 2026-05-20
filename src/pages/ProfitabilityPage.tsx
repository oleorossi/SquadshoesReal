import { useProfitability } from "@/hooks/useOrderCost";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ChartLineUp } from "@phosphor-icons/react";

const BRL = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ProfitabilityPage() {
  const { data = [], isLoading } = useProfitability();

  return (
    <div className="p-6 space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="CUSTOS · RENTABILIDADE"
        title="Lucratividade por Pedido"
      />
      <Panel
        eyebrow="CUSTOS · RENTABILIDADE"
        title="Últimos pedidos com custo calculado"
        subtitle={!isLoading ? `${data.length} ${data.length === 1 ? 'pedido' : 'pedidos'}` : undefined}
        flush
      >
        {isLoading ? (
          <div className="p-4 text-muted-foreground">Carregando...</div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={ChartLineUp}
            title="Nenhum pedido com custo calculado"
            description="Rode o cálculo de custos em um PV para vê-lo aparecer aqui."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead>Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Un.</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead>%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r: any) => {
                const pct = Math.round((r.margin_pct ?? 0) * 1000) / 10;
                const pos = (r.total_margin ?? 0) >= 0;
                return (
                  <TableRow key={r.sale_order_id}>
                    <TableCell className="font-mono">
                      {r.order_number}
                    </TableCell>
                    <TableCell>{r.client_name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.total_units ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {BRL(r.total_cost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {BRL(r.total_revenue)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        pos ? "text-emerald-600" : "text-destructive"
                      }`}
                    >
                      {BRL(r.total_margin)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={pos ? "default" : "destructive"}>
                        {pct}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
