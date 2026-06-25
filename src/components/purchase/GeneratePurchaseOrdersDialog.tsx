import { Fragment, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  CircleNotch as Loader2,
  Warning as AlertTriangle,
  CaretDown as ChevronDown,
  Package,
  ShoppingCart,
  FileText,
} from '@phosphor-icons/react';
import { formatCurrency } from '@/lib/utils';
import { useMaterialsPerPv, useGeneratePerPvPurchaseOrders } from '@/hooks/usePerPvPurchasing';
import { useProducts } from '@/hooks/useProducts';
import { effectivePurchaseMultiple } from '@/lib/purchaseMultiple';
import { buildPerPvPurchaseOrders, summarizePerPvDrafts, NO_SUPPLIER_LABEL } from '@/lib/perPvPurchasing';
import { printPerPvMaterials } from '@/lib/printPerPvMaterials';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** PV ids alvo (1 = single-PV; N = seleção da lista). */
  pvIds: string[];
  /** Rótulos dos PVs ("PV-2026-00144") pra header + notas das OCs. */
  pvNumbers?: string[];
  /** Disparado após gerar com sucesso (ex.: abrir aba "Compras deste PV"). */
  onGenerated?: (createdIds: string[]) => void;
};

/**
 * Modal do canal "Compras por Pedido". Mostra os materiais necessários do(s)
 * PV(s) agrupados por fornecedor (+ balde "Sem Fornecedor") e gera uma OC por
 * grupo com source_type='per_pv'. Não interfere no MRP/ondas.
 */
export default function GeneratePurchaseOrdersDialog({ open, onOpenChange, pvIds, pvNumbers, onGenerated }: Props) {
  const [netOfStock, setNetOfStock] = useState(false);
  const { data: needs = [], isLoading, isError, error } = useMaterialsPerPv(open ? pvIds : null);
  const { data: products = [] } = useProducts();
  const generate = useGeneratePerPvPurchaseOrders();

  // Enriquece cada necessidade com o múltiplo de compra efetivo (item→grupo),
  // pra buildPerPvPurchaseOrders arredondar a quantidade pra cima (187 → 200).
  const multipleByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products as any[]) {
      m.set(p.id, effectivePurchaseMultiple(p.purchase_multiple, p.product_groups?.purchase_multiple));
    }
    return m;
  }, [products]);

  const enrichedNeeds = useMemo(
    () => needs.map((n: any) => ({ ...n, purchase_multiple: multipleByProduct.get(n.material_id) ?? null })),
    [needs, multipleByProduct],
  );

  const drafts = useMemo(
    () => buildPerPvPurchaseOrders(enrichedNeeds, { netOfStock }),
    [enrichedNeeds, netOfStock],
  );
  const summary = useMemo(() => summarizePerPvDrafts(drafts), [drafts]);

  const titleScope = pvIds.length === 1
    ? (pvNumbers?.[0] || 'pedido')
    : `${pvIds.length} pedidos`;

  const handleGenerate = async () => {
    try {
      const res = await generate.mutateAsync({ pvIds, pvNumbers, drafts });
      onGenerated?.(res.createdIds);
      onOpenChange(false);
    } catch {
      /* erro já exibido via toast no hook */
    }
  };

  const handlePrintPdf = () => {
    const ok = printPerPvMaterials({ scopeLabel: titleScope, pvNumbers: pvNumbers || [], drafts, netOfStock, summary });
    if (!ok) toast.error('Não foi possível abrir a janela de impressão. Permita pop-ups para este site.');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Materiais necessários para {titleScope}
          </DialogTitle>
          <DialogDescription>
            Gera uma Ordem de Compra por fornecedor (+ uma agrupada "Sem Fornecedor").
            Estas OCs ficam no canal <strong>Compras por Pedido</strong> — separadas do MRP/ondas.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Calculando materiais...
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Falha ao calcular materiais: {(error as Error)?.message || 'erro desconhecido'}.
            {' '}Verifique se a migration <code>compute_materials_per_pv</code> já foi aplicada no banco.
          </div>
        )}

        {!isLoading && !isError && drafts.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Package className="h-8 w-8" />
            <p className="text-sm">
              {netOfStock
                ? 'Nenhum material em falta — o estoque cobre este(s) pedido(s).'
                : 'Nenhum material necessário encontrado para este(s) pedido(s).'}
            </p>
          </div>
        )}

        {!isLoading && !isError && drafts.length > 0 && (
          <div className="space-y-4">
            {/* Opção de netar estoque */}
            <div className="flex items-center gap-2">
              <Checkbox id="net-of-stock" checked={netOfStock} onCheckedChange={(v) => setNetOfStock(!!v)} />
              <Label htmlFor="net-of-stock" className="text-sm font-normal cursor-pointer">
                Descontar estoque disponível (comprar só a falta líquida)
              </Label>
            </div>

            {/* Legenda do excedente por múltiplo de compra (só quando há) */}
            {drafts.some((d) => d.items.some((it) => (it.rounding_surplus ?? 0) > 0)) && (
              <p className="text-xs text-muted-foreground">
                Na coluna <strong>A comprar</strong>, o valor em{' '}
                <span className="text-blue-600 dark:text-blue-400 font-medium">azul</span> é o
                excedente comprado a mais pra fechar o múltiplo de compra (embalagem).
              </p>
            )}

            {/* Aviso "Sem Fornecedor" */}
            {summary.hasNoSupplier && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {summary.noSupplierItemCount} item(ns) sem fornecedor cadastrado serão agrupados
                  numa única OC <strong>"{NO_SUPPLIER_LABEL}"</strong>. Cadastre o fornecedor do
                  produto pra direcionar automaticamente nas próximas vezes.
                </span>
              </div>
            )}

            {/* Grupos por fornecedor */}
            {drafts.map((d) => (
              <Collapsible key={d.supplier_id ?? '__none__'} defaultOpen className="rounded-lg border">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 hover:bg-muted/40 [&[data-state=open]>svg]:rotate-180">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`font-semibold truncate ${d.supplier_id === null ? 'text-amber-700' : ''}`}>
                      {d.supplier_name}
                    </span>
                    <Badge variant="outline" className="shrink-0">{d.items.length} item(ns)</Badge>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-medium tabular-nums">{formatCurrency(d.total)}</span>
                    <ChevronDown className="h-4 w-4 transition-transform text-muted-foreground" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Table className="[&_td]:py-1.5 [&_th]:py-1.5">
                    <TableHeader>
                      <TableRow className="[&_th]:text-xs [&_th]:text-muted-foreground">
                        <TableHead>Material</TableHead>
                        <TableHead>Cor</TableHead>
                        <TableHead className="text-right">Necessário</TableHead>
                        <TableHead className="text-right">Estoque</TableHead>
                        <TableHead className="text-right">A comprar</TableHead>
                        <TableHead>Unid.</TableHead>
                        <TableHead className="text-right">Preço est.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.items.map((it) => {
                        const gradeSizes = it.grade ? Object.keys(it.grade).filter((k) => (it.grade![k] ?? 0) > 0) : [];
                        return (
                        <Fragment key={`${it.material_id}::${it.color ?? ''}`}>
                        <TableRow className={gradeSizes.length > 0 ? '[&>td]:border-b-0' : ''}>
                          <TableCell className="font-medium">{it.product_name}</TableCell>
                          <TableCell className="text-muted-foreground">{it.color || '—'}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {it.needed_qty.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {it.stock_qty.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {it.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                            {(it.rounding_surplus ?? 0) > 0 && (
                              <span
                                className="ml-1 text-blue-600 dark:text-blue-400 font-medium"
                                title={`+${(it.rounding_surplus ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} comprado a mais pra fechar o múltiplo de compra (embalagem)`}
                              >
                                +{(it.rounding_surplus ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{it.unit}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(it.unit_price)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(it.quantity * it.unit_price)}</TableCell>
                        </TableRow>
                        {gradeSizes.length > 0 && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={8} className="pt-0">
                              <div className="flex flex-wrap items-center gap-1 pl-1">
                                <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Grade · numeração</span>
                                {gradeSizes.sort((a, b) => parseFloat(a) - parseFloat(b)).map((sz) => (
                                  <span key={sz} className="inline-flex items-baseline gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px]">
                                    <span className="font-mono text-muted-foreground">{sz}</span>
                                    <span className="font-semibold tabular-nums">{(it.grade![sz] ?? 0).toLocaleString('pt-BR')}</span>
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {drafts.length > 0 && (
              <>
                <strong>{summary.orderCount}</strong> OC(s) · {summary.itemCount} item(ns) ·{' '}
                total estimado <strong>{formatCurrency(summary.total)}</strong>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {drafts.length > 0 && (
              <Button variant="outline" onClick={handlePrintPdf} disabled={generate.isPending} className="gap-2">
                <FileText className="h-4 w-4" /> Gerar PDF
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generate.isPending}>
              Cancelar
            </Button>
            <Button onClick={handleGenerate} disabled={generate.isPending || drafts.length === 0} className="gap-2">
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              Confirmar e Gerar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
