import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar, CheckCircle2, Pencil } from 'lucide-react';
import { formatBR } from '@/lib/minBillingDate';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Data mínima calculada (ISO yyyy-mm-dd). */
  minDateISO: string;
  /** Semana ISO correspondente (ex: 2026-W18). */
  minWeekISO: string;
  /** Quando o usuário aceita a data mínima. */
  onConfirmMin: () => void;
  /** Quando o usuário escolhe uma data diferente — a validação de override é feita pelo caller. */
  onPickManual: (newISO: string) => void;
}

/**
 * Mostrado ao salvar um pedido para confirmar a semana mínima de faturamento
 * calculada (capacidade + lead time + fila atual).
 */
export function MinBillingDateSuggestionDialog({
  open,
  onOpenChange,
  minDateISO,
  minWeekISO,
  onConfirmMin,
  onPickManual,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [manualDate, setManualDate] = useState(minDateISO);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setEditing(false);
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Semana mínima disponível
          </DialogTitle>
          <DialogDescription>
            Com base na fila atual de pedidos e capacidade dos setores, a primeira data
            viável para faturar este pedido é:
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 my-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-bold">
            Semana mínima
          </div>
          <div className="display text-2xl tabular-nums text-primary mt-1">
            {minWeekISO ? minWeekISO.replace(/^(\d{4})-W(\d+)$/, 'Semana $2 / $1') : '—'}
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">
            a partir de <strong className="text-foreground">{formatBR(minDateISO)}</strong>
          </div>
        </div>

        {editing && (
          <div className="space-y-2">
            <Label htmlFor="manual-billing-date" className="text-xs uppercase font-bold text-muted-foreground">
              Data manual de faturamento
            </Label>
            <Input
              id="manual-billing-date"
              type="date"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Se a data escolhida for anterior à mínima, o pedido será marcado como
              <strong> override manual</strong> (destacado em âmbar no Kanban).
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {editing ? (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Voltar
              </Button>
              <Button
                onClick={() => {
                  if (!manualDate) return;
                  onPickManual(manualDate);
                }}
              >
                Usar esta data
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)} className="gap-2">
                <Pencil className="h-4 w-4" />
                Ajustar manualmente
              </Button>
              <Button onClick={onConfirmMin} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Confirmar semana mínima
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}