/**
 * Lançamento do pedido no Ateliê: quantos pares de cada cor vão para cada prestador.
 * O saldo ao vivo segue o lançamento por numeração. Gerar OS usa atelier_send_split.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleNotch as Loader2, Truck } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { AtelierReceiptDialog } from '@/components/atelier/AtelierReceiptDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useContractors, type Contractor } from '@/hooks/useContractors';
import {
  sendAtelierSplit,
  useAtelierContractorSectors,
  useAtelierOpenRates,
  type AtelierLotJob,
} from '@/hooks/useAtelier';
import { supabase } from '@/integrations/supabase/client';
import {
  ATELIER_PIPELINE_LABEL,
  ATELIER_SECTOR_LABEL,
  type AtelierPipelineStatus,
  type AtelierSector,
} from '@/lib/atelier';
import { atelierContractorCanTake, atelierOpenRatePrice, atelierRateSector, atelierTodayISO } from '@/lib/atelierAdmin';
import {
  colorSizeMeters,
  launchPriceSourceLabel,
  parseLaunchPayload,
  positiveGrade,
  providerColorLines,
  providerFichaWarning,
  resolveLaunchPairPrice,
  rowSizeCap,
  type LaunchColor,
  type LaunchPayload,
  type LaunchPriceSource,
  type ProviderColorLine,
} from '@/lib/atelierLancamento';
import { useOutsourcedPairLedger } from '@/hooks/useOutsourcedPairLedger';
import { totalsFromLedger } from '@/lib/outsourcedPairLedger';
import { gradeSizeKeys, gradeTotal, type SizeGrade } from '@/lib/atelierSplit';
import { cn } from '@/lib/utils';

interface DraftRow {
  key: string;
  mode: 'contractor' | 'internal';
  contractorId: string;
  sizes: SizeGrade;
  price: string;
  defaultPrice: number | null;
  defaultSource: LaunchPriceSource | null;
}

function blankRow(): DraftRow {
  return {
    key: `${Date.now()}-${Math.random()}`,
    mode: 'contractor',
    contractorId: '',
    sizes: {},
    price: '',
    defaultPrice: null,
    defaultSource: null,
  };
}

function priceInput(price: number | null): string {
  if (price == null) return '';
  return price.toFixed(2).replace('.', ',');
}

function parsePrice(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function pipelineLabel(status: string): string {
  return ATELIER_PIPELINE_LABEL[status as AtelierPipelineStatus] ?? status;
}

function sectorLabel(sector: string): string {
  return ATELIER_SECTOR_LABEL[sector as AtelierSector] ?? sector;
}

function useOrderLaunch(orderNumber: string) {
  const number = orderNumber.trim();
  return useQuery({
    queryKey: ['atelier-order-launch', number],
    enabled: number.length > 0,
    staleTime: 10_000,
    queryFn: async (): Promise<LaunchPayload> => {
      const { data, error } = await supabase.rpc(
        'list_atelier_order_launch' as never,
        { p_order_number: number } as never,
      );
      if (error) throw error;
      return parseLaunchPayload(data, number);
    },
  });
}

function Meter({ remaining, drafts }: { remaining: SizeGrade; drafts: SizeGrade[] }) {
  const meters = colorSizeMeters(remaining, drafts);
  if (meters.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {meters.map((meter) => (
        <div key={meter.size} className="w-[4.75rem] shrink-0 text-center">
          <p className="font-mono text-sm font-semibold text-foreground">
            {meter.size === 'pares' ? 'Pares' : meter.size}
          </p>
          <p className="font-mono text-xs" aria-live="polite">
            <span className="text-foreground">{meter.launched}</span>
            <span className="text-muted-foreground">/</span>
            <span className={cn(
              'font-semibold',
              meter.over && 'text-destructive',
              meter.done && 'text-green-600 dark:text-green-400',
              !meter.over && !meter.done && 'text-amber-600 dark:text-amber-400',
            )}>
              {meter.falta}
            </span>
          </p>
          <p className={cn(
            'text-[10px] font-semibold',
            meter.done ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
          )}>
            {meter.over ? 'acima' : meter.done ? 'completo' : 'falta'}
          </p>
        </div>
      ))}
    </div>
  );
}

export function AtelierLancamento() {
  const [params, setParams] = useSearchParams();
  const pedido = params.get('pedido') ?? '';
  const [typed, setTyped] = useState(pedido);
  const launch = useOrderLaunch(pedido);
  const contractors = useContractors();
  const sectors = useAtelierContractorSectors();
  const rates = useAtelierOpenRates();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, DraftRow[]>>({});
  const defaults = useRef<Record<string, DraftRow[]>>({});
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ProviderColorLine | null>(null);
  const today = atelierTodayISO();
  const payload = launch.data;
  const ledger = useOutsourcedPairLedger('week');
  const preferredByJob = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of ledger.data ?? []) {
      if (line.jobId && line.contractorId && !map.has(line.jobId)) map.set(line.jobId, line.contractorId);
    }
    return map;
  }, [ledger.data]);
  useEffect(() => {
    if (!payload?.colors.length) return;
    setDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const color of payload.colors) {
        const preferred = preferredByJob.get(color.jobId);
        if (!preferred) continue;
        const rows = next[color.jobId] ?? defaults.current[color.jobId];
        if (!rows || rows.length !== 1 || rows[0].contractorId) continue;
        const filled = [{ ...rows[0], mode: 'contractor' as const, contractorId: preferred }];
        next[color.jobId] = filled;
        defaults.current[color.jobId] = filled;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [payload, preferredByJob]);
  const contractorRows = (contractors.data ?? []) as Contractor[];
  const jobIds = (payload?.colors ?? []).map((color) => color.jobId).filter(Boolean);
  const sheetsQuery = useQuery({
    queryKey: ['atelier-launch-sheets', jobIds],
    enabled: jobIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cabedal_prep_jobs' as never)
        .select('id, technical_sheet_id')
        .in('id', jobIds);
      if (error) throw error;
      const rows = (data ?? []) as { id: string; technical_sheet_id: string | null }[];
      return new Map(rows.map((row) => [row.id, row.technical_sheet_id]));
    },
  });
  const sheetIds = [...new Set(
    [...(sheetsQuery.data?.values() ?? [])].filter((id): id is string => !!id),
  )];
  const referenceRates = useQuery({
    queryKey: ['atelier-launch-reference-rates', sheetIds],
    enabled: sheetIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contractor_reference_rates' as never)
        .select('contractor_id, technical_sheet_id, sector, price_per_pair, valid_from, valid_to')
        .in('technical_sheet_id', sheetIds)
        .is('valid_to', null);
      if (error) throw error;
      return (data ?? []) as {
        contractor_id: string;
        technical_sheet_id: string;
        sector: string;
        price_per_pair: number;
        valid_from: string;
      }[];
    },
  });
  const sheetPrices = useQuery({
    queryKey: ['atelier-launch-sheet-prices', sheetIds],
    enabled: sheetIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('atelier_complex_references' as never)
        .select('reference_id, sector, value_per_pair, active')
        .in('reference_id', sheetIds)
        .eq('active', true);
      if (error) throw error;
      return (data ?? []) as {
        reference_id: string;
        sector: string;
        value_per_pair: number | null;
      }[];
    },
  });

  const quoteFor = (color: LaunchColor, contractorId: string) => {
    const sheetId = sheetsQuery.data?.get(color.jobId) ?? null;
    const rateSector = atelierRateSector(color.sector);
    const reference = (referenceRates.data ?? []).find((row) => (
      row.contractor_id === contractorId
      && row.technical_sheet_id === sheetId
      && row.sector === rateSector
      && row.valid_from.slice(0, 10) <= today
    ));
    return resolveLaunchPairPrice({
      referencePrice: reference?.price_per_pair,
      sectorPrice: atelierOpenRatePrice(rates.data ?? [], contractorId, color.sector, today),
      sheetPrice: (sheetPrices.data ?? []).find((row) => (
        row.reference_id === sheetId && row.sector === color.sector
      ))?.value_per_pair,
    });
  };

  const optionsFor = (sectorName: string) => contractorRows.filter((contractor) => (
    atelierContractorCanTake(contractor, sectorName, sectors.data ?? [])
  ));

  const setPedido = (value: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      const clean = value.trim();
      if (clean) next.set('pedido', clean);
      else next.delete('pedido');
      return next;
    }, { replace: true });
  };

  const rowsOf = (jobId: string) => {
    if (drafts[jobId]) return drafts[jobId];
    if (!defaults.current[jobId]) defaults.current[jobId] = [blankRow()];
    return defaults.current[jobId];
  };

  const setRows = (jobId: string, next: DraftRow[]) => {
    setDrafts((current) => ({ ...current, [jobId]: next }));
  };

  const summary = useMemo(
    () => providerColorLines(payload?.colors ?? []),
    [payload],
  );

  const send = async (color: LaunchColor) => {
    const rows = rowsOf(color.jobId);
    const grades = rows.map((row) => positiveGrade(row.sizes));
    if (colorSizeMeters(color.remaining, grades).some((meter) => meter.over)) {
      toast.error('Algum tamanho passou do saldo desta cor.');
      return;
    }
    const parts = rows.flatMap((row, index) => {
      const grade = grades[index];
      if (gradeTotal(grade) <= 0) return [];
      const standard = row.mode === 'contractor' && row.contractorId
        ? quoteFor(color, row.contractorId).price
        : null;
      const typed = parsePrice(row.price);
      return [{
        mode: 'contractor' as const,
        contractor_id: row.mode === 'contractor' ? row.contractorId || null : null,
        grade,
        unit_price: typed ?? standard,
        save_reference_rate: false,
      }];
    });
    if (parts.length === 0) {
      toast.error('Informe ao menos 1 par.');
      return;
    }
    if (parts.some((part) => part.mode === 'contractor' && !part.contractor_id)) {
      toast.error('Escolha o prestador de cada parte.');
      return;
    }
    if (parts.some((part) => part.mode === 'contractor' && !(Number(part.unit_price) > 0))) {
      toast.error('Informe o R$/par maior que zero. O padrão da ficha não muda.');
      return;
    }
    setBusyJob(color.jobId);
    try {
      const result = await sendAtelierSplit({ jobId: color.jobId, parts });
      const made = result?.service_order_ids?.length ?? 0;
      toast.success(made > 0
        ? `${color.color}: ${made} OS gerada${made === 1 ? '' : 's'}`
        : `${color.color}: parte lançada`);
      setDrafts((current) => ({ ...current, [color.jobId]: [blankRow()] }));
      await qc.invalidateQueries({ queryKey: ['atelier-order-launch'] });
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'Falha ao gerar a OS';
      toast.error(message);
    } finally {
      setBusyJob(null);
    }
  };

  const reserve = async (color: LaunchColor) => {
    const rows = rowsOf(color.jobId);
    const grades = rows.map((row) => positiveGrade(row.sizes));
    if (colorSizeMeters(color.remaining, grades).some((meter) => meter.over)) {
      toast.error('Algum tamanho passou do saldo desta cor.');
      return;
    }
    const parts = rows.flatMap((row, index) => {
      const grade = grades[index];
      if (gradeTotal(grade) <= 0 || !row.contractorId) return [];
      const price = row.price.trim().replace(',', '.');
      return [{
        contractor_id: row.contractorId,
        grade,
        unit_price: price === '' ? null : Number(price),
      }];
    });
    if (parts.length === 0) {
      toast.error('Escolha o prestador e ao menos 1 par para reservar.');
      return;
    }
    setBusyJob(color.jobId);
    try {
      const { error } = await supabase.rpc('save_atelier_launch_reservation' as never, {
        p_job_id: color.jobId,
        p_parts: parts,
      } as never);
      if (error) throw error;
      toast.success(`${color.color}: divisão reservada. A OS sai depois do corte.`);
      await qc.invalidateQueries({ queryKey: ['atelier-launch-reservations'] });
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'Falha ao reservar a divisão';
      toast.error(message);
    } finally {
      setBusyJob(null);
    }
  };

  const receiptJob: AtelierLotJob | null = receipt && payload ? {
    id: receipt.jobId,
    sector: receipt.sector as AtelierSector,
    pipeline_status: 'sent_to_contractor',
    pairs: receipt.sent,
    sale_order_item_id: null,
    order_number: payload.orderNumber,
    contractor_id: null,
    contractor_name: receipt.contractorName,
    atelier_service_number: receipt.serviceOrderNumber,
    target_end: null,
    execution_mode: receipt.contractorKey === 'internal' ? 'internal' : 'contractor',
    received_pairs: receipt.received,
  } : null;

  const grouped = new Map<string, LaunchColor[]>();
  for (const color of payload?.colors ?? []) {
    const list = grouped.get(color.sector) ?? [];
    list.push(color);
    grouped.set(color.sector, list);
  }

  return (
    <div className="space-y-4">
      <Panel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <label className="flex-1 space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pedido</span>
          <SearchInput
            value={typed}
            onChange={setTyped}
            placeholder="PV-00…"
            className="h-9"
            onKeyDown={(event) => {
              if (event.key === 'Enter') setPedido(typed);
            }}
          />
        </label>
        <Button type="button" size="sm" className="h-9" onClick={() => setPedido(typed)}>
          Abrir pedido
        </Button>
      </Panel>
      <p className="text-sm text-muted-foreground">
        A ficha de 12, 15 ou 18 é do pedido. A parte de um prestador pode não fechar ficha: a tela avisa e a OS segue.
      </p>

      {!pedido.trim() ? null : launch.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : launch.isError ? (
        <p className="text-sm text-destructive">Não foi possível ler o lançamento deste pedido.</p>
      ) : payload && !payload.found ? (
        <p className="text-sm text-muted-foreground">Nenhum pedido ativo com esse número.</p>
      ) : payload ? (
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{payload.orderNumber}</span>
            {payload.status ? ` · ${payload.status}` : ''}
          </p>
          {payload.gaps.length > 0 && (
            <Panel className="space-y-1 border-amber-500/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Divergência de quantidade
              </p>
              {payload.gaps.map((gap, index) => (
                <p key={`${gap.kind}-${index}`} className="text-sm text-foreground">
                  {gap.color ? `${gap.color} · ` : ''}{gap.detail}
                </p>
              ))}
            </Panel>
          )}
          {[...grouped.entries()].map(([sector, colors]) => (
            <section key={sector} className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">{sectorLabel(sector)}</h2>
              {colors.map((color) => {
                const rows = rowsOf(color.jobId);
                const grades = rows.map((row) => positiveGrade(row.sizes));
                const sizes = gradeSizeKeys(color.remaining);
                const over = colorSizeMeters(color.remaining, grades).some((meter) => meter.over);
                return (
                  <Panel key={color.jobId} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-semibold text-foreground">
                          {color.color}
                          {color.referenceCode ? ` · ${color.referenceCode}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {color.pairs} pares · {pipelineLabel(color.pipelineStatus)}
                          {(() => {
                            const motor = totalsFromLedger((ledger.data ?? []).filter((line) => line.jobId === color.jobId));
                            if (!ledger.data) return '';
                            return ` · motor: a enviar ${motor.balance} · na rua ${motor.street} · recebido ${motor.received}`;
                          })()}
                          {color.itemPairs != null && color.itemPairs !== color.pairs
                            ? ` · item do PV ${color.itemPairs}`
                            : ''}
                          {color.opPairs != null && color.itemPairs != null && color.opPairs !== color.itemPairs
                            ? ` · OP ${color.opPairs}`
                            : ''}
                        </p>
                      </div>
                    </div>
                    {color.parts.length > 0 && (
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {color.parts.map((part) => (
                          <li key={part.id}>
                            {part.executionMode === 'internal' ? 'Interno em aberto' : (part.contractorName ?? 'Prestador')}
                            {` · ${part.pairs} enviados · ${part.receivedPairs} recebidos`}
                            {part.serviceOrderNumber ? ` · ${part.serviceOrderNumber}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!color.canSend && (
                      <p className="text-sm text-muted-foreground">
                        {color.blockReason || 'O envio espera o corte e o kit.'} A divisão entre prestadores pode ser reservada agora. A OS só sai depois do corte, com o kit fechado.
                      </p>
                    )}
                    {(
                      <>
                        <Meter remaining={color.remaining} drafts={grades} />
                        {rows.map((row, index) => {
                          const warning = providerFichaWarning(color.color, grades[index]);
                          const quote = row.mode === 'contractor' && row.contractorId
                            ? quoteFor(color, row.contractorId)
                            : { price: null as number | null, source: null as LaunchPriceSource | null };
                          const shownPrice = row.price !== '' ? row.price : priceInput(quote.price);
                          const differs = row.mode === 'contractor' && priceWasEdited(parsePrice(shownPrice), quote.price);
                          return (
                            <div key={row.key} className="space-y-2 rounded-md border border-border p-2">
                              <div className="flex flex-wrap items-center gap-2">
                                {row.mode === 'contractor' && (
                                  <Select
                                    value={row.contractorId || undefined}
                                    onValueChange={(value) => {
                                      const next = quoteFor(color, value);
                                      setRows(color.jobId, rows.map((item, i) => (
                                        i === index ? {
                                          ...item,
                                          contractorId: value,
                                          price: priceInput(next.price),
                                          defaultPrice: next.price,
                                          defaultSource: next.source,
                                        } : item
                                      )));
                                    }}
                                  >
                                    <SelectTrigger className="h-8 w-[220px] text-xs" aria-label="Prestador">
                                      <SelectValue placeholder="Prestador" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {optionsFor(color.sector).map((contractor) => (
                                        <SelectItem key={contractor.id} value={contractor.id}>{contractor.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                {row.mode === 'contractor' && (
                                  <label className="text-[11px] text-muted-foreground">
                                    R$/par
                                    <Input
                                      inputMode="decimal"
                                      aria-label="R$/par"
                                      className={cn(
                                        'ml-1 h-8 w-24 font-mono text-xs',
                                        differs && 'border-amber-500',
                                      )}
                                      value={shownPrice}
                                      onChange={(event) => setRows(color.jobId, rows.map((item, i) => (
                                        i === index ? { ...item, price: event.target.value } : item
                                      )))}
                                    />
                                  </label>
                                )}
                                {row.mode === 'contractor' && quote.price != null && quote.source && (
                                  <span className="text-[11px] text-muted-foreground">
                                    Padrão {formatCurrency(quote.price)} · {launchPriceSourceLabel(quote.source)}
                                  </span>
                                )}
                                {row.mode === 'contractor' && row.contractorId && quote.price == null && (
                                  <span className="text-[11px] text-muted-foreground">
                                    Sem padrão nesta ficha. O valor fica só nesta OS.
                                  </span>
                                )}
                                {differs && (
                                  <span className="text-[11px] text-amber-700 dark:text-amber-400">
                                    Diferente do padrão. Vale só nesta OS. A ficha não muda.
                                  </span>
                                )}
                              </div>
                              <div className="flex gap-2 overflow-x-auto">
                                {sizes.map((size) => {
                                  const cap = rowSizeCap(color.remaining, grades, index, size);
                                  const typedQty = Math.min(Math.trunc(row.sizes[size] || 0), cap);
                                  return (
                                    <div key={size} className="flex w-[4.75rem] shrink-0 flex-col gap-1">
                                      <span className="text-center font-mono text-sm font-semibold text-foreground">
                                        {size === 'pares' ? 'Pares' : size}
                                      </span>
                                      <NumberInput
                                        aria-label={`${color.color} ${size}`}
                                        inputMode="numeric"
                                        decimals={0}
                                        min={0}
                                        max={cap}
                                        value={typedQty}
                                        disabled={cap === 0 && typedQty === 0}
                                        onClamp={(attempted) => setBlocked(`${color.color} ${size}: só há ${cap} pares neste saldo. O campo voltou para ${cap}. Tentativa ${attempted}.`)}
                                        onChange={(next) => {
                                          setBlocked(null);
                                          setRows(color.jobId, rows.map((item, i) => (
                                            i === index ? { ...item, sizes: { ...item.sizes, [size]: next } } : item
                                          )));
                                        }}
                                        className="h-11 px-1 text-center md:h-10"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                              {warning && (
                                <p className="text-xs text-amber-700 dark:text-amber-400">{warning}</p>
                              )}
                            </div>
                          );
                        })}
                        {blocked && <p role="alert" className="text-xs font-medium text-destructive">{blocked}</p>}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9"
                            onClick={() => setRows(color.jobId, [...rows, blankRow()])}
                          >
                            Outro prestador
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9"
                            disabled={busyJob === color.jobId}
                            onClick={() => void reserve(color)}
                          >
                            Reservar divisão
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-9"
                            disabled={busyJob === color.jobId || over || !color.canSend}
                            title={color.canSend ? undefined : (color.blockReason || 'O envio espera o corte e o kit.')}
                            onClick={() => void send(color)}
                          >
                            {busyJob === color.jobId
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Truck className="h-3.5 w-3.5" />}
                            Gerar OS desta cor
                          </Button>
                        </div>
                      </>
                    )}
                  </Panel>
                );
              })}
            </section>
          ))}
          {payload.colors.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Este pedido não tem costura nem aviamento no Ateliê.
            </p>
          )}
          <Panel className="space-y-2 p-4">
            <h2 className="text-sm font-semibold text-foreground">Com cada prestador</h2>
            {summary.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma parte enviada ainda.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {summary.map((line) => (
                  <li key={line.partId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p className="text-sm text-foreground">
                        {line.contractorName} · {line.color}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sectorLabel(line.sector)}
                        {` · ${line.sent} enviados · ${line.received} recebidos · ${line.pending} pendentes`}
                        {line.serviceOrderNumber ? ` · ${line.serviceOrderNumber}` : ''}
                      </p>
                    </div>
                    {line.pending > 0 && (
                      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setReceipt(line)}>
                        Lançar recebimento
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}
      <AtelierReceiptDialog
        job={receiptJob}
        initialPartId={receipt?.partId ?? null}
        onClose={() => {
          setReceipt(null);
          void qc.invalidateQueries({ queryKey: ['atelier-order-launch'] });
        }}
      />
    </div>
  );
}
