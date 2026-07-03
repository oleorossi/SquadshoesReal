import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CircleNotch as Loader2, TrendUp as TrendingUp, TrendDown as TrendingDown, Minus, Warning as AlertTriangle } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { calculateOrderCost, type OrderCostResult } from '@/services/costingService';
import { cn } from '@/lib/utils';
import { ReferenceLink } from '@/components/ui/reference-link';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  saleOrderId: string | null;
  orderNumber: string;
  total: number;
};

type ItemMargin = {
  itemId: string;
  referenceId: string | null;
  refName: string;
  refCode: string;
  color: string;
  quantity: number;
  unitPrice: number;
  revenue: number;
  materialCost: number;
  laborCost: number;
  overheadCost: number;
  packagingCost: number;
  totalCost: number;
  margin: number;
  marginPct: number;
  /** breakdown.labor_status do SQL: 'ok' | 'tempo_pendente' | 'sem_tempo' | 'sem_operacoes' */
  laborStatus?: string;
  laborPendingSectors?: string[];
  error?: string;
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

function MarginBadge({ pct }: { pct: number }) {
  if (pct >= 0.30) return <Badge className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 gap-1"><TrendingUp className="h-3 w-3" />{fmtPct(pct)}</Badge>;
  if (pct >= 0.15) return <Badge className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 gap-1"><Minus className="h-3 w-3" />{fmtPct(pct)}</Badge>;
  if (pct >= 0)    return <Badge className="bg-orange-500/10 text-orange-700 hover:bg-orange-500/20 gap-1"><TrendingDown className="h-3 w-3" />{fmtPct(pct)}</Badge>;
  return <Badge className="bg-red-500/10 text-red-700 hover:bg-red-500/20 gap-1"><TrendingDown className="h-3 w-3" />{fmtPct(pct)}</Badge>;
}

export default function MarginDialog({ open, onOpenChange, saleOrderId, orderNumber, total }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemMargin[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !saleOrderId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrors([]);
      try {
        const { data: orderItems, error: itemsErr } = await supabase
          .from('sale_order_items')
          .select('id, reference_id, color, quantity, unit_price, technical_sheets(name, code)')
          .eq('sale_order_id', saleOrderId);
        if (itemsErr) throw itemsErr;
        if (cancelled) return;

        const results: ItemMargin[] = [];
        const errs: string[] = [];

        // Roda em paralelo, mas com cap de 4 simultâneos pra não saturar RPC.
        const allItems = orderItems || [];
        const concurrency = 4;
        for (let i = 0; i < allItems.length; i += concurrency) {
          const batch = allItems.slice(i, i + concurrency);
          const batchResults = await Promise.all(
            batch.map(async (it: any): Promise<ItemMargin> => {
              const refName = it.technical_sheets?.name || '—';
              const refCode = it.technical_sheets?.code || '';
              const qty = Number(it.quantity) || 0;
              const unitPrice = Number(it.unit_price) || 0;
              const revenue = qty * unitPrice;
              try {
                // p_persist=false: cálculo só pra exibir, não polui order_costs.
                const cost: OrderCostResult = await calculateOrderCost(saleOrderId, it.id, false);
                const totalCost = Number(cost.total_cost) || 0;
                const margin = revenue - totalCost;
                const marginPct = revenue > 0 ? margin / revenue : 0;
                // D10: surface warnings vindos do SQL (B3 conversion_warning + B8 no_active_cost_policy)
                const sqlWarnings: string[] = Array.isArray((cost as any).warnings) ? (cost as any).warnings : [];
                const conversionIssues = (cost.breakdown?.materials ?? [])
                  .filter((m: any) => m.conversion_warning)
                  .map((m: any) => `${m.product_name} (${m.consumption_unit} → ${m.product_unit})`);
                if (sqlWarnings.length > 0 || conversionIssues.length > 0) {
                  const tag = `${refName} (${it.color || '—'})`;
                  if (sqlWarnings.includes('no_active_cost_policy')) {
                    errs.push(`${tag}: sem cost_policies ativa — overhead/embalagem zerados`);
                  }
                  // A3: tira com cor não cadastrada no grupo → custo da tira não somado.
                  const strapColors = sqlWarnings
                    .filter((w) => w.startsWith('strap_color_not_registered:'))
                    .map((w) => w.slice('strap_color_not_registered:'.length));
                  if (strapColors.length > 0) {
                    errs.push(`${tag}: tira sem produto cadastrado na cor ${strapColors.join(', ')} — custo da tira não somado`);
                  }
                  if (conversionIssues.length > 0) {
                    errs.push(`${tag}: unidade incompatível em ${conversionIssues.join(', ')}`);
                  }
                }
                // P0.1: status explícito da MO vindo do breakdown persistível.
                const laborStatus = (cost.breakdown as any)?.labor_status as string | undefined;
                const laborPendingSectors = (((cost.breakdown as any)?.labor_pending_sectors ?? []) as string[]);
                if (laborStatus === 'sem_tempo' || laborStatus === 'sem_operacoes') {
                  const tag = `${refName} (${it.color || '—'})`;
                  errs.push(`${tag}: mão de obra R$0 — ${laborStatus === 'sem_operacoes'
                    ? 'ficha sem operações de MO'
                    : `sem tempo/taxa em ${laborPendingSectors.join(', ') || 'todos os setores'}`}`);
                }
                return {
                  itemId: it.id, referenceId: it.reference_id ?? null, refName, refCode, color: it.color || '—',
                  quantity: qty, unitPrice, revenue,
                  materialCost: Number(cost.material_cost) || 0,
                  laborCost: Number(cost.labor_cost) || 0,
                  overheadCost: Number(cost.overhead_cost) || 0,
                  packagingCost: Number(cost.packaging_cost) || 0,
                  totalCost, margin, marginPct,
                  laborStatus, laborPendingSectors,
                };
              } catch (err: any) {
                errs.push(`${refName} (${it.color || '—'}): ${err.message || 'erro no cálculo'}`);
                // B4: receita também zerada em itens com erro pra não inflar margem agregada.
                // A coluna "Margem" da linha mostra "—" (erro) e o tfoot soma só itens válidos.
                return {
                  itemId: it.id, referenceId: it.reference_id ?? null, refName, refCode, color: it.color || '—',
                  quantity: qty, unitPrice, revenue: 0,
                  materialCost: 0, laborCost: 0, overheadCost: 0, packagingCost: 0,
                  totalCost: 0, margin: 0, marginPct: 0,
                  error: err.message,
                };
              }
            }),
          );
          if (cancelled) return;
          results.push(...batchResults);
        }

        if (cancelled) return;
        setItems(results);
        setErrors(errs);
      } catch (err: any) {
        if (!cancelled) {
          console.error(err);
          setErrors([err.message || 'Erro ao carregar itens']);
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, saleOrderId]);

  // Itens com error não somam (custos zerados), mas a receita conta.
  // Exibimos um aviso pra que o operador saiba que o cálculo está parcial.
  const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);
  const totalMaterial = items.reduce((s, i) => s + i.materialCost, 0);
  const totalLabor = items.reduce((s, i) => s + i.laborCost, 0);
  const totalOverhead = items.reduce((s, i) => s + i.overheadCost, 0);
  const totalPackaging = items.reduce((s, i) => s + i.packagingCost, 0);
  const totalCost = items.reduce((s, i) => s + i.totalCost, 0);
  const totalMargin = totalRevenue - totalCost;
  const totalMarginPct = totalRevenue > 0 ? totalMargin / totalRevenue : 0;
  const successCount = items.filter(i => !i.error).length;
  const failCount = items.filter(i => i.error).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-7xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Margem de Lucro — {orderNumber}
          </DialogTitle>
        <DialogDescription className="sr-only">Análise de margem e custos do pedido.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            Nenhum item neste pedido pra calcular margem.
          </p>
        ) : (
          <div className="space-y-4">
            {/* KPIs principais */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Receita Total</p>
                <p className="text-lg font-bold tabular-nums mt-1">{fmt(totalRevenue)}</p>
                {Math.abs(totalRevenue - total) > 0.01 && (
                  <p className="text-xs text-amber-600 mt-1">
                    PV total cadastrado: {fmt(total)} — divergência {fmt(Math.abs(totalRevenue - total))}
                  </p>
                )}
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Custo Total</p>
                <p className="text-lg font-bold tabular-nums mt-1">{fmt(totalCost)}</p>
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  <div>Mat: {fmt(totalMaterial)}</div>
                  <div>MOD: {fmt(totalLabor)} · GGF: {fmt(totalOverhead)}</div>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Margem Líquida</p>
                <p className={cn(
                  'text-lg font-bold tabular-nums mt-1',
                  totalMargin >= 0 ? 'text-emerald-700' : 'text-red-700'
                )}>{fmt(totalMargin)}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Margem %</p>
                <div className="mt-1.5"><MarginBadge pct={totalMarginPct} /></div>
                <p className="text-xs text-muted-foreground mt-1">{successCount} {successCount === 1 ? 'item calculado' : 'itens calculados'}</p>
              </div>
            </div>

            {/* Avisos de cálculo parcial */}
            {failCount > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs">
                  <p className="font-semibold text-amber-800">
                    {failCount} {failCount === 1 ? 'item' : 'itens'} sem custo calculado — margem total é parcial.
                  </p>
                  <ul className="mt-1 text-amber-700 list-disc pl-4 space-y-0.5">
                    {errors.slice(0, 3).map((e, idx) => <li key={idx}>{e}</li>)}
                    {errors.length > 3 && <li className="italic">+ {errors.length - 3} outros…</li>}
                  </ul>
                  <p className="mt-1.5 text-amber-700">
                    Geralmente acontece quando a ficha técnica não tem custo de materiais ou MOD configurados.
                  </p>
                </div>
              </div>
            )}

            {/* Detalhamento por item */}
            <div className="rounded-lg border overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Modelo</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Margem</TableHead>
                    <TableHead className="text-center">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(it => (
                    <TableRow key={it.itemId}>
                      <TableCell>
                        <ReferenceLink referenceId={it.referenceId} newTab className="font-medium text-sm" title="Abrir ficha técnica (nova aba)">{it.refName}</ReferenceLink>
                        {it.refCode && <div className="text-xs text-muted-foreground font-mono">{it.refCode}</div>}
                      </TableCell>
                      <TableCell>{it.color}</TableCell>
                      <TableCell className="text-right font-mono">{it.quantity}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{fmt(it.revenue)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {it.error ? <span className="text-amber-600 italic">—</span> : (
                          <div className="flex items-center justify-end gap-1.5">
                            {it.laborStatus && it.laborStatus !== 'ok' && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/40 text-amber-600 text-[10px] font-sans"
                                title={it.laborPendingSectors?.length
                                  ? `Setores sem tempo/taxa de MO: ${it.laborPendingSectors.join(', ')}`
                                  : 'Mão de obra pendente de configuração'}
                              >
                                MO pendente
                              </Badge>
                            )}
                            {fmt(it.totalCost)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className={cn(
                        'text-right font-mono tabular-nums font-semibold',
                        it.margin >= 0 ? 'text-emerald-700' : 'text-red-700'
                      )}>{it.error ? '—' : fmt(it.margin)}</TableCell>
                      <TableCell className="text-center">
                        {it.error ? <span className="text-xs text-amber-600">parcial</span> : <MarginBadge pct={it.marginPct} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground italic">
              Custo inclui matéria-prima, mão-de-obra, overhead (GGF) e embalagem — fonte: <code>calculate_order_cost</code>.
              Cálculo só pra exibição, não persiste em <code>order_costs</code>.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
