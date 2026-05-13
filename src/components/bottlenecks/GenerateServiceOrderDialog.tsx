import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { NumberInput } from '@/components/ui/number-input';
import { useContractors } from '@/hooks/useContractors';
import {
  useCreateServiceOrderForBottleneck,
  useActiveOSForBottleneck,
  ContributingOrder,
  SectorKey,
  SECTOR_LABEL,
} from '@/hooks/useSectorBottlenecks';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contributingOrder: ContributingOrder | null;
  sector: SectorKey;
  weekStart: string;
}

export function GenerateServiceOrderDialog({ open, onOpenChange, contributingOrder, sector, weekStart }: Props) {
  const { data: contractors = [] } = useContractors();
  const { data: activeOS = [] } = useActiveOSForBottleneck(sector, weekStart);
  const create = useCreateServiceOrderForBottleneck();

  const [contractorId, setContractorId] = useState<string>('');
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [quantity, setQuantity] = useState<number>(contributingOrder?.quantity || 0);
  const [quotedDeadline, setQuotedDeadline] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const selectedContractor = contractors.find((c: any) => c.id === contractorId);
  const paymentDays = Number((selectedContractor as any)?.payment_days ?? 30) || 30;
  // Data prevista da ordem de pagamento (AP): prazo de entrega + payment_days
  const previewPaymentDate = quotedDeadline
    ? (() => {
        const base = new Date(quotedDeadline + 'T00:00:00');
        base.setDate(base.getDate() + paymentDays);
        return base.toLocaleDateString('pt-BR');
      })()
    : null;

  // Reset state quando abre com outro pedido
  if (open && contributingOrder && quantity === 0) {
    setQuantity(contributingOrder.quantity);
  }
  if (!open && quantity > 0 && !contributingOrder) {
    setQuantity(0);
  }
  // Sugerir contratado que já está cobrindo o gargalo (se houver)
  if (open && activeOS.length > 0 && !contractorId) {
    const counts = new Map<string, number>();
    activeOS.forEach((os: any) => counts.set(os.contractor_id, (counts.get(os.contractor_id) || 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) setContractorId(top[0]);
  }

  if (!contributingOrder) return null;

  const total = (quantity || 0) * (unitPrice || 0);
  // Só costureiras que aceitem o setor — sem coluna explícita, filtramos pela
  // categoria livre. Fica responsabilidade do usuário escolher contratado certo.
  const eligibleContractors = contractors;

  const handleConfirm = async () => {
    if (!contractorId || !quotedDeadline) return;
    await create.mutateAsync({
      contractor_id: contractorId,
      order_id: contributingOrder.order_id,
      sale_order_id: contributingOrder.sale_order_id,
      target_sector: sector,
      bottleneck_week: weekStart,
      quantity,
      unit_price: unitPrice,
      quoted_deadline: quotedDeadline,
      notes: notes.trim() || undefined,
    });
    onOpenChange(false);
    // Reset
    setContractorId('');
    setUnitPrice(0);
    setQuantity(0);
    setQuotedDeadline('');
    setNotes('');
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar OS Terceirizada</DialogTitle>
          <DialogDescription>
            Cobrir o gargalo de <strong>{SECTOR_LABEL[sector]}</strong> na semana de{' '}
            <strong>{new Date(weekStart + 'T00:00:00').toLocaleDateString('pt-BR')}</strong> transferindo a OP{' '}
            <strong>{contributingOrder.order_number}</strong> para uma contratada externa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">OP:</span>
              <span className="font-mono">{contributingOrder.order_number}</span>
            </div>
            {contributingOrder.sheet_name && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Modelo:</span>
                <span>{contributingOrder.sheet_name}</span>
              </div>
            )}
            {contributingOrder.color && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cor:</span>
                <span>{contributingOrder.color}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pares originais:</span>
              <span className="tabular-nums">{contributingOrder.quantity}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Entrega prevista:</span>
              <span>{new Date(contributingOrder.planned_delivery + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
            </div>
          </div>

          <div>
            <Label className="text-xs">Contratada / Costureira</Label>
            <Select value={contractorId} onValueChange={setContractorId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder="Selecionar contratada..." />
              </SelectTrigger>
              <SelectContent>
                {eligibleContractors.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Nenhuma contratada cadastrada. Cadastre em /terceirizados primeiro.
                  </div>
                )}
                {eligibleContractors.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Pares a terceirizar</Label>
              <NumberInput value={quantity} onChange={setQuantity} step="1" className="mt-1 h-9" />
            </div>
            <div>
              <Label className="text-xs">Valor por par (R$)</Label>
              <NumberInput value={unitPrice} onChange={setUnitPrice} step="0.01" className="mt-1 h-9" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Prazo de entrega prometido *</Label>
            <Input
              type="date"
              value={quotedDeadline}
              min={today}
              onChange={e => setQuotedDeadline(e.target.value)}
              className="mt-1 h-9 text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Data que a contratada se compromete a devolver as peças prontas.
              A OP fica bloqueada de avançar pra Montagem até você marcar as peças como recebidas.
            </p>
          </div>

          <div className="rounded-md bg-primary/5 px-3 py-2 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Cálculo: {quantity} pares × {unitPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
              <span className="font-mono font-semibold text-base">
                {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>
            {previewPaymentDate && (
              <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-1 mt-1">
                <span>
                  Pagamento previsto ({paymentDays}d {selectedContractor ? `· ${(selectedContractor as any).name}` : ''}):
                </span>
                <span className="font-medium text-foreground">{previewPaymentDate}</span>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Observações (opcional)</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="mt-1 text-sm"
              rows={2}
              placeholder="Especificações do trabalho, retirada do material, etc."
            />
          </div>

          <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-1">
            <p className="font-medium text-amber-700 dark:text-amber-400">⚠ Fluxo após criar a OS:</p>
            <ol className="list-decimal list-inside text-amber-800 dark:text-amber-300 space-y-0.5">
              <li>OS fica em status <Badge variant="outline" className="text-[10px]">quoted</Badge> com prazo já registrado</li>
              <li>Ordem de pagamento (AP) gerada automaticamente baseada nos dias da contratada</li>
              <li>A OP fica <strong>bloqueada</strong> de avançar pra Montagem</li>
              <li>Quando as peças voltarem, vá em /terceirizados e marque "Peças recebidas"</li>
              <li>OP destrava e segue pra Montagem</li>
            </ol>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!contractorId || quantity <= 0 || unitPrice <= 0 || !quotedDeadline || create.isPending}
          >
            {create.isPending ? 'Criando...' : 'Criar OS Terceirizada'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
