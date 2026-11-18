/**
 * Envio dividido: cada linha é um prestador ou a fábrica, com a grade
 * e o R$/par que fica travado na OS.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Factory, Plus, Truck } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccessControl } from '@/hooks/useAccessControl';
import { atelierKeys, sendAtelierSplit, useAtelierOpenRates, type AtelierLotJob, type AtelierLotRow } from '@/hooks/useAtelier';
import { supabase } from '@/integrations/supabase/client';
import { atelierOpenRatePrice, atelierRateLabel, atelierRateSector, atelierTodayISO } from '@/lib/atelierAdmin';
import { atelierReturnDate, atelierSectorOffsetDays } from '@/lib/atelierBoard';
import { addBusinessDays } from '@/lib/sectorCapacity';
import { formatDateBR } from '@/lib/dateOnly';
import {
  gradeSizeKeys,
  gradeTotal,
  parseWholeGrade,
  priceWasEdited,
  resolveAtelierPairPrice,
  splitBalanceError,
  splitGrade,
  suggestPairsByCapacity,
  type SizeGrade,
} from '@/lib/atelierSplit';
import { printAtelierShipment } from '@/lib/printAtelierShipment';
import { cn, formatCurrency } from '@/lib/utils';

interface Row {
  key: string;
  mode: 'internal' | 'contractor';
  contractorId: string;
  pairs: string;
  sizes: Record<string, string>;
  manual: boolean;
  price: string;
  priceTouched: boolean;
  saveRate: boolean;
}

interface Props {
  job: AtelierLotJob | null;
  lot: AtelierLotRow | null;
  contractors: { id: string; name: string }[];
  onClose: () => void;
}

function blankRow(contractorId = ''): Row {
  return {
    key: `${Date.now()}-${Math.random()}`,
    mode: 'contractor',
    contractorId,
    pairs: '',
    sizes: {},
    manual: false,
    price: '',
    priceTouched: false,
    saveRate: false,
  };
}

function sizesFromGrade(grade: SizeGrade): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of gradeSizeKeys(grade)) out[key] = String(grade[key]);
  return out;
}

function returnLabel(pairs: number, capacity: number | null, cutAnchor: string | null, offset: number): string {
  if (pairs <= 0) return '';
  if (capacity && capacity > 0) {
    const days = Math.ceil(pairs / capacity);
    const end = addBusinessDays(new Date(), days);
    const iso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    return `volta ${formatDateBR(iso)} · ${capacity}/dia`;
  }
  const iso = atelierReturnDate(cutAnchor, offset);
  return iso ? `volta ${formatDateBR(iso)}` : '';
}

export function AtelierSplitDialog({ job, lot, contractors, onClose }: Props) {
  const open = !!job && !!lot;
  const qc = useQueryClient();
  const { roles } = useAccessControl();
  const canEditPrice = roles.includes('admin') || roles.includes('gerente');
  const rates = useAtelierOpenRates();
  const today = atelierTodayISO();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const remainingQuery = useQuery({
    queryKey: ['atelier-remaining-grade', job?.id ?? ''],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('atelier_job_remaining_grade' as never, { p_job_id: job!.id } as never);
      if (error) throw error;
      return (data ?? {}) as SizeGrade;
    },
  });
  const remaining = remainingQuery.data ?? {};
  const sizes = gradeSizeKeys(remaining);

  const capacityQuery = useQuery({
    queryKey: ['atelier-model-capacity', lot?.reference_id, job?.sector],
    enabled: open && !!lot?.reference_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contractor_model_capacities' as never)
        .select('contractor_id, capacity_pairs_per_day')
        .eq('technical_sheet_id', lot!.reference_id)
        .eq('sector', job!.sector);
      if (error) throw error;
      return (data ?? []) as { contractor_id: string; capacity_pairs_per_day: number }[];
    },
  });
  const referenceQuery = useQuery({
    queryKey: ['contractor-reference-rates', lot?.reference_id, job?.sector],
    enabled: open && !!lot?.reference_id,
    queryFn: async () => {
      const sector = atelierRateSector(job!.sector);
      if (!sector) return [];
      const { data, error } = await supabase
        .from('contractor_reference_rates' as never)
        .select('contractor_id, price_per_pair, valid_from, valid_to')
        .eq('technical_sheet_id', lot!.reference_id)
        .eq('sector', sector)
        .is('valid_to', null);
      if (error) throw error;
      return (data ?? []) as { contractor_id: string; price_per_pair: number; valid_from: string }[];
    },
  });

  useEffect(() => {
    if (!open || !remainingQuery.data) return;
    const grade = remainingQuery.data;
    setRows([
      {
        ...blankRow(job?.contractor_id ?? ''),
        pairs: String(gradeTotal(grade) || ''),
        sizes: sizesFromGrade(grade),
      },
    ]);
  }, [open, job?.id, job?.contractor_id, remainingQuery.data]);

  const capacityOf = (contractorId: string) => {
    const hit = (capacityQuery.data ?? []).find((row) => row.contractor_id === contractorId);
    return hit ? Number(hit.capacity_pairs_per_day) : null;
  };
  const suggestion = (contractorId: string) => resolveAtelierPairPrice({
    referencePrice: (referenceQuery.data ?? []).find((row) => row.contractor_id === contractorId)?.price_per_pair,
    sectorPrice: atelierOpenRatePrice(rates.data ?? [], contractorId, job?.sector ?? '', today),
  });

  const parsed = rows.map((row) => parseWholeGrade(row.sizes));
  const error = parsed.some((grade) => grade == null)
    ? 'A grade só aceita pares inteiros, sem fração e sem negativo'
    : splitBalanceError(remaining, rows.map((row, index) => ({
      mode: row.mode,
      grade: parsed[index] ?? {},
    })));
  const used = parsed.reduce((sum, grade) => sum + gradeTotal(grade ?? {}), 0);
  const saldo = gradeTotal(remaining) - used;

  const applyTargets = (targets: number[]) => {
    const total = targets.reduce((sum, qty) => sum + qty, 0);
    if (total <= 0 || total > gradeTotal(remaining)) return;
    const pool = gradeTotal(remaining);
    const weights = sizes.map((size) => remaining[size] || 0);
    const exact = weights.map((weight) => (pool === 0 ? 0 : (total * weight) / pool));
    const floors = exact.map((value) => Math.floor(value));
    let left = total - floors.reduce((sum, value) => sum + value, 0);
    const order = exact.map((value, index) => ({ index, frac: value - Math.floor(value) }))
      .sort((a, b) => b.frac - a.frac || a.index - b.index);
    for (let step = 0; step < left; step += 1) floors[order[step].index] += 1;
    const reduced: SizeGrade = {};
    sizes.forEach((size, index) => {
      if (floors[index] > 0) reduced[size] = floors[index];
    });
    const shares = splitGrade(reduced, targets);
    setRows((current) => current.map((row, index) => ({
      ...row,
      pairs: String(targets[index] || ''),
      sizes: sizesFromGrade(shares[index] || {}),
      manual: false,
    })));
  };

  const distribute = () => {
    const caps = rows.map((row) => (row.mode === 'internal' ? null : capacityOf(row.contractorId)));
    applyTargets(suggestPairsByCapacity(gradeTotal(remaining), caps));
  };

  const send = async () => {
    if (!job || error || parsed.some((grade) => grade == null)) {
      toast.error(error || 'Confira a grade');
      return;
    }
    const parts = rows.map((row, index) => {
      const grade = parsed[index] ?? {};
      const suggested = row.mode === 'contractor' ? suggestion(row.contractorId) : { price: null, source: null };
      const typed = row.price.trim() === '' ? suggested.price : Number(row.price.replace(',', '.'));
      return {
        mode: row.mode,
        contractor_id: row.mode === 'contractor' ? row.contractorId : null,
        grade,
        unit_price: row.mode === 'contractor' ? typed : null,
        save_reference_rate: row.mode === 'contractor' && row.saveRate,
      };
    }).filter((part) => gradeTotal(part.grade) > 0);
    if (parts.some((part) => part.mode === 'contractor' && (!part.contractor_id || !(Number(part.unit_price) > 0)))) {
      toast.error('Cada prestador precisa de nome e R$/par maior que zero');
      return;
    }
    if (parts.some((part) => part.mode === 'contractor' && !canEditPrice && priceWasEdited(
      Number(part.unit_price),
      suggestion(part.contractor_id || '').price,
    ))) {
      toast.error('Só admin ou gerência altera o R$/par');
      return;
    }
    setBusy(true);
    try {
      const data = await sendAtelierSplit({ jobId: job.id, parts });
      await qc.invalidateQueries({ queryKey: atelierKeys.all });
      const ids = data?.service_order_ids ?? [];
      toast.success(ids.length ? `Remessa enviada · ${ids.length} OS` : 'Parte interna lançada');
      if (ids[0]) void printAtelierShipment(ids[0]).catch(() => toast.error('A OS foi criada, mas a impressão não abriu'));
      onClose();
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message) : 'Falha ao enviar';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const offset = atelierSectorOffsetDays(job?.sector ?? 'costura_cabedal', null);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Enviar {lot?.reference_code || 'cabedal'}</DialogTitle>
          <DialogDescription>
            Uma OS por prestador. O saldo fica no job para o próximo envio.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-foreground">
          {gradeTotal(remaining)} pares no saldo
          {saldo >= 0 ? ` · faltam ${saldo}` : ''}
        </p>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {rows.map((row, index) => {
            const suggested = row.mode === 'contractor' ? suggestion(row.contractorId) : { price: null as number | null, source: null };
            const shown = row.priceTouched ? row.price : (suggested.price != null ? String(suggested.price).replace('.', ',') : '');
            const edited = row.mode === 'contractor' && priceWasEdited(
              shown.trim() === '' ? null : Number(shown.replace(',', '.')),
              suggested.price,
            );
            const pairs = gradeTotal(parseWholeGrade(row.sizes) ?? {});
            return (
              <div key={row.key} className="space-y-2 rounded-md border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-md border border-border p-0.5">
                    {(['contractor', 'internal'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={cn('rounded px-2 py-0.5 text-[11px]', row.mode === mode ? 'bg-foreground text-background' : 'text-muted-foreground')}
                        onClick={() => setRows((current) => current.map((item, i) => i === index ? { ...item, mode } : item))}
                      >
                        {mode === 'internal' ? 'Interno' : 'Prestador'}
                      </button>
                    ))}
                  </div>
                  {row.mode === 'contractor' ? (
                    <Select
                      value={row.contractorId || undefined}
                      onValueChange={(value) => setRows((current) => current.map((item, i) => (
                        i === index ? { ...item, contractorId: value, priceTouched: false, price: '' } : item
                      )))}
                    >
                      <SelectTrigger className="h-8 w-[220px] text-xs" aria-label="Prestador">
                        <SelectValue placeholder="Prestador" />
                      </SelectTrigger>
                      <SelectContent>
                        {contractors.map((contractor) => (
                          <SelectItem key={contractor.id} value={contractor.id}>{contractor.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Factory className="h-3 w-3" /> Não gera OS</span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {returnLabel(pairs, row.mode === 'internal' ? null : capacityOf(row.contractorId), job?.target_end ?? null, offset)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {sizes.map((size) => (
                    <label key={size} className="block w-14 text-[10px]">
                      <span className="text-muted-foreground">{size === 'pares' ? 'Pares' : size}</span>
                      <Input
                        inputMode="numeric"
                        className="h-8 px-1 text-center font-mono text-xs"
                        aria-label={`Tamanho ${size}`}
                        value={row.sizes[size] ?? ''}
                        onChange={(event) => setRows((current) => current.map((item, i) => (
                          i === index ? { ...item, manual: true, sizes: { ...item.sizes, [size]: event.target.value } } : item
                        )))}
                      />
                    </label>
                  ))}
                </div>
                {row.mode === 'contractor' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-[11px]">
                      R$/par
                      <Input
                        inputMode="decimal"
                        className={cn('h-8 w-24 font-mono text-xs', edited && 'border-amber-500')}
                        aria-label="R$/par"
                        readOnly={!canEditPrice}
                        value={shown}
                        onChange={(event) => setRows((current) => current.map((item, i) => (
                          i === index ? { ...item, priceTouched: true, price: event.target.value } : item
                        )))}
                      />
                    </label>
                    <span className="text-[11px] text-muted-foreground">
                      {suggested.source === 'referencia' ? 'Tarifa desta referência' : suggested.source === 'setor' ? `Tarifa de ${atelierRateLabel(job?.sector ?? '')}` : 'Sem tarifa cadastrada'}
                      {edited ? ' · editado' : ''}
                      {pairs > 0 && shown.trim() !== '' && Number(shown.replace(',', '.')) > 0
                        ? ` · total ${formatCurrency(pairs * Number(shown.replace(',', '.')))}`
                        : ''}
                    </span>
                    {canEditPrice && (
                      <label className="flex items-center gap-1 text-[11px]">
                        <Checkbox
                          checked={row.saveRate}
                          onCheckedChange={(checked) => setRows((current) => current.map((item, i) => (
                            i === index ? { ...item, saveRate: checked === true } : item
                          )))}
                        />
                        Salvar como tarifa deste prestador para esta referência
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {error && <p className="text-xs text-amber-700 dark:text-amber-400">{error}</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setRows((current) => [...current, blankRow()])}>
              <Plus className="h-3.5 w-3.5" /> prestador
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={distribute}>
              Distribuir pelo menor prazo
            </Button>
          </div>
          <Button type="button" size="sm" className="h-9" disabled={busy || !!error} onClick={() => void send()}>
            <Truck className="h-3.5 w-3.5" /> Enviar tudo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
