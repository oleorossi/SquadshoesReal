import { useOrderCost } from "@/hooks/useOrderCost";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CircleNotch as Loader2 } from '@phosphor-icons/react';

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function OrderCostCard({
  saleOrderId,
  saleOrderItemId,
}: {
  saleOrderId: string;
  saleOrderItemId?: string;
}) {
  const { data, isLoading, isError, error } = useOrderCost(
    saleOrderId,
    saleOrderItemId,
  );

  if (isLoading)
    return (
      <Card>
        <CardContent className="py-4 flex items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Calculando custo...
        </CardContent>
      </Card>
    );

  if (isError)
    return (
      <Card>
        <CardContent className="py-4 text-destructive">
          Erro ao calcular custo: {String(error)}
        </CardContent>
      </Card>
    );

  if (!data) return null;

  const marginPos = data.margin >= 0;
  const pct = Math.round(data.margin_pct * 1000) / 10;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>Custo de produção</span>
          <Badge variant={marginPos ? "default" : "destructive"}>
            Margem {pct}%
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Row label="Materiais" value={BRL(data.material_cost)} />
        <Row label="Mão-de-obra" value={BRL(data.labor_cost)} />
        <Row label="Overhead" value={BRL(data.overhead_cost)} />
        {data.packaging_cost > 0 && (
          <Row label="Embalagem" value={BRL(data.packaging_cost)} />
        )}
        <Row label="Custo total" value={BRL(data.total_cost)} bold />
        <Row label="Receita" value={BRL(data.revenue)} />
        <Row
          label="Margem"
          value={BRL(data.margin)}
          bold
          emphasis={marginPos ? "ok" : "bad"}
        />
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  bold,
  emphasis,
}: {
  label: string;
  value: string;
  bold?: boolean;
  emphasis?: "ok" | "bad";
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={[
          "tabular-nums",
          bold ? "font-semibold" : "",
          emphasis === "ok" ? "text-emerald-600" : "",
          emphasis === "bad" ? "text-destructive" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
