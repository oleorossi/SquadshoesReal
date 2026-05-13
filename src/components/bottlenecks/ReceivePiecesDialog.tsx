import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CalendarBlank as Calendar, Package as PackageOpen, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';
import { useReceiveServiceOrder, SECTOR_LABEL, SectorKey } from '@/hooks/useSectorBottlenecks';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceOrder: {
    id: string;
    order_number: string;
    target_sector: SectorKey | string | null;
    quantity: number;
    quoted_deadline: string | null;
    bottleneck_week: string | null;
    order_id: string | null;
    description?: string;
    notes?: string;
    contractors?: { name?: string } | null;
  } | null;
}

export function ReceivePiecesDialog({ open, onOpenChange, serviceOrder }: Props) {
  const receive = useReceiveServiceOrder();
  const [receivedNotes, setReceivedNotes] = useState<string>('');

  useEffect(() => {
    if (open && serviceOrder) setReceivedNotes(serviceOrder.notes || '');
  }, [open, serviceOrder]);

  if (!serviceOrder) return null;

  const sectorLabel = serviceOrder.target_sector && (serviceOrder.target_sector in SECTOR_LABEL)
    ? SECTOR_LABEL[serviceOrder.target_sector as SectorKey]
    : (serviceOrder.target_sector || 'Setor');

  const todayIso = new Date().toISOString().slice(0, 10);
  const isLate = serviceOrder.quoted_deadline && serviceOrder.quoted_deadline < todayIso;

  const handleConfirm = async () => {
    await receive.mutateAsync({
      service_order_id: serviceOrder.id,
      received_notes: receivedNotes.trim() || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5 text-primary" />
            Marcar peças como recebidas
          </DialogTitle>
          <DialogDescription>
            Confirme que a contratada entregou as peças. A OP vinculada destrava
            automaticamente e pode avançar pra Montagem.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nº OS:</span>
              <span className="font-mono">{serviceOrder.order_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Contratada:</span>
              <span>{serviceOrder.contractors?.name || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Setor coberto:</span>
              <Badge variant="outline" className="text-[10px]">{sectorLabel}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pares contratados:</span>
              <span className="tabular-nums">{serviceOrder.quantity}</span>
            </div>
            {serviceOrder.quoted_deadline && (
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Prazo prometido:
                </span>
                <span className={isLate ? 'text-red-600 font-medium' : ''}>
                  {new Date(serviceOrder.quoted_deadline + 'T00:00:00').toLocaleDateString('pt-BR')}
                  {isLate && <span className="text-[10px] ml-1">(atrasado)</span>}
                </span>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Observações da entrega (opcional)</Label>
            <Textarea
              value={receivedNotes}
              onChange={e => setReceivedNotes(e.target.value)}
              className="mt-1 text-sm"
              rows={2}
              placeholder="Ex.: refugo de 3 pares, devolvido só 997 do total..."
            />
          </div>

          <div className="rounded-md border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs space-y-1">
            <p className="font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Ao confirmar:
            </p>
            <ul className="list-disc list-inside text-emerald-800 dark:text-emerald-300 space-y-0.5">
              <li>OS muda pra <code className="text-[10px]">received</code></li>
              <li>OP vinculada <strong>destrava</strong> e pode avançar pra Montagem</li>
              <li>Lançamento financeiro (AP) já criado é mantido</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={receive.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={receive.isPending}>
            {receive.isPending ? 'Confirmando...' : 'Marcar como recebido & destravar OP'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
