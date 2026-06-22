import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, Truck, Package, Check } from '@phosphor-icons/react';

/**
 * Enviar OS terceirizada PRA RUA em PARCELAS (tranches). Complementa o retorno
 * (ServiceOrderReturnDialog): aqui você manda parte do pedido pra rua e o resto
 * fica na fábrica — manda de novo quando quiser. O banco (service_order_dispatches
 * + triggers) valida Σ parcelas ≤ pedido e marca a OS 'Em Andamento' no 1º envio.
 * "Na rua" = enviado − recebido. Não mexe em status de fechamento nem em
 * accounts_payable (isso é no recebimento, quando volta tudo).
 *
 * Mostra o CHECKLIST completo de movimentos (envios + recebimentos) pra acompanhar.
 */
interface BalanceRow {
  qty_sent: number;            // pedido total
  qty_dispatched: number;      // já enviado (Σ parcelas)
  qty_to_dispatch: number;     // a enviar (pedido − enviado)
  qty_returned_good: number;
  qty_returned_defect: number;
  qty_loss: number;
  qty_in_field: number;        // na rua = enviado − recebido
}
interface DispatchRow { id: string; dispatched_at: string; qty_dispatched: number; notes: string | null; }
interface ReturnRow { id: string; returned_at: string; qty_good: number; qty_defect: number; qty_loss: number; }

export interface DispatchDialogServiceOrder {
  id: string;
  order_number?: string | null;
  quantity?: number | null;
  description?: string | null;
  contractorName?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceOrder: DispatchDialogServiceOrder | null;
  /** Pedido pra abrir o recebimento (o caller controla o ServiceOrderReturnDialog). */
  onReceive?: () => void;
}

export default function ServiceOrderDispatchDialog({ open, onOpenChange, serviceOrder, onReceive }: Props) {
  const qc = useQueryClient();
  const soId = serviceOrder?.id ?? null;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['so_dispatch_dialog', soId],
    enabled: open && !!soId,
    queryFn: async () => {
      const [{ data: bal, error: balErr }, { data: disp, error: dispErr }, { data: rets, error: retErr }] = await Promise.all([
        (supabase as any).from('v_service_order_balance').select('*').eq('service_order_id', soId).maybeSingle(),
        (supabase as any).from('service_order_dispatches').select('id, dispatched_at, qty_dispatched, notes').eq('service_order_id', soId).order('dispatched_at', { ascending: false }),
        (supabase as any).from('service_order_returns').select('id, returned_at, qty_good, qty_defect, qty_loss').eq('service_order_id', soId).order('returned_at', { ascending: false }),
      ]);
      if (balErr) throw balErr;
      if (dispErr) throw dispErr;
      if (retErr) throw retErr;
      return { balance: (bal ?? null) as BalanceRow | null, dispatches: (disp ?? []) as DispatchRow[], returns: (rets ?? []) as ReturnRow[] };
    },
  });

  const balance = data?.balance ?? null;
  const ordered = Number(balance?.qty_sent ?? serviceOrder?.quantity ?? 0);
  const dispatched = Number(balance?.qty_dispatched ?? 0);
  const toDispatch = Math.max(0, Number(balance?.qty_to_dispatch ?? Math.max(0, ordered - dispatched)));
  const inField = Math.max(0, Number(balance?.qty_in_field ?? 0));
  const received = (balance?.qty_returned_good ?? 0) + (balance?.qty_returned_defect ?? 0) + (balance?.qty_loss ?? 0);

  const [qty, setQty] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Default: manda o que falta (1 clique pra mandar tudo de uma vez).
  useEffect(() => {
    if (open) { setQty(toDispatch); setNotes(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, toDispatch]);

  const exceeds = qty > toDispatch;
  const fmtDate = useMemo(() => (s: string) => new Date(s).toLocaleDateString('pt-BR'), []);

  // Linha do tempo unificada (envios + recebimentos), mais recente primeiro.
  const timeline = useMemo(() => {
    const a = (data?.dispatches ?? []).map(d => ({ kind: 'dispatch' as const, at: d.dispatched_at, qty: d.qty_dispatched, notes: d.notes }));
    const b = (data?.returns ?? []).map(r => ({ kind: 'return' as const, at: r.returned_at, good: r.qty_good, defect: r.qty_defect, loss: r.qty_loss }));
    return [...a, ...b].sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
  }, [data]);

  const handleSave = async () => {
    if (!soId || saving) return;
    if (qty <= 0) { toast.error('Informe ao menos 1 par pra enviar.'); return; }
    if (exceeds) { toast.error(`Envio excede o que falta (${toDispatch} pares a enviar).`); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('service_order_dispatches').insert({
        service_order_id: soId, qty_dispatched: qty, notes: notes.trim() || null,
      });
      if (error) throw error;
      const left = toDispatch - qty;
      toast.success(left > 0 ? `${qty} pares enviados — faltam ${left} pra enviar.` : `${qty} pares enviados — pedido todo na rua.`);
      ['service_orders', 'v_outsourced_in_field', 'v_contractor_metrics', 'service_order_overview', 'so_dispatch_dialog', 'so_return_dialog']
        .forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      refetch();
    } catch (e: any) {
      toast.error(`Falha ao registrar envio: ${e?.message || 'erro desconhecido'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar pra rua — OS {serviceOrder?.order_number ?? ''}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            {serviceOrder?.contractorName && <Badge variant="outline">{serviceOrder.contractorName}</Badge>}

            {/* 4 números + barra recebido/na-rua/a-enviar */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Pedido', value: ordered, cls: '' },
                { label: 'Enviado', value: dispatched, cls: '' },
                { label: 'Na rua', value: inField, cls: 'text-amber-600' },
                { label: 'Recebido', value: received, cls: 'text-green-600' },
              ].map(s => (
                <div key={s.label} className="rounded-md bg-muted/40 p-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{s.label}</p>
                  <p className={`text-lg font-bold tabular-nums ${s.cls}`}>{s.value}</p>
                </div>
              ))}
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="bg-green-500" style={{ width: `${ordered > 0 ? (received / ordered) * 100 : 0}%` }} />
              <div className="bg-amber-500" style={{ width: `${ordered > 0 ? (inField / ordered) * 100 : 0}%` }} />
            </div>

            {/* Input de envio */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">Enviar agora (de {toDispatch} a enviar)</Label>
                <NumberInput value={qty} onChange={v => setQty(Math.max(0, Math.min(toDispatch, Math.trunc(v ?? 0))))} min={0} className="h-9" />
              </div>
              <div className="flex-[2]">
                <Label className="text-xs">Observação (opcional)</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={1} placeholder="Ex.: 1ª remessa" className="min-h-9" />
              </div>
            </div>
            {exceeds && <p className="text-xs text-red-600">Envio ({qty}) maior que o que falta enviar ({toDispatch}).</p>}
            {toDispatch === 0 && <p className="text-xs text-muted-foreground">Pedido todo enviado. Use <strong>Receber</strong> conforme a banca devolve.</p>}

            {/* Checklist de movimentos */}
            {timeline.length > 0 && (
              <div className="border border-border rounded-md p-2 max-h-40 overflow-auto space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">Movimentos</p>
                {timeline.map((ev, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {ev.kind === 'dispatch'
                      ? <Truck className="h-4 w-4 text-amber-600 shrink-0" />
                      : <Check className="h-4 w-4 text-green-600 shrink-0" />}
                    <span className="flex-1">
                      {ev.kind === 'dispatch'
                        ? <>Enviado <strong>{ev.qty}</strong> pares{ev.notes ? ` · ${ev.notes}` : ''}</>
                        : <>Recebido <strong>{ev.good + ev.defect + ev.loss}</strong> · {ev.good} bom{ev.defect > 0 ? `, ${ev.defect} def.` : ''}{ev.loss > 0 ? `, ${ev.loss} perda` : ''}</>}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">{fmtDate(ev.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {onReceive && (
            <Button variant="outline" className="h-9 gap-1.5 mr-auto" onClick={() => { onOpenChange(false); onReceive(); }} disabled={inField <= 0}>
              <Package className="h-4 w-4" /> Receber
            </Button>
          )}
          <Button variant="outline" className="h-9" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button className="h-9 gap-1.5" onClick={handleSave} disabled={saving || isLoading || qty <= 0 || exceeds}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />} Enviar pra rua
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
