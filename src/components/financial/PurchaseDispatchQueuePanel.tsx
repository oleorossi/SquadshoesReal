import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DispatchQueueItem,
  useAdvancePurchaseDispatch,
  useCancelSuggestedPurchaseOrder,
  useMarkPurchaseOrderExported,
  usePurchaseDispatchQueue,
  useSetPurchaseDispatchHold,
} from '@/hooks/usePurchaseDispatchQueue';
import { formatCurrency } from '@/lib/utils';
import { exportPurchaseOrderXmlStub } from '@/lib/purchaseOrderXmlExport';
import { printPurchaseOrderGrouped } from '@/lib/printPurchaseOrder';
import { supabase } from '@/integrations/supabase/client';
import {
  CalendarBlank,
  CircleNotch as Loader2,
  DownloadSimple,
  Pause,
  Play,
  Prohibit,
  Lightning,
} from '@phosphor-icons/react';
import { format } from 'date-fns';
import { useMemo, useState } from 'react';

type Filter = 'all' | 'due' | 'ready' | 'held';

function fmtDate(d: string | null) {
  if (!d) return '—';
  return format(new Date(d + 'T12:00:00'), 'dd/MM/yyyy');
}

function pvLabelText(row: DispatchQueueItem) {
  const labels = row.source_pv_labels || [];
  if (!labels.length) return '—';
  return labels
    .map((l) => {
      const pv = l.order_number || 'PV';
      const cli = l.client_order_number?.trim();
      return cli ? `${pv} (cli ${cli})` : pv;
    })
    .join(' · ');
}

function stateBadge(state: string) {
  if (state === 'due') return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30">Vencida</Badge>;
  if (state === 'held') return <Badge className="bg-muted text-muted-foreground">Segurada</Badge>;
  if (state === 'ready') return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Na janela</Badge>;
  return <Badge variant="outline">{state}</Badge>;
}

async function loadPoForPrint(id: string) {
  const { data: order, error: e1 } = await supabase
    .from('purchase_orders')
    .select('order_number, supplier_name, total_value, created_at, notes, status')
    .eq('id', id)
    .single();
  if (e1) throw e1;
  const { data: items, error: e2 } = await supabase
    .from('purchase_order_items')
    .select('quantity, unit_price, unit, current_stock, suggested_quantity, grade, color, product:products(name, sku, category, color)')
    .eq('purchase_order_id', id);
  if (e2) throw e2;
  return { order: order as {
    order_number: string;
    supplier_name: string;
    total_value: number;
    created_at: string;
    notes: string | null;
    status: string;
  }, items: items || [] };
}

export default function PurchaseDispatchQueuePanel() {
  const { data = [], isLoading, isError, error, refetch } = usePurchaseDispatchQueue();
  const holdMut = useSetPurchaseDispatchHold();
  const advanceMut = useAdvancePurchaseDispatch();
  const cancelMut = useCancelSuggestedPurchaseOrder();
  const exportMut = useMarkPurchaseOrderExported();
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return data.filter((r) => r.dispatch_state !== 'exported');
    return data.filter((r) => r.dispatch_state === filter);
  }, [data, filter]);

  const counts = useMemo(() => ({
    due: data.filter((r) => r.dispatch_state === 'due').length,
    ready: data.filter((r) => r.dispatch_state === 'ready').length,
    held: data.filter((r) => r.dispatch_state === 'held').length,
  }), [data]);

  const runExport = async (row: DispatchQueueItem) => {
    setBusyId(row.id);
    try {
      const { order, items } = await loadPoForPrint(row.id);
      const notesExtra = [
        order.notes || '',
        `PVs: ${pvLabelText(row)}`,
      ].filter(Boolean).join('\n');
      printPurchaseOrderGrouped(
        { ...order, notes: notesExtra },
        items as never,
      );
      let xmlPath: string | undefined;
      if (row.supplier_export_xml) {
        xmlPath = await exportPurchaseOrderXmlStub({
          orderNumber: order.order_number,
          supplierName: order.supplier_name,
          labels: row.source_pv_labels,
          items: row.items_summary,
        });
      }
      await exportMut.mutateAsync({ id: row.id, xmlPath });
    } catch (e) {
      console.error(e);
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={Prohibit}
        title="Não foi possível carregar a fila"
        description={(error as Error)?.message || 'Erro de rede'}
        action={<Button size="sm" onClick={() => refetch()}>Tentar de novo</Button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['all', `Todas (${counts.due + counts.ready + counts.held})`],
            ['due', `Vencidas (${counts.due})`],
            ['ready', `Agendadas (${counts.ready})`],
            ['held', `Seguradas (${counts.held})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={
              filter === value
                ? 'px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm bg-foreground text-background'
                : 'px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm border border-border text-muted-foreground hover:bg-muted/40'
            }
          >
            {label}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Necessidade temporal das OCs automáticas pós-aprovação do PV.
        <strong className="text-foreground"> Comprar até</strong> já desconta setup
        (ou 1 dia de fallback). Adiantar / segurar / cancelar / exportar PDF
        {counts.due > 0 ? ' — priorize as vencidas.' : '.'}
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={CalendarBlank}
          title="Nada nesta fila"
          description="Quando um PV for aprovado com falta, a OC aparece aqui com data e cor."
        />
      ) : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="px-3 py-2 font-semibold">OC / Fornecedor</th>
                <th className="px-3 py-2 font-semibold">PVs / pedido cliente</th>
                <th className="px-3 py-2 font-semibold">Materiais / cor</th>
                <th className="px-3 py-2 font-semibold">Comprar até</th>
                <th className="px-3 py-2 font-semibold text-right">Total</th>
                <th className="px-3 py-2 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const busy = busyId === row.id
                  || holdMut.isPending
                  || advanceMut.isPending
                  || cancelMut.isPending
                  || exportMut.isPending;
                return (
                  <tr key={row.id} className="border-t border-border/60 align-top hover:bg-muted/20">
                    <td className="px-3 py-2.5">{stateBadge(row.dispatch_state)}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-xs font-semibold">{row.order_number || row.id.slice(0, 8)}</div>
                      <div className="text-muted-foreground">{row.supplier_name || 'A definir'}</div>
                      {row.setup_days_applied > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          setup −{row.setup_days_applied}d · necessidade {fmtDate(row.sector_need_date)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 max-w-[14rem]">
                      <div className="text-xs leading-snug">{pvLabelText(row)}</div>
                    </td>
                    <td className="px-3 py-2.5 max-w-[16rem]">
                      <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {(row.items_summary || []).slice(0, 4).map((it, i) => (
                          <li key={`${row.id}-${i}`}>
                            <span className="text-foreground">{it.product_name || '—'}</span>
                            {it.color ? ` · ${it.color}` : ''}
                            {' · '}
                            {Number(it.quantity).toLocaleString('pt-BR')} {it.unit || ''}
                          </li>
                        ))}
                        {(row.items_summary || []).length > 4 && (
                          <li>+{(row.items_summary || []).length - 4} itens</li>
                        )}
                      </ul>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{fmtDate(row.purchase_by_date)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {formatCurrency(Number(row.total_value) || 0)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          className="h-8 gap-1"
                          disabled={busy || row.dispatch_hold}
                          onClick={() => runExport(row)}
                          title={row.supplier_export_xml ? 'PDF + XML' : 'PDF'}
                        >
                          {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadSimple className="h-3.5 w-3.5" />}
                          Exportar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1"
                          disabled={busy}
                          onClick={() => advanceMut.mutate(row.id)}
                        >
                          <Lightning className="h-3.5 w-3.5" /> Adiantar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1"
                          disabled={busy}
                          onClick={() => holdMut.mutate({ id: row.id, hold: !row.dispatch_hold })}
                        >
                          {row.dispatch_hold ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                          {row.dispatch_hold ? 'Liberar' : 'Segurar'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1 text-destructive"
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt('Motivo do cancelamento (opcional):');
                            if (reason === null) return;
                            cancelMut.mutate({ id: row.id, reason: reason || undefined });
                          }}
                        >
                          <Prohibit className="h-3.5 w-3.5" /> Cancelar
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
