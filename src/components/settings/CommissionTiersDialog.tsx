/**
 * Faixas de comissão escalonada de um representante — paridade Tutor32 (módulo 2).
 *
 * Gerencia commission_tiers (faixas progressivas/marginais) por evento gatilho
 * (pedido / faturamento / liquidez). O cálculo é progressivo: a RPC
 * calculate_tiered_commission soma (LEAST(total,max)-min)*pct/100 por faixa.
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Plus, Stairs, PencilSimple as Pencil, Check, X } from '@phosphor-icons/react';
import { formatCurrency } from '@/lib/utils';
import {
  useCommissionTiers, useAddCommissionTier, useUpdateCommissionTier, useDeleteCommissionTier,
  calcTieredCommission, TRIGGER_EVENTS, type TriggerEvent, type CommissionTier,
} from '@/hooks/useCommissionTiers';

interface Props {
  representative: { id: string; name: string; commission_pct: number } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const emptyRow = { min_value: '', max_value: '', commission_pct: '' };

export function CommissionTiersDialog({ representative, open, onOpenChange }: Props) {
  const [event, setEvent] = useState<TriggerEvent>('faturamento');
  const { data: allTiers } = useCommissionTiers(representative?.id);
  const add = useAddCommissionTier();
  const update = useUpdateCommissionTier();
  const del = useDeleteCommissionTier();

  const [newRow, setNewRow] = useState(emptyRow);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState(emptyRow);
  const [previewTotal, setPreviewTotal] = useState('');

  const tiers = useMemo(
    () => (allTiers ?? []).filter((t) => t.trigger_event === event).sort((a, b) => a.min_value - b.min_value),
    [allTiers, event],
  );

  const preview = useMemo(() => {
    const total = parseFloat(previewTotal.replace(',', '.')) || 0;
    return { total, commission: calcTieredCommission(total, tiers), effPct: total > 0 ? (calcTieredCommission(total, tiers) / total) * 100 : 0 };
  }, [previewTotal, tiers]);

  if (!representative) return null;

  function submitNew() {
    const min = parseFloat(newRow.min_value.replace(',', '.')) || 0;
    const max = newRow.max_value.trim() ? parseFloat(newRow.max_value.replace(',', '.')) : null;
    const pct = parseFloat(newRow.commission_pct.replace(',', '.')) || 0;
    add.mutate(
      { representative_id: representative!.id, min_value: min, max_value: max, commission_pct: pct, trigger_event: event, active: true },
      { onSuccess: () => setNewRow(emptyRow) },
    );
  }

  function startEdit(t: CommissionTier) {
    setEditId(t.id);
    setEditRow({ min_value: String(t.min_value), max_value: t.max_value == null ? '' : String(t.max_value), commission_pct: String(t.commission_pct) });
  }

  function submitEdit() {
    if (!editId) return;
    const min = parseFloat(editRow.min_value.replace(',', '.')) || 0;
    const max = editRow.max_value.trim() ? parseFloat(editRow.max_value.replace(',', '.')) : null;
    const pct = parseFloat(editRow.commission_pct.replace(',', '.')) || 0;
    update.mutate({ id: editId, data: { min_value: min, max_value: max, commission_pct: pct, trigger_event: event } }, { onSuccess: () => setEditId(null) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Stairs className="size-5" /> Faixas de comissão — {representative.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label>Evento gatilho</Label>
              <Select value={event} onValueChange={(v) => { setEvent(v as TriggerEvent); setEditId(null); }}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_EVENTS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground self-end pb-2 max-w-[300px]">
              {TRIGGER_EVENTS.find((t) => t.value === event)?.hint}. Faixas progressivas: cada R$ é comissionado pela alíquota da sua faixa. Base padrão do rep: {representative.commission_pct}%.
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Faixa (R$)</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
                <TableHead className="text-right w-[120px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.length === 0 && (
                <TableRow><TableCell colSpan={3} className="p-0">
                  <EmptyState icon={Stairs} title="Sem faixas para este evento" description="Adicione faixas abaixo (ex.: 0 → 50.000 a 4%, 50.000 → sem teto a 6%)." />
                </TableCell></TableRow>
              )}
              {tiers.map((t) => (
                <TableRow key={t.id}>
                  {editId === t.id ? (
                    <>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">R$</span>
                          <Input value={editRow.min_value} onChange={(e) => setEditRow((r) => ({ ...r, min_value: e.target.value }))} className="h-8 w-24" inputMode="decimal" />
                          <span className="text-muted-foreground">→</span>
                          <Input value={editRow.max_value} onChange={(e) => setEditRow((r) => ({ ...r, max_value: e.target.value }))} placeholder="sem teto" className="h-8 w-24" inputMode="decimal" />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Input value={editRow.commission_pct} onChange={(e) => setEditRow((r) => ({ ...r, commission_pct: e.target.value }))} className="h-8 w-16 text-right" inputMode="decimal" />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={submitEdit}><Check className="size-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditId(null)}><X className="size-4" /></Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="tabular-nums">
                        {formatCurrency(t.min_value)} <span className="text-muted-foreground">→</span> {t.max_value == null ? <Badge variant="outline" className="text-[10px]">sem teto</Badge> : formatCurrency(t.max_value)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{t.commission_pct}%</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(t)}><Pencil className="size-3.5" /></Button>
                          <DeleteConfirmButton onConfirm={() => del.mutate(t.id)} />
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {/* Linha de adição */}
              <TableRow className="bg-muted/30">
                <TableCell>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">R$</span>
                    <Input value={newRow.min_value} onChange={(e) => setNewRow((r) => ({ ...r, min_value: e.target.value }))} placeholder="início" className="h-8 w-24" inputMode="decimal" />
                    <span className="text-muted-foreground">→</span>
                    <Input value={newRow.max_value} onChange={(e) => setNewRow((r) => ({ ...r, max_value: e.target.value }))} placeholder="sem teto" className="h-8 w-24" inputMode="decimal" />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Input value={newRow.commission_pct} onChange={(e) => setNewRow((r) => ({ ...r, commission_pct: e.target.value }))} placeholder="%" className="h-8 w-16 text-right" inputMode="decimal" />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" className="h-7 gap-1" onClick={submitNew} disabled={add.isPending}><Plus className="size-3.5" /> Add</Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          {/* Simulador progressivo */}
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
            <Label className="text-xs">Simular comissão para um total no período</Label>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">R$</span>
                <Input value={previewTotal} onChange={(e) => setPreviewTotal(e.target.value)} placeholder="100.000" className="h-8 w-32" inputMode="decimal" />
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Comissão: </span>
                <span className="font-bold tabular-nums">{formatCurrency(preview.commission)}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Alíquota efetiva: </span>
                <span className="font-semibold tabular-nums">{preview.effPct.toFixed(2)}%</span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
