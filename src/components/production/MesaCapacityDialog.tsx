import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CalendarBlank as CalendarDays, TrendUp as TrendingUp } from '@phosphor-icons/react';
import { useUpdateMesaCapacity } from '@/hooks/useProductionWaves';
import { format, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function calcDays(totalPairs: number, capacityPerDay: number): number {
  if (capacityPerDay <= 0) return 0;
  return Math.ceil(totalPairs / capacityPerDay);
}

function availableDate(startedAt: string | null, daysNeeded: number): Date {
  const base = startedAt ? new Date(startedAt) : new Date();
  return addDays(base, daysNeeded);
}

export function MesaCapacityDialog({
  open,
  onOpenChange,
  waveId,
  waveCode,
  totalPairs,
  currentCapacity,
  startedAt,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  waveId: string;
  waveCode: string;
  totalPairs: number;
  currentCapacity: number;
  startedAt: string | null;
}) {
  const [newCapacity, setNewCapacity] = useState(currentCapacity > 0 ? currentCapacity : 1);
  const update = useUpdateMesaCapacity();

  const currentDays = calcDays(totalPairs, currentCapacity);
  const newDays = calcDays(totalPairs, newCapacity);
  const currentAvail = availableDate(startedAt, currentDays);
  const newAvail = availableDate(startedAt, newDays);
  const saving = newDays < currentDays ? currentDays - newDays : 0;

  function handleConfirm() {
    update.mutate(
      { waveId, capacityPerDay: newCapacity },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-500" />
            Capacidade do Aviamento — {waveCode}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Current situation */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Situação atual</p>
            <div className="flex items-center justify-between text-sm">
              <span>Capacidade</span>
              <Badge variant="outline">{currentCapacity > 0 ? `${currentCapacity} pares/dia` : '— não definida'}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Total da onda</span>
              <Badge variant="outline">{totalPairs} pares</Badge>
            </div>
            {currentCapacity > 0 && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span>Dias necessários</span>
                  <Badge variant="outline">{currentDays} dias</Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5" /> Disponível em
                  </span>
                  <Badge variant="outline">
                    {format(currentAvail, "dd/MM", { locale: ptBR })}
                  </Badge>
                </div>
              </>
            )}
          </div>

          {/* New capacity input */}
          <div className="space-y-1.5">
            <Label htmlFor="new-cap" className="text-sm font-medium">
              Nova capacidade (pares/dia)
            </Label>
            <p className="text-xs text-muted-foreground">
              Remanejando pessoas você pode aumentar o ritmo. Informe a nova capacidade diária.
            </p>
            <Input
              id="new-cap"
              type="number"
              min={1}
              value={newCapacity}
              onChange={e => setNewCapacity(Math.max(1, Number(e.target.value) || 1))}
              className="font-mono"
            />
          </div>

          {/* Preview */}
          {newCapacity !== currentCapacity && (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-purple-600 uppercase">Novo cálculo</p>
              <div className="flex items-center justify-between text-sm">
                <span>Dias necessários</span>
                <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20">
                  {newDays} dias
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" /> Disponível em
                </span>
                <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20">
                  {format(newAvail, "dd/MM", { locale: ptBR })}
                </Badge>
              </div>
              {saving > 0 && (
                <p className="text-xs text-green-600 font-medium pt-0.5">
                  ✓ Economiza {saving} dia{saving > 1 ? 's' : ''} em relação ao ritmo atual
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleConfirm}
            disabled={update.isPending || newCapacity === currentCapacity}
            className="bg-purple-500 hover:bg-purple-600 text-white"
          >
            {update.isPending ? 'Salvando...' : 'Confirmar nova capacidade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
