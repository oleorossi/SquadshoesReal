import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Calendar, Truck, Warning as AlertTriangle, ShoppingCart, CircleNotch as Loader2, Package, FileText, Shield } from '@phosphor-icons/react';
import { SoleAvailabilityResult, SoleShortage, InsoleShortage } from '@/lib/soleAvailability';
import { useCreatePurchaseOrder } from '@/hooks/usePurchaseOrders';
import { toast } from 'sonner';
import { SubmitFlowStepper } from './SubmitFlowStepper';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: SoleAvailabilityResult | null;
  onConfirm: (generatedPO: boolean) => void;
}

/** Strip color suffixes from sole name. */
function getSoleType(name: string): string {
  return (name || '')
    .replace(/\s*[-–]\s*(preto|caramelo|nude|marrom|branco|bege|cinza|tan|whisky|chocolate)\b.*$/i, '')
    .trim() || name;
}

function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const na = Number(a); const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

function SizeGradeTable({ breakdown }: { breakdown: Record<string, number> }) {
  const sizes = sortSizes(Object.keys(breakdown));
  if (sizes.length === 0) return null;
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border rounded-md">
        <thead>
          <tr className="bg-muted/40">
            <th className="text-left px-2 py-1.5 font-semibold uppercase text-xs tracking-wide text-muted-foreground">Numeração</th>
            {sizes.map(sz => <th key={sz} className="px-2 py-1.5 font-bold text-center">{sz}</th>)}
            <th className="px-2 py-1.5 text-right font-bold uppercase text-xs text-muted-foreground">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-2 py-1.5 text-muted-foreground">Pares</td>
            {sizes.map(sz => <td key={sz} className="px-2 py-1.5 text-center font-mono font-semibold">{breakdown[sz]}</td>)}
            <td className="px-2 py-1.5 text-right font-mono font-bold">{total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StockSummary({ required, available, shortage, suggested }: { required: number; available: number; shortage: number; suggested: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
      <div className="rounded bg-muted/30 px-2 py-1.5">
        <div className="text-xs uppercase text-muted-foreground">Necessário</div>
        <div className="font-mono font-semibold">{required}</div>
      </div>
      <div className="rounded bg-muted/30 px-2 py-1.5">
        <div className="text-xs uppercase text-muted-foreground">Estoque</div>
        <div className="font-mono">{available}</div>
      </div>
      <div className="rounded bg-destructive/10 px-2 py-1.5">
        <div className="text-xs uppercase text-destructive">Faltam</div>
        <div className="font-mono font-bold text-destructive">{shortage}</div>
      </div>
      <div className="rounded bg-primary/10 px-2 py-1.5">
        <div className="text-xs uppercase text-primary">Comprar</div>
        <div className="font-mono font-bold">{suggested}</div>
      </div>
    </div>
  );
}

export function SolePurchaseConfirmDialog({ open, onOpenChange, result, onConfirm }: Props) {
  const createPO = useCreatePurchaseOrder();
  const [generating, setGenerating] = useState(false);

  const grouped = useMemo(() => {
    if (!result) return [] as Array<{ type: string; colors: SoleShortage[] }>;
    const map = new Map<string, SoleShortage[]>();
    for (const s of result.shortages) {
      const type = getSoleType(s.sole_name);
      const arr = map.get(type) || [];
      arr.push(s);
      map.set(type, arr);
    }
    return [...map.entries()].map(([type, colors]) => ({ type, colors }));
  }, [result]);

  if (!result) return null;
  const { shortages, insoleShortages, minBillingDateISO, totalLeadTimeDays, postSoleProductionDays } = result;

  const formattedDate = minBillingDateISO
    ? new Date(minBillingDateISO + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';

  const bySupplierSole = shortages.reduce<Record<string, SoleShortage[]>>((acc, s) => {
    const key = s.supplier_id || 'unknown';
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});

  const bySupplierInsole = (insoleShortages || []).reduce<Record<string, InsoleShortage[]>>((acc, s) => {
    const key = s.supplier_id || 'unknown';
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});

  const handleGeneratePOs = async () => {
    setGenerating(true);
    try {
      let count = 0;

      // Sole POs
      for (const [, group] of Object.entries(bySupplierSole)) {
        const supplier = group[0];
        if (!supplier.supplier_id) {
          toast.warning(`Solado "${supplier.sole_name}" sem fornecedor padrão — defina antes de gerar a OC.`);
          continue;
        }
        const noteLines = group.map((g) => {
          const sizeStr = sortSizes(Object.keys(g.size_breakdown)).map(sz => `${sz}=${g.size_breakdown[sz]}`).join(' | ');
          return `• ${g.sole_name}${g.sole_color ? ` (${g.sole_color})` : ''}\n   Numeração: ${sizeStr || '—'}\n   Pedidos: ${g.order_numbers.join(', ') || '—'}`;
        });
        const notes = [`OC gerada automaticamente. Lead time: ${supplier.lead_time_days} dias.`, '', 'Detalhamento por solado:', ...noteLines].join('\n');
        await createPO.mutateAsync({
          supplier_id: supplier.supplier_id,
          supplier_name: supplier.supplier_name,
          notes,
          items: group.map((g) => ({
            product_id: g.sole_product_id,
            quantity: g.suggested_purchase_qty,
            unit_price: g.unit_price,
            unit: 'par',
            current_stock: g.available,
            min_stock: 0, max_stock: 0,
            grade: Object.keys(g.size_breakdown).length > 0 ? g.size_breakdown : null,
            color: g.sole_color ?? null,
          })),
        });
        count++;
      }

      // Insole POs
      for (const [, group] of Object.entries(bySupplierInsole)) {
        const supplier = group[0];
        if (!supplier.supplier_id) {
          toast.warning(`Palmilha "${supplier.insole_name}" sem fornecedor padrão — defina antes de gerar a OC.`);
          continue;
        }
        const noteLines = group.map((g) => {
          const sizeStr = sortSizes(Object.keys(g.size_breakdown)).map(sz => `${sz}=${g.size_breakdown[sz]}`).join(' | ');
          const cabStr = g.cabedal_colors.length > 0 ? `Cabedal: ${g.cabedal_colors.join(', ')}` : '';
          return `• ${g.insole_name}${g.insole_color ? ` (${g.insole_color})` : ''}\n   Numeração: ${sizeStr || '—'}\n   ${cabStr}\n   Pedidos: ${g.order_numbers.join(', ') || '—'}`;
        });
        const notes = [`OC Palmilha — gerada automaticamente. Lead time: ${supplier.lead_time_days} dias.`, '', 'Detalhamento por palmilha:', ...noteLines].join('\n');
        await createPO.mutateAsync({
          supplier_id: supplier.supplier_id,
          supplier_name: supplier.supplier_name,
          notes,
          items: group.map((g) => ({
            product_id: g.insole_product_id,
            quantity: g.suggested_purchase_qty,
            unit_price: g.unit_price,
            unit: 'par',
            current_stock: g.available,
            min_stock: 0, max_stock: 0,
            grade: Object.keys(g.size_breakdown).length > 0 ? g.size_breakdown : null,
            color: g.insole_color ?? null,
          })),
        });
        count++;
      }

      if (count > 0) toast.success(`${count} ordem(ns) de compra gerada(s) com sucesso!`);
      onConfirm(count > 0);
    } catch (err: any) {
      toast.error(`Erro ao gerar OCs: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const hasInsoleShortages = (insoleShortages || []).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <SubmitFlowStepper current="sole" />
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            {hasInsoleShortages ? 'Solado/Palmilha insuficiente — gerar Ordens de Compra?' : 'Solado insuficiente — gerar Ordem de Compra?'}
          </DialogTitle>
          <DialogDescription>
            Faltam materiais para atender este pedido. As OCs serão organizadas por tipo → cor → numeração, com referência ao pedido de origem.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-primary/40 bg-primary/5">
          <Calendar className="h-4 w-4" />
          <AlertTitle className="text-base font-semibold">Data mínima de faturamento: {formattedDate}</AlertTitle>
          <AlertDescription className="text-xs mt-1">
            Cálculo: <strong>{totalLeadTimeDays} dias</strong> = lead time do solado + {postSoleProductionDays} dias de montagem/acabamento/buffer.
          </AlertDescription>
        </Alert>

        {/* ── Sole section ── */}
        {grouped.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold">Solados</h3>
              <Badge variant="outline" className="text-xs">{shortages.length} item(ns)</Badge>
            </div>
            {grouped.map((group) => (
              <div key={group.type} className="rounded-lg border bg-card overflow-hidden">
                <div className="flex items-center gap-2 bg-muted/60 px-4 py-2.5 border-b">
                  <Package className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold uppercase tracking-wide">{group.type}</h3>
                  <Badge variant="outline" className="ml-auto text-xs">{group.colors.length} cor(es)</Badge>
                </div>
                <div className="divide-y">
                  {group.colors.map((s) => (
                    <div key={s.sole_product_id} className="p-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="font-semibold">{s.sole_color || 'Cor padrão'}</Badge>
                        {s.sole_sku && <Badge variant="outline" className="font-mono text-xs">{s.sole_sku}</Badge>}
                        <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                          <Truck className="h-3 w-3" />{s.supplier_name} · {s.lead_time_days}d
                          {s.moq > 0 && <span className="ml-1">· MOQ {s.moq}</span>}
                        </span>
                      </div>
                      <SizeGradeTable breakdown={s.size_breakdown} />
                      {Object.keys(s.size_breakdown).length === 0 && (
                        <p className="text-xs text-muted-foreground italic">Sem grade detalhada — total: <strong>{s.required}</strong> pares.</p>
                      )}
                      <StockSummary required={s.required} available={s.available} shortage={s.shortage} suggested={s.suggested_purchase_qty} />
                      {s.order_numbers.length > 0 && (
                        <div className="flex items-start gap-1.5 flex-wrap pt-1 border-t">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                          <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mt-0.5">Pedidos:</span>
                          {s.order_numbers.map(on => <Badge key={on} variant="outline" className="font-mono text-xs">{on}</Badge>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Insole section ── */}
        {hasInsoleShortages && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-bold text-blue-700 dark:text-blue-400">Palmilhas</h3>
              <Badge variant="outline" className="text-xs">{insoleShortages.length} item(ns)</Badge>
            </div>
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 overflow-hidden">
              <div className="divide-y divide-blue-100 dark:divide-blue-900">
                {insoleShortages.map((s) => (
                  <div key={s.insole_product_id} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-semibold">{s.insole_color || 'Cor padrão'}</Badge>
                      {s.insole_sku && <Badge variant="outline" className="font-mono text-xs">{s.insole_sku}</Badge>}
                      <span className="text-xs text-muted-foreground italic text-xs">{s.insole_name}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                        <Truck className="h-3 w-3" />{s.supplier_name} · {s.lead_time_days}d
                      </span>
                    </div>
                    {s.cabedal_colors.length > 0 && (
                      <p className="text-xs text-blue-700 dark:text-blue-400">
                        Cabedal que origina esta palmilha: {s.cabedal_colors.join(', ')}
                      </p>
                    )}
                    <SizeGradeTable breakdown={s.size_breakdown} />
                    {Object.keys(s.size_breakdown).length === 0 && (
                      <p className="text-xs text-muted-foreground italic">Total: <strong>{s.required}</strong> pares.</p>
                    )}
                    <StockSummary required={s.required} available={s.available} shortage={s.shortage} suggested={s.suggested_purchase_qty} />
                    {s.order_numbers.length > 0 && (
                      <div className="flex items-start gap-1.5 flex-wrap pt-1 border-t">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                        <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mt-0.5">Pedidos:</span>
                        {s.order_numbers.map(on => <Badge key={on} variant="outline" className="font-mono text-xs">{on}</Badge>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {shortages.some(s => s.suggested_purchase_qty > s.shortage) && '⚠ Quantidades arredondadas para atender o MOQ do fornecedor.'}
        </p>

        <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={generating}>Cancelar pedido</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onConfirm(false)} disabled={generating}>Salvar pedido sem OC</Button>
            <Button onClick={handleGeneratePOs} disabled={generating} className="gap-2">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              {generating ? 'Gerando...' : 'Gerar OCs e salvar pedido'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
