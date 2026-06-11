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
import { CircleNotch as Loader2 } from '@phosphor-icons/react';

/**
 * Registrar Retorno de OS terceirizada (Fase 1 facção).
 *
 * Modelo do setor: a banca devolve em UM OU MAIS retornos, separando pares
 * BONS / DEFEITUOSOS / PERDA. O banco (service_order_returns + triggers):
 *   - valida Σ retornos ≤ enviado;
 *   - fecha a OS ('Concluído' + delivered_at) quando o saldo zera;
 *   - marca 'Em Andamento' em retorno parcial;
 *   - gera a conta a pagar NA ENTREGA com valor = pares BONS × unit_price.
 * Aqui NÃO se mexe em status nem em accounts_payable — só insere o retorno.
 */

// service_order_returns / v_service_order_balance ainda não estão no types.ts
// (regenerar depois) — tipos locais + (supabase as any).
interface ReturnRow {
  id: string;
  returned_at: string;
  qty_good: number;
  qty_defect: number;
  qty_loss: number;
  defect_notes: string | null;
}

interface BalanceRow {
  qty_sent: number;
  qty_returned_good: number;
  qty_returned_defect: number;
  qty_loss: number;
  qty_in_field: number;
}

export interface ReturnDialogServiceOrder {
  id: string;
  order_number?: string | null;
  quantity?: number | null;
  description?: string | null;
  contractorName?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceOrder: ReturnDialogServiceOrder | null;
  /** Chamado após salvar; completed=true quando o retorno zerou o saldo
   *  (OS fechada pelo banco) — o caller decide efeitos extras (ex.: saída
   *  artesanal). */
  onSaved?: (info: { completed: boolean }) => void;
}

export default function ServiceOrderReturnDialog({ open, onOpenChange, serviceOrder, onSaved }: Props) {
  const qc = useQueryClient();
  const soId = serviceOrder?.id ?? null;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['so_return_dialog', soId],
    enabled: open && !!soId,
    queryFn: async () => {
      const [{ data: bal, error: balErr }, { data: rets, error: retErr }] = await Promise.all([
        (supabase as any).from('v_service_order_balance').select('*').eq('service_order_id', soId).maybeSingle(),
        (supabase as any)
          .from('service_order_returns')
          .select('id, returned_at, qty_good, qty_defect, qty_loss, defect_notes')
          .eq('service_order_id', soId)
          .order('returned_at', { ascending: false }),
      ]);
      if (balErr) throw balErr;
      if (retErr) throw retErr;
      return { balance: (bal ?? null) as BalanceRow | null, returns: (rets ?? []) as ReturnRow[] };
    },
  });

  const balance = data?.balance ?? null;
  const inField = Math.max(0, Number(balance?.qty_in_field ?? serviceOrder?.quantity ?? 0));

  const [qtyGood, setQtyGood] = useState(0);
  const [qtyDefect, setQtyDefect] = useState(0);
  const [qtyLoss, setQtyLoss] = useState(0);
  const [defectNotes, setDefectNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Caso comum (retorno total): pré-preenche BONS com o saldo → 2 cliques.
  useEffect(() => {
    if (open) {
      setQtyGood(inField);
      setQtyDefect(0);
      setQtyLoss(0);
      setDefectNotes('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inField]);

  const totalReturn = qtyGood + qtyDefect + qtyLoss;
  const exceeds = totalReturn > inField;
  const remaining = inField - totalReturn;

  const fmtDate = useMemo(() => (s: string) => new Date(s).toLocaleDateString('pt-BR'), []);

  const handleSave = async () => {
    if (!soId || saving) return;
    if (totalReturn <= 0) { toast.error('Informe ao menos 1 par devolvido.'); return; }
    if (exceeds) { toast.error(`Retorno excede o saldo na rua (${inField} pares).`); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('service_order_returns').insert({
        service_order_id: soId,
        qty_good: qtyGood,
        qty_defect: qtyDefect,
        qty_loss: qtyLoss,
        defect_notes: defectNotes.trim() || null,
      });
      if (error) throw error;

      const completed = remaining <= 0;
      toast.success(
        completed
          ? `OS ${serviceOrder?.order_number ?? ''} entregue por completo — conta a pagar gerada pelos pares bons.`
          : `Retorno registrado — restam ${remaining} pares na rua.`,
      );
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_history_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      qc.invalidateQueries({ queryKey: ['so_return_dialog', soId] });
      onSaved?.({ completed });
      if (completed) onOpenChange(false);
      else refetch();
    } catch (e: any) {
      toast.error(`Falha ao registrar retorno: ${e?.message || 'erro desconhecido'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Registrar Retorno — OS {serviceOrder?.order_number ?? ''}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {serviceOrder?.contractorName && (
                <Badge variant="outline">{serviceOrder.contractorName}</Badge>
              )}
              <span className="text-muted-foreground">
                Enviado <strong className="text-foreground">{balance?.qty_sent ?? serviceOrder?.quantity ?? 0}</strong>
                {' · '}Devolvido <strong className="text-foreground">{(balance?.qty_returned_good ?? 0) + (balance?.qty_returned_defect ?? 0) + (balance?.qty_loss ?? 0)}</strong>
                {' · '}Na rua <strong className="text-foreground">{inField}</strong>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Pares BONS</Label>
                <NumberInput value={qtyGood} onChange={v => setQtyGood(Math.max(0, Math.trunc(v ?? 0)))} min={0} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Defeituosos</Label>
                <NumberInput value={qtyDefect} onChange={v => setQtyDefect(Math.max(0, Math.trunc(v ?? 0)))} min={0} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Perda</Label>
                <NumberInput value={qtyLoss} onChange={v => setQtyLoss(Math.max(0, Math.trunc(v ?? 0)))} min={0} className="h-9" />
              </div>
            </div>

            {(qtyDefect > 0 || qtyLoss > 0) && (
              <div>
                <Label className="text-xs">Observação (defeito/perda)</Label>
                <Textarea value={defectNotes} onChange={e => setDefectNotes(e.target.value)} rows={2} placeholder="Ex.: costura torta em 4 pares" />
              </div>
            )}

            <div className="text-xs">
              {exceeds ? (
                <span className="text-red-600">Retorno ({totalReturn}) excede o saldo na rua ({inField}).</span>
              ) : remaining > 0 ? (
                <span className="text-amber-600">Retorno parcial — ficarão {remaining} pares na rua.</span>
              ) : totalReturn > 0 ? (
                <span className="text-green-600">Retorno total — a OS será fechada e a conta a pagar gerada (pares bons × preço).</span>
              ) : null}
            </div>

            {(data?.returns?.length ?? 0) > 0 && (
              <div className="border border-border rounded-md p-2 max-h-32 overflow-auto">
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Retornos anteriores</p>
                {data!.returns.map(r => (
                  <div key={r.id} className="text-xs flex items-center justify-between py-0.5">
                    <span>{fmtDate(r.returned_at)}</span>
                    <span className="font-mono">
                      {r.qty_good} bons{r.qty_defect > 0 ? ` · ${r.qty_defect} def.` : ''}{r.qty_loss > 0 ? ` · ${r.qty_loss} perda` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="h-9" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="h-9" onClick={handleSave} disabled={saving || isLoading || totalReturn <= 0 || exceeds}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Registrar retorno'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
