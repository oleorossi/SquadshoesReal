/**
 * Fila baixa do Corte Cabedal. Cada lançamento inclui os prestadores
 * de novo: o último envio e o preferido já vêm na coluna da direita.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, DotsSixVertical, Printer, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useOutsourcedPairLedger } from '@/hooks/useOutsourcedPairLedger';
import { thumbUrl } from '@/lib/imageThumb';
import {
  cutTotal,
  parseCutQueue,
  resolveCutPhoto,
  singleRange,
  sizeGradeForCut,
  suggestContractorIds,
  weekLoad,
  type CutContractorOption,
  type CutQueueCard,
} from '@/lib/corteCabedal';
import { printCutFollowSheets, type CutFollowSheetInput } from '@/lib/printCutFollowSheet';

interface CreatedOrder {
  id: string;
  number: string | null;
  contractor_id: string;
  contractor_name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  quantity: number;
  unit_price: number;
  total_value: number;
  grade: Record<string, number>;
  return_on: string | null;
}

function sectorKeyOf(sector: string): string {
  const key = sector.toLowerCase();
  if (key.includes('aviamento') || key === 'mesa') return 'aviamento';
  if (key.includes('costura')) return 'costura';
  return key;
}

function weekStartIso(date = new Date()): string {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - mondayOffset);
  const month = String(copy.getMonth() + 1).padStart(2, '0');
  const day = String(copy.getDate()).padStart(2, '0');
  return `${copy.getFullYear()}-${month}-${day}`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function money(value: number): string {
  return Number(value || 0).toFixed(2).replace('.', ',');
}

export function ReferenceThumb({ url, size = 48 }: { url: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = url ? (thumbUrl(url, size) || url) : '';
  if (!src || broken) {
    return (
      <div
        className="flex shrink-0 items-center justify-center bg-muted text-[10px] uppercase tracking-wide text-muted-foreground"
        style={{ width: size, height: size }}
      >
        Sem foto
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 object-cover"
      onError={() => setBroken(true)}
    />
  );
}

export function CorteCabedalQueue() {
  const query = useQuery({
    queryKey: ['atelier-cut-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_atelier_cut_queue' as never);
      if (error) throw error;
      return parseCutQueue(data);
    },
    staleTime: 30_000,
  });
  const contractors = useQuery({
    queryKey: ['atelier-cut-contractors'],
    queryFn: loadContractors,
    staleTime: 60_000,
  });
  const ledger = useOutsourcedPairLedger('week');
  const cards = (query.data ?? []).filter((card) => card.inQueue);
  if (query.isError) {
    return <p className="px-2 py-3 text-xs text-destructive">Não foi possível ler a fila de corte.</p>;
  }
  if (cards.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-border px-2 py-3">
      {cards.map((card) => (
        <CorteLaunchBody
          key={card.jobId}
          card={card}
          contractors={contractors.data ?? []}
          ledgerLines={ledger.data ?? []}
        />
      ))}
    </div>
  );
}

async function loadContractors(): Promise<CutContractorOption[]> {
  const db = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: boolean) => Promise<{ data: unknown; error: { message: string } | null }>;
        then: Promise<{ data: unknown; error: { message: string } | null }>['then'];
      };
    };
  };
  const peopleQuery = await db
    .from('contractors')
    .select('id, name, trade_name, phone, address, city, state, active, payment_days')
    .eq('active', true);
  if (peopleQuery.error) throw peopleQuery.error;
  const sectorQuery = await db
    .from('atelier_contractor_sectors')
    .select('contractor_id, sector, active');
  const sectors = (sectorQuery.data ?? []) as Array<{ contractor_id: string; sector: string; active: boolean }>;
  const people = (peopleQuery.data ?? []) as Array<{
    id: string;
    name: string;
    trade_name: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    payment_days: number | null;
  }>;
  const declared = new Set(sectors.map((row) => row.contractor_id));
  const allowed = new Set(
    sectors
      .filter((row) => row.active && (row.sector === 'costura_cabedal' || row.sector === 'aviamento'))
      .map((row) => row.contractor_id),
  );
  return people
    .filter((row) => (row.payment_days ?? 0) < 999 && (!declared.has(row.id) || allowed.has(row.id)))
    .map((row) => ({
      id: row.id,
      name: row.trade_name?.trim() || row.name,
      phone: row.phone,
      address: row.address,
      city: row.city,
      state: row.state,
      preferred: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function CorteLaunchBody({
  card,
  contractors,
  ledgerLines = [],
  previewApprove,
  initialStep = 'pick',
  startOpen = false,
}: {
  card: CutQueueCard;
  contractors: CutContractorOption[];
  ledgerLines?: Array<{ contractorId: string | null; sectorKey: string | null; periodStart: string | null; streetPairs: number; capacityPeriod: number | null }>;
  previewApprove?: (parts: Array<{ contractorId: string; ranges: Record<string, number>; unitPrice: number }>) => CreatedOrder[];
  initialStep?: 'pick' | 'fill' | 'done';
  startOpen?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(startOpen || previewApprove != null);
  const [step, setStep] = useState(initialStep);
  const [included, setIncluded] = useState<string[]>(() => suggestContractorIds(
    card.lastContractorIds,
    card.preferredContractorId,
    contractors.map((person) => person.id),
  ));
  const [rows, setRows] = useState<Record<string, { ranges: Record<string, number>; price: string }>>(() => {
    if (initialStep !== 'fill') return {};
    const seed = suggestContractorIds(card.lastContractorIds, card.preferredContractorId, contractors.map((person) => person.id));
    return Object.fromEntries(seed.map((id, index) => [id, {
      ranges: Object.fromEntries(card.ranges.map((range) => [range.label, index === 0 ? (range.label === 'P' ? 10 : 40) : (range.label === 'P' ? 20 : 80)])),
      price: '12,50',
    }]));
  });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedOrder[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const labels = card.ranges.map((range) => range.label);
  const one = singleRange(card.ranges);
  const launchNumber = card.history.length + 1;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const byId = useMemo(() => new Map(contractors.map((person) => [person.id, person])), [contractors]);
  const available = contractors.map((person) => person.id).filter((id) => !included.includes(id));
  const week = weekStartIso();
  const key = sectorKeyOf(card.sector);

  function move(id: string, to: 'included' | 'available') {
    setIncluded((current) => {
      const without = current.filter((item) => item !== id);
      return to === 'included' ? [...without, id] : without;
    });
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : '';
    if (!over) return;
    const toIncluded = over === 'included' || included.includes(over);
    move(active, toIncluded ? 'included' : 'available');
  }

  async function confirmPeople() {
    if (included.length === 0) {
      toast.error('Inclua ao menos um prestador.');
      return;
    }
    const next: typeof rows = {};
    const prices = await suggestedPrices(included, card, previewApprove != null);
    for (const id of included) {
      next[id] = {
        ranges: Object.fromEntries(labels.map((label) => [label, 0])),
        price: prices[id] || '',
      };
    }
    setRows(next);
    setRequestId(crypto.randomUUID());
    setStep('fill');
  }

  const sums: Record<string, number> = {};
  for (const label of labels) {
    sums[label] = included.reduce((sum, id) => sum + Math.max(0, Math.trunc(rows[id]?.ranges[label] || 0)), 0);
  }
  const total = cutTotal(sums);
  const within = labels.every((label) => {
    const cap = card.ranges.find((range) => range.label === label)?.cap ?? 0;
    return sums[label] <= cap;
  });
  const priced = included.every((id) => Number(String(rows[id]?.price || '').replace(',', '.')) > 0);
  const ready = total > 0 && within && priced && included.length > 0;

  async function approve() {
    if (!ready) return;
    setBusy(true);
    const parts = included.map((id) => ({
      contractorId: id,
      ranges: rows[id].ranges,
      unitPrice: Number(rows[id].price.replace(',', '.')) || 0,
    }));
    try {
      if (previewApprove) {
        setCreated(previewApprove(parts));
        setStep('done');
        return;
      }
      const { data, error } = await supabase.rpc('approve_atelier_cut' as never, {
        p_job_id: card.jobId,
        p_ranges: labels.map((label) => ({ label, pairs: sums[label] || 0 })),
        p_parts: parts.map((part) => ({
          contractor_id: part.contractorId,
          ranges: part.ranges,
          unit_price: part.unitPrice,
        })),
        p_client_request_id: requestId,
      } as never);
      if (error) throw error;
      const payload = data as { orders?: CreatedOrder[] };
      setCreated(payload.orders ?? []);
      setStep('done');
      await queryClient.invalidateQueries({ queryKey: ['atelier-cut-queue'] });
      toast.success('Corte aprovado. As OS foram geradas.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível aprovar o corte.');
    } finally {
      setBusy(false);
    }
  }

  async function printSheets() {
    const sizes = Object.fromEntries(card.ranges.map((range) => [range.label, range.sizes]));
    const sheets: CutFollowSheetInput[] = created.map((order) => ({
      order: {
        number: order.number,
        contractorName: order.contractor_name,
        phone: order.phone,
        address: order.address,
        city: order.city,
        state: order.state,
        quantity: order.quantity,
        grade: order.grade,
        sizeGrade: sizeGradeForCut(card.ranges, order.grade, card.itemGrade),
        returnOn: order.return_on,
      },
      orderNumber: card.orderNumber,
      clientName: card.clientName,
      referenceCode: card.referenceCode,
      referenceName: card.referenceName,
      imageUrl: card.photoUrl || null,
      color: card.color,
      sectorLabel: card.sectorLabel,
      billingWeek: card.billingWeek,
      sizesByRange: sizes,
      sentOn: new Date().toLocaleDateString('pt-BR'),
      launchNumber,
      partial: total < card.remainingPairs,
    }));
    await printCutFollowSheets(sheets);
  }

  return (
    <article className="rounded-md border border-border bg-card p-3 text-sm">
      <button type="button" className="flex w-full gap-2 text-left" onClick={() => setOpen((value) => !value)}>
        <ReferenceThumb url={card.photoUrl} />
        <span>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Prioridade baixa · Aprovado, material disponível
          </span>
          <span className="mt-1 block font-semibold text-foreground">{card.orderNumber} · {card.color || 'sem cor'}</span>
          <span className="block text-xs text-muted-foreground">
            {card.referenceCode || card.referenceName} · lançamento {launchNumber} · já cortado {card.cutPairs} · saldo {card.remainingPairs}
          </span>
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <History card={card} />
          {step === 'pick' && (
            <>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={(event: DragStartEvent) => setDragging(String(event.active.id))}
                onDragEnd={onDragEnd}
              >
                <div className="grid grid-cols-2 gap-2">
                  <Column
                    id="available"
                    title="Disponíveis"
                    ids={available}
                    render={(id) => (
                      <PersonRow
                        person={byId.get(id)}
                        preferred={id === card.preferredContractorId}
                        last={card.lastContractorIds.includes(id)}
                        load={weekLoad(ledgerLines, id, key, week)}
                        sector={card.sectorLabel}
                        onTap={() => move(id, 'included')}
                      />
                    )}
                  />
                  <Column
                    id="included"
                    title="Incluídos"
                    ids={included}
                    render={(id) => (
                      <PersonRow
                        person={byId.get(id)}
                        preferred={id === card.preferredContractorId}
                        last={card.lastContractorIds.includes(id)}
                        load={weekLoad(ledgerLines, id, key, week)}
                        sector={card.sectorLabel}
                        onRemove={() => move(id, 'available')}
                        onTap={() => move(id, 'available')}
                      />
                    )}
                  />
                </div>
                <DragOverlay>
                  {dragging ? <div className="rounded border border-primary bg-card px-2 py-1 text-xs">{byId.get(dragging)?.name}</div> : null}
                </DragOverlay>
              </DndContext>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{included.length} incluído{included.length === 1 ? '' : 's'}</span>
                <Button type="button" size="sm" className="h-9" onClick={() => void confirmPeople()}>Confirmar prestadores</Button>
              </div>
            </>
          )}

          {step === 'fill' && (
            <>
              <div className="rounded border border-border p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Total deste corte</div>
                <div className="text-2xl font-semibold tabular-nums">{total}</div>
                <div className="text-xs text-muted-foreground">Restante após este corte: {Math.max(card.remainingPairs - total, 0)}</div>
              </div>
              {included.map((id) => {
                const row = rows[id];
                if (!row) return null;
                return (
                  <div key={id} className="space-y-2 rounded border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <strong>{byId.get(id)?.name}</strong>
                      <button type="button" className="text-muted-foreground" aria-label="Remover prestador" onClick={() => move(id, 'available')}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {card.ranges.map((range) => (
                      <label key={range.label} className="block text-xs">
                        <span className="font-medium">
                          {one ? 'Pares' : range.label}
                          {range.sizes.length > 0 ? ` · ${range.sizes.join(' ')}` : ''}
                          {' '}· saldo {range.cap}
                        </span>
                        <input
                          inputMode="numeric"
                          className="mt-1 h-9 w-full rounded border border-border bg-background px-2"
                          value={row.ranges[range.label] || ''}
                          onChange={(event) => {
                            const value = Number(event.target.value.replace(/\D/g, '')) || 0;
                            setRows((prev) => ({ ...prev, [id]: { ...row, ranges: { ...row.ranges, [range.label]: value } } }));
                          }}
                        />
                      </label>
                    ))}
                    <div className="text-xs">Total do prestador: {cutTotal(row.ranges)}</div>
                    <label className="block text-xs">
                      R$/par neste pedido
                      <input
                        inputMode="decimal"
                        className="mt-1 h-9 w-full rounded border border-border bg-background px-2"
                        value={row.price}
                        onChange={(event) => setRows((prev) => ({ ...prev, [id]: { ...row, price: event.target.value } }))}
                      />
                    </label>
                  </div>
                );
              })}
              <div className="space-y-1">
                {labels.map((label) => {
                  const cap = card.ranges.find((range) => range.label === label)?.cap ?? 0;
                  const left = cap - sums[label];
                  const ok = left >= 0;
                  return (
                    <div key={label} className={`rounded px-2 py-1 text-xs ${ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
                      {one ? 'Pares' : label}: saldo {cap} · neste corte {sums[label]} · restante {left}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="text-xs underline" onClick={() => setStep('pick')}>editar prestadores</button>
                <Button type="button" size="sm" className="h-9" disabled={!ready || busy} onClick={() => void approve()}>
                  <Check className="mr-1 h-4 w-4" /> Aprovar corte e gerar OS
                </Button>
              </div>
            </>
          )}

          {step === 'done' && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Aguardando envio · corte {launchNumber} · {total} pares · restante {Math.max(card.remainingPairs - total, 0)}
              </div>
              {created.map((order) => (
                <div key={order.id} className="rounded border border-border p-2 text-xs">
                  <div className="font-semibold">{order.number || 'OS'} · {order.contractor_name}</div>
                  <div>{order.quantity} pares · R$ {money(order.unit_price)} / par · R$ {money(order.total_value)}</div>
                  <div>{Object.entries(order.grade).filter(([, qty]) => qty > 0).map(([label, qty]) => `${label} ${qty}`).join(' · ')}</div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" className="h-9" onClick={() => void printSheets()}>
                  <Printer className="mr-1 h-4 w-4" /> Imprimir OS
                </Button>
                <a className="inline-flex h-9 items-center text-xs underline" href="/terceirizados?tab=rua">Ver em Ordens de Serviço</a>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function History({ card }: { card: CutQueueCard }) {
  return (
    <div className="space-y-1 text-xs">
      <div className="font-medium text-foreground">Histórico de cortes</div>
      {card.history.length === 0 && <div className="text-muted-foreground">Nenhum corte lançado ainda.</div>}
      {card.history.map((entry, index) => (
        <div key={entry.id} className="text-muted-foreground">
          Corte {index + 1} · {formatWhen(entry.at)} · {entry.ranges.map((range) => `${range.label} ${range.pairs}`).join(' · ') || `${entry.totalPairs} pares`}
          {' · '}
          {entry.orders.map((order) => `${order.number || 'OS'} ${order.contractorName}`).join(', ')}
        </div>
      ))}
    </div>
  );
}

function Column({
  id,
  title,
  ids,
  render,
}: {
  id: string;
  title: string;
  ids: string[];
  render: (id: string) => ReactNode;
}) {
  const drop = useDroppable({ id });
  return (
    <div ref={drop.setNodeRef} className={`min-h-24 rounded border p-1 ${drop.isOver ? 'border-primary bg-primary/5' : 'border-border'}`}>
      <div className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-1">
          {ids.map((item) => <div key={item}>{render(item)}</div>)}
        </div>
      </SortableContext>
    </div>
  );
}

function PersonRow({
  person,
  preferred,
  last,
  load,
  sector,
  onRemove,
  onTap,
}: {
  person?: CutContractorOption;
  preferred: boolean;
  last: boolean;
  load: { street: number; free: number | null };
  sector: string;
  onRemove?: () => void;
  onTap: () => void;
}) {
  const sortable = useSortable({ id: person?.id || 'vazio' });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className="rounded border border-border bg-card p-1.5 text-xs"
    >
      <div className="flex items-start gap-1">
        <button type="button" className="mt-0.5 text-muted-foreground" aria-label="Arrastar" {...sortable.attributes} {...sortable.listeners}>
          <DotsSixVertical className="h-4 w-4" />
        </button>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onTap}>
          <div className="font-medium">{person?.name}</div>
          <div className="text-[10px] text-muted-foreground">
            {sector} · capacidade livre {load.free == null ? 'sem cadastro' : load.free} · na rua {load.street}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {preferred && <span className="rounded bg-muted px-1 text-[10px]">preferido do pedido</span>}
            {last && <span className="rounded bg-muted px-1 text-[10px]">último envio</span>}
          </div>
        </button>
        {onRemove && (
          <button type="button" aria-label="Remover" onClick={onRemove}><X className="h-3.5 w-3.5" /></button>
        )}
      </div>
    </div>
  );
}

async function suggestedPrices(ids: string[], card: CutQueueCard, preview: boolean): Promise<Record<string, string>> {
  const prices: Record<string, string> = {};
  if (preview || !card.sheetId) {
    for (const id of ids) prices[id] = preview ? '12,50' : '';
    return prices;
  }
  await Promise.all(ids.map(async (id) => {
    const { data } = await supabase.rpc('atelier_suggested_pair_price' as never, {
      p_contractor_id: id,
      p_sector: card.sector,
      p_sheet_id: card.sheetId,
    } as never);
    const payload = data as unknown as Array<{ price?: number }> | null;
    const row = Array.isArray(payload) ? payload[0] : null;
    if (row?.price) prices[id] = money(Number(row.price));
  }));
  return prices;
}

export const CORTE_PREVIEW_CARD: CutQueueCard = {
  jobId: 'preview',
  orderNumber: 'PV-00180',
  clientName: 'Loja Centro',
  billingWeek: '2026-W30',
  referenceCode: 'SR01',
  referenceName: 'Sandália',
  imageUrl: null,
  images: null,
  variantImageUrl: null,
  pretoImageUrl: null,
  photoUrl: '/favicon.jpg',
  itemGrade: { '34': 20, '35': 40, '39': 80, '40': 160 },
  sheetId: null,
  color: 'PRETO',
  sector: 'costura_cabedal',
  sectorLabel: 'Costura de cabedal',
  totalPairs: 300,
  cutPairs: 150,
  remainingPairs: 150,
  preferredContractorId: 'a',
  lastContractorIds: ['a', 'b'],
  ranges: [
    { label: 'P', sizes: ['34', '35'], cap: 30, mode: 'range' },
    { label: 'G', sizes: ['39', '40'], cap: 120, mode: 'range' },
  ],
  blockReason: null,
  inQueue: true,
  history: [{
    id: 'h1',
    at: '2026-11-21T14:00:00.000Z',
    totalPairs: 150,
    ranges: [{ label: 'P', pairs: 30 }, { label: 'G', pairs: 120 }],
    orders: [
      { id: '1', number: 'OS-100', contractorId: 'a', contractorName: 'Ateliê Ana', quantity: 50, grade: { P: 10, G: 40 } },
      { id: '2', number: 'OS-101', contractorId: 'b', contractorName: 'Ateliê Bia', quantity: 100, grade: { P: 20, G: 80 } },
    ],
  }],
};

export const CORTE_PREVIEW_PEOPLE: CutContractorOption[] = [
  { id: 'a', name: 'Ateliê Ana', phone: '21 99999-0001', address: 'Rua A, 10', city: 'Nova Iguaçu', state: 'RJ', preferred: true },
  { id: 'b', name: 'Ateliê Bia', phone: '21 99999-0002', address: 'Rua B, 20', city: 'Nilópolis', state: 'RJ', preferred: false },
  { id: 'c', name: 'Ateliê Caio', phone: '21 99999-0003', address: 'Rua C, 30', city: 'Mesquita', state: 'RJ', preferred: false },
];

export function cutPhotoFor(input: {
  variantImageUrl?: string | null;
  pretoImageUrl?: string | null;
  images?: unknown;
  imageUrl?: string | null;
}): string {
  return resolveCutPhoto(input);
}
