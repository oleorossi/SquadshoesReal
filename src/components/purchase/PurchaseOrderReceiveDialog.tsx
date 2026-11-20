import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { gradeReceiptIsValid } from '@/lib/purchaseReceipt';
import type { PurchaseOrderItem } from '@/hooks/usePurchaseOrders';

export interface ReceiveLineDraft {
  itemId: string;
  quantity: number;
  expectedReceived: number;
  grade: Record<string, number> | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderNumber: string;
  items: PurchaseOrderItem[];
  busy: boolean;
  onConfirm: (input: { receipts: ReceiveLineDraft[]; invoiceId: string | null }) => Promise<void>;
}

function openGrade(item: PurchaseOrderItem): Record<string, number> | null {
  const grade = item.grade as Record<string, number> | null;
  if (!grade) return null;
  const received = (item.received_grade as Record<string, number> | null) ?? {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(grade)) {
    if (key.startsWith('_')) continue;
    const left = Number(value) - Number(received[key] ?? 0);
    if (left > 0) out[key] = left;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function PurchaseOrderReceiveDialog({
  open, onOpenChange, orderNumber, items, busy, onConfirm,
}: Props) {
  const openItems = useMemo(
    () => items.filter((item) => {
      const remaining = Number(item.quantity) - Number(item.received_quantity ?? 0);
      return remaining > 0.0001 && !item.received_at;
    }),
    [items],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [grades, setGrades] = useState<Record<string, Record<string, string>>>({});
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(openItems.map((item) => item.id)));
    setQty({});
    setError(null);
  }, [open, openItems]);

  const draftQty = (item: PurchaseOrderItem) => {
    if (qty[item.id] != null) return qty[item.id];
    const remaining = Number(item.quantity) - Number(item.received_quantity ?? 0);
    return String(Number(remaining.toFixed(3)));
  };

  const confirm = async () => {
    setError(null);
    const receipts: ReceiveLineDraft[] = [];
    const chosen = openItems.filter((item) => selected.has(item.id));
    if (chosen.length === 0) {
      setError('Selecione ao menos um item.');
      return;
    }
    for (const item of chosen) {
      const remaining = Number(item.quantity) - Number(item.received_quantity ?? 0);
      const quantity = Number(String(draftQty(item)).replace(',', '.'));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(`${item.product?.name || 'Item'}: informe uma quantidade maior que zero.`);
        return;
      }
      if (quantity > remaining + 0.0001) {
        setError(`${item.product?.name || 'Item'}: o máximo agora é ${remaining} ${item.unit}.`);
        return;
      }
      const base = openGrade(item);
      let grade: Record<string, number> | null = null;
      if (base) {
        grade = {};
        for (const key of Object.keys(base)) {
          const raw = grades[item.id]?.[key];
          grade[key] = raw == null || raw === '' ? base[key] : Number(String(raw).replace(',', '.'));
        }
        const check = gradeReceiptIsValid(grade, quantity);
        if (check.ok === false) {
          setError(`${item.product?.name || 'Item'}: ${check.reason}`);
          return;
        }
      }
      receipts.push({
        itemId: item.id,
        quantity,
        expectedReceived: Number(item.received_quantity ?? 0),
        grade,
      });
    }
    if (receipts.length === 0) {
      setError('Não há quantidade em aberto nesta ordem.');
      return;
    }

    let invoiceId: string | null = null;
    const number = invoiceNumber.trim();
    if (number) {
      const { data, error: lookupError } = await supabase
        .from('invoices')
        .select('id')
        .eq('invoice_number', number)
        .order('created_at', { ascending: false })
        .limit(1);
      if (lookupError) {
        setError(lookupError.message);
        return;
      }
      invoiceId = data?.[0]?.id ?? null;
      if (!invoiceId) {
        setError('Nota não encontrada. A entrada pode seguir sem NF — deixe o número em branco.');
        return;
      }
    }

    await onConfirm({ receipts, invoiceId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Dar entrada nos selecionados</DialogTitle>
          <DialogDescription>
            OC {orderNumber}. A quantidade começa no saldo pendente e pode ser menor, para recebimento parcial. O que não for marcado continua na OC.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={openItems.length > 0 && openItems.every((item) => selected.has(item.id))}
              onCheckedChange={(value) => {
                setSelected(value === true ? new Set(openItems.map((item) => item.id)) : new Set());
              }}
            />
            Selecionar todos
          </label>
          {openItems.map((item) => {
            const grade = openGrade(item);
            return (
              <div key={item.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={selected.has(item.id)}
                      onCheckedChange={(value) => {
                        setSelected((current) => {
                          const next = new Set(current);
                          if (value === true) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        });
                      }}
                    />
                    {item.product?.name || 'Item'}
                  </label>
                  <Input
                    className="h-8 w-28 text-right"
                    value={draftQty(item)}
                    onChange={(event) => setQty((current) => ({ ...current, [item.id]: event.target.value }))}
                    inputMode="decimal"
                  />
                </div>
                {grade && (
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(grade).map(([size, value]) => (
                      <label key={size} className="space-y-1 text-[10px] text-muted-foreground">
                        {size}
                        <Input
                          className="h-8"
                          defaultValue={String(value)}
                          onChange={(event) => setGrades((current) => ({
                            ...current,
                            [item.id]: { ...current[item.id], [size]: event.target.value },
                          }))}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="space-y-1">
            <Label htmlFor="receive-invoice">Nota fiscal (opcional)</Label>
            <Input
              id="receive-invoice"
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
              placeholder="Número da NF já lançada"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Dando entrada…' : 'Dar entrada nos selecionados'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
