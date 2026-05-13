import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { NumberInput } from '@/components/ui/number-input';
import { Buildings, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';
import { useContractors } from '@/hooks/useContractors';
import {
  useBulkAssignServiceOrders, useActiveOSForBottleneck,
  ContributingOrder, SECTOR_LABEL, SectorKey,
} from '@/hooks/useSectorBottlenecks';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sector: SectorKey;
  weekStart: string;
  contributingOrders: ContributingOrder[];
}

export function BulkAssignServiceOrderDialog({ open, onOpenChange, sector, weekStart, contributingOrders }: Props) {
  const { data: contractors = [] } = useContractors();
  const { data: activeOS = [] } = useActiveOSForBottleneck(sector, weekStart);
  const bulkAssign = useBulkAssignServiceOrders();

  const [contractorId, setContractorId] = useState<string>('');
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [quotedDeadline, setQuotedDeadline] = useState<string>('');

  // Sugerir o terceirizado que já está cobrindo esse gargalo (se houver)
  useEffect(() => {
    if (open && activeOS.length > 0 && !contractorId) {
      // Pega o contratado mais usado entre as OSs ativas
      const counts = new Map<string, number>();
      activeOS.forEach((os: any) => counts.set(os.contractor_id, (counts.get(os.contractor_id) || 0) + 1));
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) setContractorId(top[0]);
    }
  }, [open, activeOS, contractorId]);

  // OPs que JÁ estão cobertas por alguma OS ativa nesse gargalo → desabilitadas
  const coveredOrderIds = useMemo(() => new Set(activeOS.map((o: any) => o.order_id)), [activeOS]);
  const pendingOrders = useMemo(
    () => contributingOrders.filter(o => !coveredOrderIds.has(o.order_id)),
    [contributingOrders, coveredOrderIds],
  );

  const totalPairs = pendingOrders.reduce((s, o) => s + o.quantity, 0);
  const totalValue = totalPairs * unitPrice;
  const selectedContractor = contractors.find((c: any) => c.id === contractorId);
  const paymentDays = Number((selectedContractor as any)?.payment_days ?? 30) || 30;
  const today = new Date().toISOString().slice(0, 10);

  const handleConfirm = async () => {
    if (!contractorId || !quotedDeadline || unitPrice <= 0 || pendingOrders.length === 0) return;
    await bulkAssign.mutateAsync({
      contractor_id: contractorId,
      target_sector: sector,
      bottleneck_week: weekStart,
      unit_price: unitPrice,
      quoted_deadline: quotedDeadline,
      contributing_orders: pendingOrders.map(o => ({
        order_id: o.order_id,
        sale_order_id: o.sale_order_id,
        quantity: o.quantity,
        order_number: o.order_number,
      })),
    });
    onOpenChange(false);
    setContractorId(''); setUnitPrice(0); setQuotedDeadline('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Buildings className="h-5 w-5 text-primary" />
            Encaminhar gargalo a terceirizada
          </DialogTitle>
          <DialogDescription>
            Setor <strong>{SECTOR_LABEL[sector]}</strong> · semana de{' '}
            <strong>{new Date(weekStart + 'T00:00:00').toLocaleDateString('pt-BR')}</strong>.
            Vai criar uma OS por OP, todas com mesmo terceirizado / prazo / valor.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {activeOS.length > 0 && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs space-y-1">
              <p className="font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Já há {activeOS.length} OS ativa(s) nesse gargalo
              </p>
              <p className="text-emerald-800 dark:text-emerald-300">
                Contratada já usada: <strong>{(activeOS[0]?.contractors as any)?.name || '—'}</strong>
                {' '}— sugerida abaixo. OPs já cobertas são puladas automaticamente.
              </p>
            </div>
          )}

          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">OPs a encaminhar:</span>
              <span className="tabular-nums">
                {pendingOrders.length}
                {coveredOrderIds.size > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-1">
                    ({coveredOrderIds.size} já coberta{coveredOrderIds.size > 1 ? 's' : ''})
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total de pares:</span>
              <span className="tabular-nums font-semibold">{totalPairs.toLocaleString('pt-BR')}</span>
            </div>
          </div>

          <div>
            <Label className="text-xs">Contratada / Costureira</Label>
            <Select value={contractorId} onValueChange={setContractorId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Selecionar contratada..." />
              </SelectTrigger>
              <SelectContent>
                {contractors.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Nenhuma contratada cadastrada. Cadastre em /terceirizados primeiro.
                  </div>
                )}
                {contractors.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {activeOS.some((os: any) => os.contractor_id === c.id) && (
                      <Badge variant="outline" className="h-4 text-[9px] ml-2">já usada</Badge>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Valor por par (R$)</Label>
              <NumberInput value={unitPrice} onChange={setUnitPrice} step="0.01" className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Prazo de entrega *</Label>
              <Input
                type="date" value={quotedDeadline} min={today}
                onChange={e => setQuotedDeadline(e.target.value)}
                className="mt-1 h-9 text-sm"
              />
            </div>
          </div>

          <div className="rounded-md bg-primary/5 px-3 py-2 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {totalPairs} pares × {unitPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
              <span className="font-mono font-semibold text-base">
                {totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>
            {quotedDeadline && selectedContractor && (
              <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-1 mt-1">
                <span>Pagamento ({paymentDays}d após recebimento):</span>
                <span className="font-medium text-foreground">
                  ~ {(() => {
                    const d = new Date(quotedDeadline + 'T00:00:00');
                    d.setDate(d.getDate() + paymentDays);
                    return d.toLocaleDateString('pt-BR');
                  })()}
                </span>
              </div>
            )}
          </div>

          {pendingOrders.length > 0 && (
            <div className="rounded-md border border-border max-h-32 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left p-2">OP</th>
                    <th className="text-left p-2">Modelo / Cor</th>
                    <th className="text-right p-2">Pares</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingOrders.map(o => (
                    <tr key={o.order_id} className="border-t border-border/40">
                      <td className="p-2 font-mono">{o.order_number}</td>
                      <td className="p-2">{o.sheet_name}{o.color ? ` · ${o.color}` : ''}</td>
                      <td className="p-2 text-right tabular-nums">{o.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={bulkAssign.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!contractorId || !quotedDeadline || unitPrice <= 0 || pendingOrders.length === 0 || bulkAssign.isPending}
          >
            {bulkAssign.isPending
              ? 'Criando...'
              : `Encaminhar ${pendingOrders.length} OP(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
