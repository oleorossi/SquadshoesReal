import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { gradeSizeKeys, gradeTotal } from '@/lib/atelierSplit';
import { formatGrade, planRedistribution, type OsMove } from '@/lib/osRedistribuicao';
import { useRedistributeServiceOrder, type OsAtivaRow } from '@/hooks/useOsAtivas';

const INTERNAL = '__internal__';

interface DestinationDraft {
  key: string;
  contractorId: string;
  grades: Record<string, string>;
}

interface Props {
  row: OsAtivaRow | null;
  contractors: { id: string; name: string }[];
  onClose: () => void;
}

function blankGrades(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = '';
  return out;
}

function parseGrade(raw: Record<string, string>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const text = value.trim();
    if (text === '') continue;
    if (!/^\d+$/.test(text)) return null;
    const qty = Number(text);
    if (qty > 0) out[key] = qty;
  }
  return out;
}

export function OsRedistribuirDialog({ row, contractors, onClose }: Props) {
  const open = !!row;
  const keys = gradeSizeKeys(row?.movableGrade);
  const [take, setTake] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [destinations, setDestinations] = useState<DestinationDraft[]>([]);
  const redistribute = useRedistributeServiceOrder();

  useEffect(() => {
    if (!row) return;
    const next: Record<string, string> = {};
    for (const key of gradeSizeKeys(row.movableGrade)) next[key] = String(row.movableGrade[key]);
    setTake(next);
    setReason('');
    setDestinations([{ key: '1', contractorId: '', grades: blankGrades(gradeSizeKeys(row.movableGrade)) }]);
  }, [row]);

  const parsedTake = parseGrade(take);
  const parsedMoves = useMemo(() => {
    const moves: OsMove[] = [];
    for (const dest of destinations) {
      const grade = parseGrade(dest.grades);
      if (!grade) return null;
      moves.push({
        contractorId: dest.contractorId === INTERNAL ? null : dest.contractorId || null,
        internal: dest.contractorId === INTERNAL,
        grade,
      });
    }
    return moves;
  }, [destinations]);

  const plan = row && parsedTake && parsedMoves
    ? planRedistribution({
      movable: row.movableGrade,
      unsentPairs: row.unsent,
      streetPairs: row.street,
      take: parsedTake,
      moves: parsedMoves.filter((move) => gradeTotal(move.grade) > 0 || destinations.length === 1),
    })
    : null;

  const shownMoves = parsedMoves?.filter((move) => gradeTotal(move.grade) > 0) ?? [];
  const livePlan = row && parsedTake && shownMoves.length > 0
    ? planRedistribution({
      movable: row.movableGrade,
      unsentPairs: row.unsent,
      streetPairs: row.street,
      take: parsedTake,
      moves: shownMoves,
    })
    : plan;

  async function submit() {
    if (!row || !parsedTake || !livePlan?.ok) {
      toast.error(livePlan?.error || 'A grade não fecha.');
      return;
    }
    if (reason.trim().length < 3) {
      toast.error('Diga o motivo da redistribuição.');
      return;
    }
    try {
      await redistribute.mutateAsync({
        sourceId: row.serviceOrderId,
        reason: reason.trim(),
        take: livePlan.take,
        moves: shownMoves.map((move) => ({
          contractor_id: move.contractorId,
          internal: move.internal,
          grade: move.grade,
        })),
      });
      onClose();
    } catch {
      // o toast de erro sai da mutation
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Redistribuir {row?.osNumber}</DialogTitle>
          <DialogDescription>
            {row?.reference} · {row?.color}. A soma dos destinos tem que fechar o total que sai.
            Par ainda não enviado muda de OS na hora. Par que já está com o prestador só muda
            depois da devolução sem produção: o kit volta para a fábrica e não gera conta a pagar.
          </DialogDescription>
        </DialogHeader>
        {row && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Na origem: {formatGrade(row.movableGrade)}. A enviar {row.toSend}. Na rua {row.street}.
              Recebido como produção {row.received}, e esse não sai.
            </p>
            <div>
              <Label>Quanto sai desta OS</Label>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {keys.map((key) => (
                  <label key={key} className="space-y-1 text-xs text-muted-foreground">
                    <span>{key === 'pares' ? 'Pares' : key}</span>
                    <Input
                      inputMode="numeric"
                      value={take[key] ?? ''}
                      onChange={(event) => setTake((prev) => ({ ...prev, [key]: event.target.value }))}
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {destinations.map((dest, index) => (
                <div key={dest.key} className="rounded-lg border border-border p-3 space-y-2">
                  <Label>Destino {index + 1}</Label>
                  <Select
                    value={dest.contractorId || undefined}
                    onValueChange={(value) => setDestinations((prev) => prev.map((item) => (
                      item.key === dest.key ? { ...item, contractorId: value } : item
                    )))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Prestador" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={INTERNAL}>Produção interna</SelectItem>
                      {contractors
                        .filter((person) => person.id !== row.contractorId)
                        .map((person) => (
                          <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {keys.map((key) => (
                      <label key={key} className="space-y-1 text-xs text-muted-foreground">
                        <span>{key === 'pares' ? 'Pares' : key}</span>
                        <Input
                          inputMode="numeric"
                          value={dest.grades[key] ?? ''}
                          onChange={(event) => setDestinations((prev) => prev.map((item) => (
                            item.key === dest.key
                              ? { ...item, grades: { ...item.grades, [key]: event.target.value } }
                              : item
                          )))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDestinations((prev) => [
                  ...prev,
                  { key: String(Date.now()), contractorId: '', grades: blankGrades(keys) },
                ])}
              >
                Outro prestador
              </Button>
            </div>
            <div>
              <Label htmlFor="motivo-redistribuicao">Motivo</Label>
              <Textarea
                id="motivo-redistribuicao"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="O prestador não vai conseguir entregar"
              />
            </div>
            {livePlan?.requiresUnproducedReturn && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600">
                {livePlan.streetPairs} pares já foram enviados. A tela grava a devolução sem produção
                antes de mandar para o outro. Isso não gera conta a pagar. Conta pendente que ainda
                cobria esses pares é cancelada ou reduzida.
              </p>
            )}
            {parsedTake == null || parsedMoves == null ? (
              <p className="text-sm text-red-600">A grade só aceita pares inteiros.</p>
            ) : livePlan && !livePlan.ok ? (
              <p className="text-sm text-red-600">{livePlan.error}</p>
            ) : livePlan?.ok ? (
              <p className="text-sm text-muted-foreground">
                Saem {gradeTotal(livePlan.take)} pares.
                {livePlan.unsentPairs > 0 ? ` ${livePlan.unsentPairs} ainda não enviados.` : ''}
                {livePlan.streetPairs > 0 ? ` ${livePlan.streetPairs} voltam sem produção.` : ''}
              </p>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={!livePlan?.ok || redistribute.isPending} onClick={submit}>
            {redistribute.isPending ? 'Redistribuindo…' : 'Redistribuir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
