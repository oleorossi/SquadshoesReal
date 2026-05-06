import { useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRegisterDefect } from "@/hooks/useStageQuality";

export function DefectDialog({
  open,
  onOpenChange,
  waveStageId,
  productRef,
  color,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  waveStageId: string;
  productRef?: string;
  color?: string;
}) {
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const reg = useRegisterDefect();

  const handleSubmit = async () => {
    if (qty <= 0 || !reason.trim()) return;
    if (reason.trim().length > 500) return;
    await reg.mutateAsync({
      waveStageId,
      defectQty: qty,
      reason: reason.trim().slice(0, 500),
      productRef,
      color,
    });
    onOpenChange(false);
    setQty(1);
    setReason("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar defeito</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Quantidade defeituosa</Label>
            <Input
              type="number"
              min={1}
              max={100000}
              value={qty}
              onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div>
            <Label>Motivo</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              placeholder="Descreva o tipo de defeito..."
            />
            <div className="text-xs text-muted-foreground mt-1 text-right">
              {reason.length}/500
            </div>
          </div>
          <div className="rounded-md bg-muted border border-border p-3 text-sm text-foreground">
            Ao confirmar, a produção da etapa será reduzida em <b>{qty}</b> e uma
            OP de retrabalho será aberta automaticamente.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={reg.isPending || qty <= 0 || !reason.trim()}
          >
            Registrar defeito
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
