import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMrpNeeds, useGeneratePOFromMrp } from "@/hooks/useMrp";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { format, parseISO, differenceInDays, startOfDay } from "date-fns";
import { Warning as AlertTriangle, CircleNotch as Loader2, ShoppingCart } from '@phosphor-icons/react';
import ProductReservationDetailsDialog from "@/components/inventory/ProductReservationDetailsDialog";
import { supabase } from "@/integrations/supabase/client";
import { effectiveConversionFactor, type PurchaseConversionContext } from "@/lib/purchaseConversion";

// Unidades de compra DISCRETAS (não dá pra comprar fração) → Math.ceil no
// display. Contínuas (kg, g, m, L, dm²…) mantêm 2 casas decimais.
const DISCRETE_PURCHASE_UNITS = /^(placa|chapa|rolo|cx|caixa|un|unid|und|par|pc|pç|pct|pacote|balde|galao|galão|fardo|saco)s?$/i;

export function MrpNeedsTable() {
  const { data = [], isLoading } = useMrpNeeds();
  const genPO = useGeneratePOFromMrp();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Detalhamento de reserva por OP (reusa o dialog do estoque) — abre ao clicar
  // no valor "Reservado", pra ver qual OP está segurando o material.
  const [resvDialog, setResvDialog] = useState<{ id: string; name: string; unit: string } | null>(null);

  // v_mrp_needs não expõe purchase_unit/dimensions_width — busca os dados de
  // conversão direto de products pra exibir a sugestão em unidade de compra com
  // o MESMO fator usado no recebimento (effectiveConversionFactor prioriza a
  // largura da ficha pra m→dm², em vez de dividir só por conversion_rate).
  // Ids de PRODUTO (exclui linhas de embalagem — box_types não estão em products).
  const productIds = data.filter((d) => !d.is_packaging).map((d) => d.product_id);
  const productIdsKey = [...productIds].sort().join(',');
  const { data: convCtxById = new Map<string, PurchaseConversionContext>() } = useQuery({
    queryKey: ['mrp-needs-conversion-ctx', productIdsKey],
    enabled: productIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('products')
        .select('id, unit, purchase_unit, conversion_rate, dimensions_width')
        .in('id', productIds);
      if (error) throw error;
      return new Map<string, PurchaseConversionContext>(
        (rows || []).map((r: any) => [r.id as string, {
          unit: r.unit || 'un',
          purchase_unit: r.purchase_unit,
          conversion_rate: r.conversion_rate,
          dimensions_width: r.dimensions_width,
        }]),
      );
    },
  });

  // Só linhas de PRODUTO com sugestão > 0 são selecionáveis. Linhas de embalagem
  // (is_packaging) não geram OC aqui — a compra de caixa é feita em /embalagens —,
  // então ficam com checkbox disabled e fora do "selecionar todos".
  const isSelectable = (d: { suggested_qty: number; is_packaging?: boolean }) =>
    d.suggested_qty > 0 && !d.is_packaging;
  const selectableCount = data.filter(isSelectable).length;

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === selectableCount
        ? new Set()
        : new Set(data.filter(isSelectable).map((d) => d.product_id)),
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
          {data.length} {data.length === 1 ? 'insumo' : 'insumos'} com necessidade projetada
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
                checked={selected.size > 0 && selected.size === selectableCount}
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
                    disabled={!isSelectable(n)}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{n.product_name}</span>
                    {n.is_packaging && (
                      <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-semibold uppercase tracking-wide">
                        Embalagem
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {n.is_packaging ? (
                      <a href="/embalagens" className="underline decoration-dotted underline-offset-2 hover:text-primary">
                        comprar em Embalagens
                      </a>
                    ) : (
                      n.sku
                    )}
                  </div>
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
                  {Number(n.reserved) > 0 ? (
                    <button
                      type="button"
                      className="underline decoration-dotted underline-offset-2 hover:text-primary"
                      onClick={() => setResvDialog({ id: n.product_id, name: n.product_name, unit: n.unit })}
                      title="Ver quais OPs estão segurando este material"
                    >
                      {n.reserved}
                    </button>
                  ) : (
                    n.reserved
                  )}
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
                      {(() => {
                        const ctx = convCtxById.get(n.product_id);
                        const factor = ctx
                          ? effectiveConversionFactor(ctx)
                          : (n.conversion_rate || 1);
                        if (factor === 1 || factor <= 0) return null;
                        const purchaseUnit = ctx?.purchase_unit || n.purchase_unit || n.purchase_order_unit || 'un';
                        const inPurchaseUnit = n.suggested_qty / factor;
                        const display = DISCRETE_PURCHASE_UNITS.test(purchaseUnit.trim())
                          ? String(Math.ceil(inPurchaseUnit))
                          : inPurchaseUnit.toFixed(2);
                        return (
                          <span className="text-xs text-muted-foreground mt-0.5">
                            ({display} {purchaseUnit})
                          </span>
                        );
                      })()}
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

      <ProductReservationDetailsDialog
        productId={resvDialog?.id ?? null}
        productName={resvDialog?.name}
        unit={resvDialog?.unit}
        open={!!resvDialog}
        onOpenChange={(o) => { if (!o) setResvDialog(null); }}
      />
    </div>
  );
}
