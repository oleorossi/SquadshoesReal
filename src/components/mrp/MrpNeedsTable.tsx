import { useState } from "react";
import { useMrpNeeds, useGeneratePOFromMrp } from "@/hooks/useMrp";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { format, parseISO, differenceInDays, startOfDay } from "date-fns";
import { Warning as AlertTriangle, CircleNotch as Loader2, ShoppingCart } from '@phosphor-icons/react';

export function MrpNeedsTable() {
  const { data = [], isLoading } = useMrpNeeds();
  const genPO = useGeneratePOFromMrp();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === data.length
        ? new Set()
        : new Set(data.filter((d) => d.suggested_qty > 0).map((d) => d.product_id)),
    );

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleGenerate = () =>
    genPO.mutate(selected.size > 0 ? [...selected] : undefined);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Calculando necessidades...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {data.length} insumo(s) com necessidade projetada
        </div>
        <Button
          onClick={handleGenerate}
          disabled={genPO.isPending || data.length === 0}
        >
          <ShoppingCart className="mr-2 h-4 w-4" />
          Gerar OC {selected.size > 0 ? `(${selected.size})` : "(todos)"}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40px]">
              <Checkbox
                checked={selected.size > 0 && selected.size === data.length}
                onCheckedChange={toggleAll}
              />
            </TableHead>
            <TableHead>Insumo</TableHead>
            <TableHead>Fornecedor</TableHead>
            <TableHead className="text-right">Estoque</TableHead>
            <TableHead className="text-right">Reservado</TableHead>
            <TableHead className="text-right">Em OC</TableHead>
            <TableHead className="text-right">Demanda</TableHead>
            <TableHead className="text-right">Sugestão (Estoque / OC)</TableHead>
            <TableHead>Comprar até</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((n) => {
            // Comparar apenas a data (sem hora) — evita off-by-one ao virar a meia-noite
            // ou quando user está em fuso negativo (UTC-3 BR).
            const urgent =
              n.order_by_date &&
              differenceInDays(startOfDay(parseISO(n.order_by_date)), startOfDay(new Date())) <= 3;
            return (
              <TableRow key={n.product_id}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(n.product_id)}
                    onCheckedChange={() => toggleRow(n.product_id)}
                    disabled={n.suggested_qty <= 0}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-medium">{n.product_name}</div>
                  <div className="text-xs text-muted-foreground">{n.sku}</div>
                </TableCell>
                <TableCell className="text-sm">
                  {n.supplier_name ?? (
                    <span className="italic text-muted-foreground">
                      sem fornecedor
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {n.on_hand} {n.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {n.reserved}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {n.qty_in_po}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {n.projected_demand}
                </TableCell>
                <TableCell className="text-right">
                  {n.suggested_qty > 0 ? (
                    <div className="flex flex-col items-end">
                      <Badge variant="destructive">{n.suggested_qty} {n.unit}</Badge>
                      {n.conversion_rate !== 1 && (
                        <span className="text-[10px] text-muted-foreground mt-0.5">
                          ({(n.suggested_qty / n.conversion_rate).toFixed(2)} {n.purchase_unit || n.purchase_order_unit || 'un'})
                        </span>
                      )}
                    </div>
                  ) : (
                    <Badge variant="secondary">0</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {n.order_by_date ? (
                    <div className="flex items-center gap-1">
                      {urgent && (
                        <AlertTriangle className="h-3 w-3 text-destructive" />
                      )}
                      <span
                        className={
                          urgent ? "text-destructive font-semibold" : ""
                        }
                      >
                        {format(parseISO(n.order_by_date), "dd/MM/yyyy")}
                      </span>
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {data.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-6 text-muted-foreground">
                Nenhuma necessidade de compra no momento.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
