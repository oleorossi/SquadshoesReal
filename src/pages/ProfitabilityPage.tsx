import { useProfitability } from "@/hooks/useOrderCost";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const BRL = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ProfitabilityPage() {
  const { data = [], isLoading } = useProfitability();

  return (
    <div className="p-6 space-y-5 page-enter">
      <h1 className="text-xl font-semibold">Lucratividade por Pedido</h1>
      <Card>
        <CardHeader>
          <CardTitle>Últimos pedidos com custo calculado</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground">Carregando...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
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
                {data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                      Nenhum pedido com custo calculado ainda.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
