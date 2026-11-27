/**
 * Gestão do envio parcial de um lote: saldo, prestador e grade.
 * A OS aberta daquele prestador, lote e etapa recebe a remessa nova.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Truck } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import {
  atelierKeys,
  closeAtelierShipments,
  confirmAtelierOpenKitSend,
  sendAtelierRemessa,
  useAtelierOpenRates,
  type AtelierLotRow,
} from '@/hooks/useAtelier';
import { kitShortageBlockMessage } from '@/lib/atelierKitShortage';
import { atelierIdentityLabel, atelierLotIdentityLines } from '@/lib/atelierIdentity';
import { atelierOpenRatePrice, atelierRateLabel, atelierTodayISO } from '@/lib/atelierAdmin';
import { printAtelierShipment } from '@/lib/printAtelierShipment';
import {
  gradeSizeKeys,
  gradeTotal,
  type SizeGrade,
} from '@/lib/atelierSplit';
import { remessaGradeError, suggestRemessaGrade, sumGrades } from '@/lib/atelierRemessa';
import { ATELIER_SECTOR_LABEL, type AtelierSector } from '@/lib/atelier';
import { cn, formatCurrency } from '@/lib/utils';

const INTERNAL = '__internal__';

interface PartRow {
  id: string;
  job_id: string;
  execution_mode: string | null;
  contractor_id: string | null;
  pairs: number;
  grade: SizeGrade | null;
  service_order_id: string | null;
  unit_price: number | null;
}

interface ReceiptRow {
  part_id: string | null;
  job_id: string;
  pairs: number;
  qty_defect: number | null;
  qty_loss: number | null;
  reversed_at: string | null;
  rework_resolution_id: string | null;
}

interface OsRow {
  id: string;
  order_number: string | null;
  status: string | null;
  unit_price: number | null;
  quantity: number | null;
  accepting_shipments: boolean | null;
  contractor_id: string | null;
}

interface Props {
  lot: AtelierLotRow | null;
  contractors: { id: string; name: string }[];
  onClose: () => void;
}

function sizesFromGrade(grade: SizeGrade): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of gradeSizeKeys(grade)) out[key] = String(grade[key]);
  return out;
}

export function AtelierRemessaPanel({ lot, contractors, onClose }: Props) {
  const open = !!lot;
  const qc = useQueryClient();
  const rates = useAtelierOpenRates();
  const today = atelierTodayISO();
  const [sector, setSector] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [pairs, setPairs] = useState('48');
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [price, setPrice] = useState('');
  const [priceTouched, setPriceTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kitAck, setKitAck] = useState(false);
  const kitPending = !!lot && lot.kit_closed !== true;

  const jobs = (lot?.jobs ?? []).filter((job) => job.pipeline_status !== 'cancelled');
  const sectors = [...new Set(jobs.map((job) => job.sector))];

  useEffect(() => {
    if (!open) return;
    const first = (lot?.jobs ?? []).find((job) => job.pipeline_status !== 'cancelled')?.sector ?? '';
    setSector(first);
    setContractorId('');
    setPairs('48');
    setSizes({});
    setPrice('');
    setPriceTouched(false);
    setKitAck(false);
  }, [open, lot]);

  const balanceQuery = useQuery({
    queryKey: ['atelier-remessa-balance', lot?.id ?? ''],
    enabled: open,
    queryFn: async () => {
      const ids = jobs.map((job) => job.id);
      const grades = await Promise.all(ids.map(async (id) => {
        const { data, error } = await supabase.rpc('atelier_job_remaining_grade' as never, { p_job_id: id } as never);
        if (error) throw error;
        return { id, grade: (data ?? {}) as SizeGrade };
      }));
      const { data: parts, error: partError } = await supabase
        .from('atelier_job_parts' as never)
        .select('id, job_id, execution_mode, contractor_id, pairs, grade, service_order_id, unit_price')
        .in('job_id', ids);
      if (partError) throw partError;
      const { data: receipts, error: receiptError } = await supabase
        .from('atelier_job_receipts' as never)
        .select('part_id, job_id, pairs, qty_defect, qty_loss, reversed_at, rework_resolution_id')
        .in('job_id', ids);
      if (receiptError) throw receiptError;
      const osIds = [...new Set(((parts ?? []) as PartRow[]).map((part) => part.service_order_id).filter(Boolean))] as string[];
      const { data: orders, error: orderError } = osIds.length
        ? await supabase.from('service_orders' as never).select('id, order_number, status, unit_price, quantity, accepting_shipments, contractor_id').in('id', osIds)
        : { data: [] as OsRow[], error: null };
      if (orderError) throw orderError;
      return {
        grades,
        parts: (parts ?? []) as PartRow[],
        receipts: (receipts ?? []) as ReceiptRow[],
        orders: (orders ?? []) as OsRow[],
      };
    },
  });

  const sectorJobs = jobs.filter((job) => job.sector === sector);
  const sectorJobIds = sectorJobs.map((job) => job.id).join(',');
  const remaining = useMemo(() => {
    const ids = new Set(sectorJobIds.split(',').filter(Boolean));
    const grades = (balanceQuery.data?.grades ?? [])
      .filter((row) => ids.has(row.id))
      .map((row) => row.grade);
    return sumGrades(grades);
  }, [balanceQuery.data, sectorJobIds]);
  const sizeKeys = gradeSizeKeys(remaining);
  const remainingPairs = gradeTotal(remaining);

  useEffect(() => {
    const suggested = suggestRemessaGrade(remaining, Number(pairs) || 0);
    setSizes(sizesFromGrade(suggested));
  }, [pairs, sector, remaining]);

  const sectorParts = (balanceQuery.data?.parts ?? []).filter((part) => sectorJobs.some((job) => job.id === part.job_id));
  const orders = balanceQuery.data?.orders ?? [];
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const returnedByPart = new Map<string, number>();
  for (const receipt of balanceQuery.data?.receipts ?? []) {
    if (receipt.reversed_at || receipt.rework_resolution_id || !receipt.part_id) continue;
    const qty = Number(receipt.pairs) + Number(receipt.qty_defect || 0) + Number(receipt.qty_loss || 0);
    returnedByPart.set(receipt.part_id, (returnedByPart.get(receipt.part_id) || 0) + qty);
  }

  const byContractor = new Map<string, { sent: number; returned: number; os: OsRow | null }>();
  for (const part of sectorParts) {
    const key = part.execution_mode === 'internal' || !part.contractor_id ? INTERNAL : part.contractor_id;
    const row = byContractor.get(key) ?? { sent: 0, returned: 0, os: null };
    row.sent += Number(part.pairs) || 0;
    row.returned += returnedByPart.get(part.id) || 0;
    const os = part.service_order_id ? orderById.get(part.service_order_id) ?? null : null;
    if (os && (os.accepting_shipments || !row.os)) row.os = os;
    byContractor.set(key, row);
  }
  const sentTotal = [...byContractor.values()].reduce((sum, row) => sum + row.sent, 0);
  const internal = contractorId === INTERNAL;
  const sectorPairs = sectorJobs.reduce((sum, job) => sum + Math.trunc(Number(job.pairs) || 0), 0);
  const openOs = contractorId ? byContractor.get(contractorId)?.os : null;
  const inherited = !!(openOs && openOs.accepting_shipments);
  const suggestedPrice = atelierOpenRatePrice(rates.data ?? [], contractorId, sector, today);
  const shownPrice = inherited ? Number(openOs?.unit_price) || 0 : (priceTouched ? Number(price) : suggestedPrice);

  const grade = useMemo(() => {
    const out: SizeGrade = {};
    for (const key of sizeKeys) {
      const text = (sizes[key] ?? '').trim();
      if (text === '') continue;
      const qty = Number(text);
      if (Number.isFinite(qty)) out[key] = qty;
    }
    return out;
  }, [sizes, sizeKeys]);
  const gradeError = remessaGradeError(remaining, grade);

  const identities = lot ? atelierLotIdentityLines(lot).filter((line) => {
    if (sectorJobs.length === 0) return true;
    return sectorJobs.some((job) => (job.order_number ?? '').trim() === line.orderNumber);
  }) : [];

  async function refresh() {
    await qc.invalidateQueries({ queryKey: atelierKeys.all });
    await qc.invalidateQueries({ queryKey: ['atelier-remessa-balance', lot?.id ?? ''] });
  }

  async function send() {
    if (!lot || !sector || !contractorId) return;
    if (gradeError) {
      toast.error(gradeError);
      return;
    }
    if (priceTouched && !Number.isFinite(Number(price))) {
      toast.error('Informe o R$/par');
      return;
    }
    if (kitPending && !kitAck) {
      toast.error('Confirme a ressalva do kit pendente para enviar sem debitar o estoque que falta');
      return;
    }
    setBusy(true);
    try {
      if (kitPending && lot) await confirmAtelierOpenKitSend(lot.id);
      const data = await sendAtelierRemessa({
        lotId: lot.id,
        sector,
        contractorId: internal ? null : contractorId,
        grade,
        unitPrice: inherited || !priceTouched ? null : Number(price),
        internal,
      });
      await refresh();
      const number = data?.order_number;
      toast.success(number ? `Remessa na ${number}` : 'Remessa enviada', data?.service_order_id ? {
        action: {
          label: 'Imprimir',
          onClick: () => {
            const partId = data.part_ids?.[0];
            void printAtelierShipment(data.service_order_id as string, partId ? { partId } : undefined);
          },
        },
      } : undefined);
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'Falha ao enviar a remessa';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function closeOs(order: OsRow) {
    if (!window.confirm(`Encerrar envios de ${order.order_number || 'esta OS'}? Remessa nova deste destino abre outra OS.`)) return;
    setBusy(true);
    try {
      const data = await closeAtelierShipments(order.id);
      await refresh();
      toast.success(data?.concluded ? `${order.order_number} concluída` : `Envios de ${order.order_number} encerrados`);
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'Falha ao encerrar os envios';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Envios de {lot?.lot_number}</DialogTitle>
          <DialogDescription>
            Prestador ou a fábrica. A OS fica aberta até você encerrar os envios. A fábrica não gera conta.
          </DialogDescription>
        </DialogHeader>
        {lot && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-0.5">
              {(identities.length ? identities : atelierLotIdentityLines(lot)).map((line) => (
                <li key={`${line.orderNumber}-${line.pairs}`} className="text-[12px] text-foreground">
                  {atelierIdentityLabel(line)}
                </li>
              ))}
            </ul>
            {sectors.length > 1 && (
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger className="h-8" aria-label="Etapa">
                  <SelectValue placeholder="Etapa" />
                </SelectTrigger>
                <SelectContent>
                  {sectors.map((item) => (
                    <SelectItem key={item} value={item}>{ATELIER_SECTOR_LABEL[item as AtelierSector] ?? item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[12px] text-muted-foreground">
              <span className="font-semibold text-foreground">{sectorPairs}p no lote</span>
              {' · '}enviados {sentTotal}p
              {' · '}falta {remainingPairs}p
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {sizeKeys.map((key) => `${key === 'pares' ? 'Pares' : key} ${remaining[key]}`).join(' · ') || 'Sem saldo por numeração'}
            </p>
            <ul className="space-y-1">
              {[...byContractor.entries()].map(([id, row]) => {
                const name = id === INTERNAL ? 'Interno' : (contractors.find((item) => item.id === id)?.name ?? 'Prestador');
                return (
                  <li key={id} className="flex flex-wrap items-center gap-2 rounded border border-border/70 px-2 py-1 text-[12px]">
                    <span className="font-medium text-foreground">{name}</span>
                    <span className="text-muted-foreground">{row.sent}p enviados · {row.returned}p devolvidos</span>
                    {row.os?.order_number && <span className="font-mono text-[11px]">{row.os.order_number}</span>}
                    {row.os?.accepting_shipments && <span className="text-[11px] text-amber-700 dark:text-amber-400">aceitando remessas</span>}
                    {row.os && (
                      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => { void printAtelierShipment(row.os!.id); }}>
                        <Printer className="h-3 w-3" />
                        OS
                      </Button>
                    )}
                    {row.os?.accepting_shipments && (
                      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busy} onClick={() => { void closeOs(row.os!); }}>
                        Encerrar envios
                      </Button>
                    )}
                  </li>
                );
              })}
              {byContractor.size === 0 && <li className="text-[12px] text-muted-foreground">Nenhuma remessa nesta etapa.</li>}
            </ul>
            <div className="space-y-2 rounded border border-border/70 p-2">
              <Select value={contractorId || undefined} onValueChange={(value) => { setContractorId(value); setPriceTouched(false); }}>
                <SelectTrigger className="h-8" aria-label="Destino da remessa">
                  <SelectValue placeholder="Destino" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INTERNAL}>Produção interna (fábrica)</SelectItem>
                  {contractors.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-[12px]">
                Pares
                <Input className="h-8 w-24" inputMode="numeric" value={pairs} onChange={(event) => setPairs(event.target.value.replace(/[^\d]/g, ''))} />
                <span className="text-muted-foreground">de {remainingPairs} que faltam</span>
              </label>
              <div className="flex flex-wrap gap-1">
                {sizeKeys.map((key) => (
                  <label key={key} className="flex items-center gap-1 text-[11px]">
                    <span className="text-muted-foreground">{key === 'pares' ? 'Pares' : key}</span>
                    <Input
                      className="h-7 w-14 px-1 text-center"
                      inputMode="numeric"
                      value={sizes[key] ?? ''}
                      onChange={(event) => setSizes((prev) => ({ ...prev, [key]: event.target.value.replace(/[^\d]/g, '') }))}
                    />
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[12px]">
                {internal ? 'Custo interno' : (atelierRateLabel(sector) || 'R$/par')}
                <Input
                  className="h-8 w-24"
                  inputMode="decimal"
                  disabled={inherited || !contractorId}
                  value={inherited ? String(shownPrice || '') : (priceTouched ? price : (internal ? '' : (suggestedPrice ?? '')))}
                  onChange={(event) => { setPriceTouched(true); setPrice(event.target.value.replace(',', '.')); }}
                />
                {internal && <span className="text-muted-foreground">não gera conta</span>}
                {!internal && inherited && <span className="text-muted-foreground">preço da OS aberta</span>}
                {!internal && !inherited && shownPrice != null && Number(shownPrice) > 0 && (
                  <span className="text-muted-foreground">{formatCurrency(Number(shownPrice))}/par</span>
                )}
              </label>
              {gradeError && <p className={cn('text-[12px] text-destructive')}>{gradeError}</p>}
            </div>
          </div>
        )}
        {kitPending && (
          <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/10 p-3">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              {kitShortageBlockMessage(lot?.debits)}
            </p>
            <label className="flex items-start gap-2 text-xs text-foreground">
              <Checkbox checked={kitAck} onCheckedChange={(v) => setKitAck(v === true)} aria-label="Confirmar envio com kit pendente" />
              <span>Confirmo o envio com ressalva. O estoque que falta não será debitado e a OS será criada normalmente.</span>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button type="button" disabled={busy || !contractorId || !!gradeError || (kitPending && !kitAck)} onClick={() => { void send(); }}>
            <Truck className="h-4 w-4" />
            Enviar remessa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
