// WaveBuilder: 2-step dialog.
// Step 1 — select pending orders for the week.
// Step 2 — review calculated timeline + material needs, then create wave.
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { todayISO } from '@/lib/date';
import { CalendarBlank as CalendarDays, Package, Warning as AlertTriangle, Users, CaretDown as ChevronDown, CaretRight as ChevronRight, CheckCircle, XCircle, Clock, ShoppingBag, ArrowRight, Scissors, CircleNotch as Loader2, Wrench, MagnifyingGlass, Hand, Pen, Printer, Flame, Hammer, Footprints, Sparkle as Sparkles, Truck } from '@phosphor-icons/react';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { snapToMonday } from '@/lib/isoWeek';
import { useCreateWave } from '@/hooks/useProductionWaves';
import {
  listPendingSaleOrdersForWeek,
  findActiveWaveConflicts,
} from '@/services/productionWavesService';
import {
  computeWaveTimeline, getWaveMaterialNeeds,
  createWaveWithMaterialOrders,
  WaveTimeline, WaveMaterialNeed, ArtisanalOsNeed,
} from '@/services/waveTimelineService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { CapacityOverflowDialog } from '@/components/production/CapacityOverflowDialog';

function getMondayISO(d = new Date()): string {
  const copy = new Date(d);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day + (day === 0 ? -6 : 1));
  return copy.toISOString().slice(0, 10);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try { return format(new Date(iso + 'T00:00:00'), 'dd/MM', { locale: ptBR }); } catch { return '—'; }
}

function fmtDateLong(iso: string | null | undefined) {
  if (!iso) return '—';
  try { return format(new Date(iso + 'T00:00:00'), "dd 'de' MMM", { locale: ptBR }); } catch { return '—'; }
}

type PendingOrder = {
  id: string; code: string | null; client_name: string | null; cnpj: string | null;
  total_pairs: number; delivery_deadline: string | null; op_numbers: string[];
};
type ClientGroup = {
  client: string; orders: PendingOrder[]; totalPairs: number;
  hasConflict: boolean; allSelected: boolean; someSelected: boolean;
};

// ─── Step 2: Timeline panel ───────────────────────────────────────────────────

function TimelinePanel({ tl }: { tl: WaveTimeline }) {
  // Ordem canônica pós PR1-PR3: prep paralelo (Palmilha/Forração/Aviamento) →
  // Costura (PR 2) → Silk → Colagem → Montagem → Solagem → Acabamento → Entrega.
  // "Mesa" foi renomeado pra "Aviamento" mas a coluna do timeline ainda se
  // chama mesa_start_date (não vamos migrar a coluna agora).
  const stages = [
    { label: 'Compra',         date: tl.purchase_deadline,           icon: ShoppingBag, className: 'text-orange-600 bg-orange-500/10 border-orange-500/20' },
    { label: 'Material requerido até', date: tl.material_ready_date, icon: Package,     className: 'text-blue-600 bg-blue-500/10 border-blue-500/20' },
    { label: 'Corte Palmilha', date: tl.corte_palmilha_start_date,   icon: Scissors,    className: 'text-violet-600 bg-violet-500/10 border-violet-500/20' },
    { label: 'Corte Forração', date: tl.corte_forracao_start_date,   icon: Wrench,      className: 'text-indigo-600 bg-indigo-500/10 border-indigo-500/20' },
    tl.mesa_start_date      ? { label: 'Aviamento', date: tl.mesa_start_date,      icon: Hand,      className: 'text-rose-600 bg-rose-500/10 border-rose-500/20' }      : null,
    tl.costura_start_date   ? { label: 'Costura',   date: tl.costura_start_date,   icon: Pen,       className: 'text-pink-600 bg-pink-500/10 border-pink-500/20' }      : null,
    tl.silk_start_date      ? { label: 'Silk',      date: tl.silk_start_date,      icon: Printer,   className: 'text-cyan-600 bg-cyan-500/10 border-cyan-500/20' }      : null,
    tl.colagem_start_date   ? { label: 'Colagem',   date: tl.colagem_start_date,   icon: Flame,     className: 'text-orange-600 bg-orange-500/10 border-orange-500/20' } : null,
    { label: 'Montagem',       date: tl.montagem_start_date,         icon: Hammer,      className: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' },
    tl.solagem_start_date   ? { label: 'Solagem',   date: tl.solagem_start_date,   icon: Footprints,className: 'text-amber-600 bg-amber-500/10 border-amber-500/20' }  : null,
    { label: 'Acabamento',     date: tl.acabamento_start_date,       icon: Sparkles,    className: 'text-indigo-600 bg-indigo-500/10 border-indigo-500/20' },
    tl.pickup_tuesday_date  ? { label: 'Pickup Ter',  date: tl.pickup_tuesday_date,  icon: Truck,      className: 'text-blue-600 bg-blue-500/10 border-blue-500/20' }    : null,
    tl.pickup_friday_date   ? { label: 'Pickup Sex',  date: tl.pickup_friday_date,   icon: Truck,      className: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' } : null,
    { label: 'Entrega',        date: tl.earliest_deadline,           icon: CalendarDays,className: 'text-green-600 bg-green-500/10 border-green-500/20' },
  ].filter(Boolean) as { label: string; date: string; icon: React.ElementType; className: string }[];

  const today = todayISO();

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cronograma calculado</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {stages.map((s, i) => {
          const isLate = Boolean(s.date) && s.date < today;
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center gap-1">
              <Badge variant="outline" className={cn('gap-1.5 text-xs px-2 py-1', isLate ? 'bg-red-500/10 text-red-600 border-red-500/30' : s.className)}>
                <Icon className="h-3 w-3" />
                <span className="font-medium">{s.label}</span>
                <span className="font-mono">{fmtDate(s.date)}</span>
                {isLate && <AlertTriangle className="h-2.5 w-2.5" />}
              </Badge>
              {i < stages.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
            </div>
          );
        })}
      </div>
      {stages.some(s => Boolean(s.date) && s.date < today) && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Algumas datas já passaram — prazo apertado.
        </p>
      )}
    </div>
  );
}

// ─── Step 2: Material needs table ─────────────────────────────────────────────

function MaterialNeedsPanel({ needs, wavePurchaseDeadline }: {
  needs: WaveMaterialNeed[];
  wavePurchaseDeadline?: string | null;
}) {
  const shortages = needs.filter(n => n.shortage > 0 && !n.is_artisanal);
  const artisanal = needs.filter(n => n.is_artisanal);
  const ok = needs.filter(n => n.shortage === 0 && !n.is_artisanal);

  return (
    <div className="space-y-3">
      {/* Summary badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mr-1">Materiais</p>
        {ok.length > 0 && (
          <Badge variant="outline" className="gap-1 text-xs bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle className="h-3 w-3" /> {ok.length} em estoque
          </Badge>
        )}
        {shortages.length > 0 && (
          <Badge variant="outline" className="gap-1 text-xs bg-red-500/10 text-red-600 border-red-500/20">
            <XCircle className="h-3 w-3" /> {shortages.length} em falta
          </Badge>
        )}
        {artisanal.length > 0 && (
          <Badge variant="outline" className="gap-1 text-xs bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Wrench className="h-3 w-3" /> {artisanal.length} artesanais
          </Badge>
        )}
        {needs.length === 0 && (
          <span className="text-xs text-muted-foreground italic">Nenhum material identificado nas fichas técnicas.</span>
        )}
      </div>

      {/* Shortage rows */}
      {shortages.length > 0 && (
        <div className="rounded-lg border border-red-500/20 overflow-hidden">
          <div className="px-3 py-1.5 bg-red-500/5 text-xs font-medium text-red-600">Itens em falta — serão geradas OCs</div>
          <div className="divide-y divide-border/50">
            {shortages.map(n => (
              <div key={n.product_id + n.color} className="flex items-center gap-2 px-3 py-2 text-xs">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{n.product_name}</span>
                  {n.color && <span className="text-muted-foreground ml-1">· {n.color}</span>}
                  {n.supplier_name && <span className="text-muted-foreground ml-1">· {n.supplier_name}</span>}
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <div className="text-red-600 font-medium">Falta {n.shortage.toFixed(2)} {n.unit}</div>
                  <div className="text-muted-foreground">Estoque: {n.stock_qty.toFixed(2)} / Necessário: {n.needed_qty.toFixed(2)}</div>
                  {(n.purchase_deadline ?? wavePurchaseDeadline) && (
                    <div className={cn('font-mono', new Date((n.purchase_deadline ?? wavePurchaseDeadline)!) < new Date() ? 'text-red-600' : 'text-muted-foreground')}>
                      Comprar até {fmtDateLong(n.purchase_deadline ?? wavePurchaseDeadline)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* O RPC legado da onda não é fonte de identidade/quantidade de tira. */}
      {artisanal.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
          Este pedido contém tiras. Identidades, quantidades e faltas são exibidas somente no motor canônico.{' '}
          <Link className="font-semibold underline underline-offset-2" to="/tiras-artesanais?tab=demandas">
            Abrir Demandas de tiras
          </Link>
        </div>
      )}

      {/* OK materials (collapsed) */}
      {ok.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <CheckCircle className="inline h-3 w-3 text-green-500 mr-1" />
          {ok.map(n => n.product_name).join(', ')} — em estoque.
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WaveBuilder({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (waveId: string) => void;
}) {
  const [weekStart, setWeekStart] = useState(getMondayISO());
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Step 2 state
  const [step, setStep] = useState<'select' | 'preview'>('select');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [timeline, setTimeline] = useState<WaveTimeline | null>(null);
  const [materialNeeds, setMaterialNeeds] = useState<WaveMaterialNeed[]>([]);
  const [creating, setCreating] = useState(false);
  const [shortageOverrideConfirmed, setShortageOverrideConfirmed] = useState(false);
  // ── Capacity overflow / outsourcing dialog ──
  // Estado da onda recém-criada (waveId + orderIds) usado pelo
  // CapacityOverflowDialog. Mantemos waveId num ref pra chamar onCreated
  // depois que o operador escolher os transbordos.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowOrderIds, setOverflowOrderIds] = useState<string[]>([]);
  const [pendingWaveId, setPendingWaveId] = useState<string | null>(null);

  const createWave = useCreateWave();

  useEffect(() => {
    if (!open) { setStep('select'); setTimeline(null); setMaterialNeeds([]); setShortageOverrideConfirmed(false); return; }
    setLoading(true);
    setSelected(new Set());
    setConflictIds(new Set());
    listPendingSaleOrdersForWeek(weekStart)
      .then(setPendingOrders)
      .finally(() => setLoading(false));
  }, [open, weekStart]);

  function orderMatchesSearch(o: PendingOrder): boolean {
    return searchMatchesAllTerms(search, o.client_name, o.code, o.cnpj, ...o.op_numbers);
  }

  const clientGroups = useMemo((): ClientGroup[] => {
    const map = new Map<string, PendingOrder[]>();
    for (const o of pendingOrders) {
      const key = o.client_name ?? '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries())
      .map(([client, orders]) => {
        const matching = orders.filter(o => orderMatchesSearch(o));
        if (matching.length === 0) return null;
        const sel = matching.filter(o => !conflictIds.has(o.id));
        return {
          client, orders: matching,
          totalPairs: matching.reduce((s, o) => s + o.total_pairs, 0),
          hasConflict: matching.some(o => conflictIds.has(o.id)),
          allSelected: sel.length > 0 && sel.every(o => selected.has(o.id)),
          someSelected: sel.some(o => selected.has(o.id)),
        };
      })
      .filter((g): g is ClientGroup => g !== null)
      .sort((a, b) => {
        if (a.hasConflict !== b.hasConflict) return a.hasConflict ? -1 : 1;
        return a.client.localeCompare(b.client, 'pt-BR');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOrders, selected, conflictIds, search]);

  function toggleOrder(id: string) {
    if (conflictIds.has(id)) { toast.error('Este pedido já está em uma onda ativa.'); return; }
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleClient(group: ClientGroup) {
    const ids = group.orders.filter(o => !conflictIds.has(o.id)).map(o => o.id);
    setSelected(prev => {
      const n = new Set(prev);
      if (group.allSelected) ids.forEach(id => n.delete(id)); else ids.forEach(id => n.add(id));
      return n;
    });
  }
  function toggleCollapse(client: string) {
    setCollapsed(prev => { const n = new Set(prev); if (n.has(client)) n.delete(client); else n.add(client); return n; });
  }
  function selectAll() {
    const all = pendingOrders.filter(o => !conflictIds.has(o.id));
    setSelected(prev => prev.size === all.length ? new Set() : new Set(all.map(o => o.id)));
  }

  async function goToPreview() {
    const ids = Array.from(selected);
    // Re-check conflicts
    const conflicts = await findActiveWaveConflicts(ids);
    if (conflicts.length > 0) {
      const cSet = new Set(conflicts.map(c => c.sale_order_id));
      setConflictIds(prev => new Set([...prev, ...cSet]));
      setSelected(prev => { const n = new Set(prev); cSet.forEach(id => n.delete(id)); return n; });
      toast.error(`Pedido(s) em onda ativa removidos. Revise a seleção.`);
      return;
    }

    setShortageOverrideConfirmed(false);
    setPreviewLoading(true);
    setStep('preview');
    try {
      const [tl, needs] = await Promise.all([
        computeWaveTimeline(ids),
        getWaveMaterialNeeds(ids),
      ]);
      setTimeline(tl);
      setMaterialNeeds(needs);
    } catch (e: any) {
      toast.error(`Erro ao calcular materiais: ${e.message}`);
      setStep('select');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleCreate(generatePOs: boolean) {
    if (!selected.size || creating) return;
    if (hasShortages && !generatePOs && !shortageOverrideConfirmed) {
      toast.error('Confirme o override para criar a onda sem gerar as OCs dos materiais em falta.');
      return;
    }
    setCreating(true);
    try {
      // Ordena PVs por delivery_deadline ASC antes de criar a onda. A versão
      // anterior usava Array.from(selected) preservando ordem de clique do
      // usuário, o que fazia OPs com prazo mais distante serem processadas
      // antes de OPs com prazo apertado dentro da mesma onda. PVs sem
      // deadline ficam no final.
      const candidateMap = new Map(pendingOrders.map(o => [o.id, o.delivery_deadline]));
      const ids = Array.from(selected).sort((a, b) => {
        const da = candidateMap.get(a);
        const db = candidateMap.get(b);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db);
      });
      const waveId = await createWave.mutateAsync({ weekStart, saleOrderIds: ids });
      if (hasShortages && !generatePOs) {
        const { data: waveRow, error: waveReadErr } = await supabase
          .from('production_waves')
          .select('notes')
          .eq('id', waveId)
          .single();
        if (waveReadErr) throw waveReadErr;
        const overrideNote = `Override confirmado: onda criada com materiais em falta sem gerar OCs em ${new Date().toISOString()}.`;
        const { error: overrideErr } = await supabase
          .from('production_waves')
          .update({
            notes: [waveRow?.notes, overrideNote].filter(Boolean).join('\n'),
          })
          .eq('id', waveId);
        if (overrideErr) throw overrideErr;
      }
      const result = await createWaveWithMaterialOrders({ weekStart, saleOrderIds: ids, waveId, generatePOs });

      const parts: string[] = ['Onda criada!'];
      if (generatePOs && result.posCreated > 0) parts.push(`${result.posCreated} OC(s) gerada(s).`);
      if (result.artisanalOsNeeds.length > 0) parts.push('Tiras seguem na fila canônica do hub.');
      toast.success(parts.join(' '));

      // Captura os order_ids das OPs criadas/atualizadas pela onda — usado
      // pelo CapacityOverflowDialog pra detectar OPs em setor estourado e
      // permitir transbordo pra terceiros. Se não houver OPs ainda (race do
      // pipeline de geração), o dialog detecta vazio e fecha sozinho.
      const { data: newOrders } = await supabase
        .from('orders')
        .select('id')
        .in('sale_order_id', ids);
      const createdOrderIds = (newOrders || []).map((o: any) => o.id);

      // Abre dialog de transbordo. Quando fechar (com ou sem terceirização),
      // chama onCreated pra fechar o WaveBuilder e reset.
      if (createdOrderIds.length > 0) {
        setPendingWaveId(waveId);
        setOverflowOrderIds(createdOrderIds);
        setOverflowOpen(true);
        // Não fecha o WaveBuilder ainda — espera o dialog fechar primeiro
      } else {
        onCreated?.(waveId);
        onOpenChange(false);
        setSelected(new Set());
        setStep('select');
      }
    } catch (err: any) {
      // Surface the real error from wave/timeline or the general-material OC path.
      toast.error(`Erro ao criar onda: ${err?.message || 'desconhecido'}`);
    } finally {
      setCreating(false);
    }
  }

  const selectableCount = pendingOrders.filter(o => !conflictIds.has(o.id)).length;
  const matchCount = clientGroups.reduce((s, g) => s + g.orders.length, 0);
  const totalPairs = pendingOrders.filter(o => selected.has(o.id)).reduce((s, o) => s + o.total_pairs, 0);
  const hasShortages = materialNeeds.some(n => !n.is_artisanal && n.shortage > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            {step === 'select' ? 'Criar onda de produção semanal' : 'Revisão de materiais e cronograma'}
          </DialogTitle>
          <DialogDescription>
            Selecione os pedidos da semana e revise materiais/cronograma antes de criar a onda.
          </DialogDescription>
        </DialogHeader>

        {/* ── STEP 1: Order selection ─────────────────────────────────────── */}
        {step === 'select' && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Semana começando em (segunda-feira)</Label>
                <Input
                  type="date"
                  value={weekStart}
                  onChange={e => setWeekStart(snapToMonday(e.target.value))}
                  className="mt-1 h-9"
                />
              </div>
              <div className="flex items-end justify-between gap-2">
                <Button type="button" variant="outline" size="sm" disabled={loading || !selectableCount} onClick={selectAll}>
                  {selected.size === selectableCount && selectableCount > 0 ? 'Desmarcar todos' : 'Selecionar todos'}
                </Button>
                <div className="text-sm text-muted-foreground text-right">
                  <Package className="inline w-4 h-4 mr-1" />
                  <strong>{selected.size}</strong> ped. / <strong>{totalPairs}</strong> pares
                </div>
              </div>
            </div>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar por razão social, CNPJ, nº do pedido, OP…"
              resultCount={matchCount}
              totalCount={pendingOrders.length}
              inputClassName="h-9 text-sm"
            />

            {conflictIds.size > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">
                  <strong>{conflictIds.size} pedido(s) em conflito</strong> — já em onda ativa, removidos da seleção.
                </p>
              </div>
            )}

            <div className="border rounded-lg overflow-y-auto flex-1 min-h-0">
              {loading ? (
                <div className="p-3 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
              ) : pendingOrders.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground italic">Nenhum pedido pendente para a semana selecionada.</div>
              ) : clientGroups.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={MagnifyingGlass}
                  title={`Nenhum resultado para "${search}"`}
                  action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
                />
              ) : (
                <div className="divide-y">
                  {clientGroups.map(group => {
                    const isCollapsed = collapsed.has(group.client);
                    const Icon = isCollapsed ? ChevronRight : ChevronDown;
                    return (
                      <div key={group.client} className={cn(group.hasConflict && 'bg-destructive/3')}>
                        <div
                          className={cn('flex items-center gap-3 px-3 py-2 cursor-pointer select-none',
                            group.hasConflict ? 'bg-destructive/10 hover:bg-destructive/15' : 'bg-muted/40 hover:bg-muted/60')}
                          onClick={() => toggleCollapse(group.client)}
                        >
                          <div onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={group.allSelected ? true : group.someSelected ? 'indeterminate' : false}
                              disabled={group.orders.every(o => conflictIds.has(o.id))}
                              onCheckedChange={() => toggleClient(group)}
                            />
                          </div>
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-semibold text-sm flex-1 truncate">{group.client}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {group.hasConflict && <Badge variant="destructive" className="text-xs gap-1 py-0"><AlertTriangle className="h-2.5 w-2.5" />Conflito</Badge>}
                            <Badge variant="secondary" className="text-xs py-0">{group.orders.length} ped.</Badge>
                            <Badge variant="outline" className="text-xs py-0 font-mono">{group.totalPairs} pares</Badge>
                          </div>
                        </div>
                        {!isCollapsed && (
                          <table className="w-full text-sm">
                            <tbody className="divide-y divide-border/50">
                              {group.orders.map(o => {
                                const isConflict = conflictIds.has(o.id);
                                const isSelected = selected.has(o.id);
                                return (
                                  <tr key={o.id}
                                    className={cn('cursor-pointer transition-colors',
                                      isConflict ? 'bg-destructive/5 opacity-60' : isSelected ? 'bg-primary/5' : 'hover:bg-muted/30')}
                                    onClick={() => toggleOrder(o.id)}>
                                    <td className="w-10 px-4 py-2"><Checkbox checked={isSelected} disabled={isConflict} onCheckedChange={() => toggleOrder(o.id)} onClick={e => e.stopPropagation()} /></td>
                                    <td className="px-2 py-2 font-mono text-xs w-32">{o.code ?? o.id.slice(0, 8)}</td>
                                    <td className="px-2 py-2 flex-1">
                                      {isConflict && <span className="inline-flex items-center gap-1 text-xs text-destructive mr-2"><AlertTriangle className="w-3 h-3" />Em onda ativa</span>}
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                      {o.delivery_deadline && (
                                        <Badge variant="outline" className={cn('text-xs font-mono py-0',
                                          o.delivery_deadline < todayISO() ? 'border-destructive/50 text-destructive' : '')}>
                                          Entrega {fmtDate(o.delivery_deadline)}
                                        </Badge>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono tabular-nums">{o.total_pairs} pares</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 2: Timeline + material preview ────────────────────────── */}
        {step === 'preview' && (
          <div className="flex-1 overflow-y-auto space-y-4 min-h-0 pr-1">
            {previewLoading ? (
              <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Calculando cronograma e verificando materiais…</span>
              </div>
            ) : (
              <>
                <Card>
                  <CardContent className="pt-4 space-y-3">
                    {timeline
                      ? <TimelinePanel tl={timeline} />
                      : <p className="text-xs text-muted-foreground">Prazos de entrega não definidos — datas não calculadas. Configure <em>Data de Entrega</em> nos pedidos para ver o cronograma.</p>
                    }
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <MaterialNeedsPanel needs={materialNeeds} wavePurchaseDeadline={timeline?.purchase_deadline} />
                  </CardContent>
                </Card>
                {hasShortages && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 space-y-2">
                    <p className="text-sm font-medium text-destructive">
                      Há materiais em falta. Gere as OCs ou confirme explicitamente o override para criar a onda sem compra.
                    </p>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="wave-shortage-override"
                        checked={shortageOverrideConfirmed}
                        onCheckedChange={(checked) => setShortageOverrideConfirmed(checked === true)}
                      />
                      <Label htmlFor="wave-shortage-override" className="text-xs leading-5 cursor-pointer">
                        Confirmo que esta onda será criada com materiais em falta e sem gerar OCs. O override será registrado na onda.
                      </Label>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <DialogFooter className="gap-2">
          {step === 'select' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={goToPreview} disabled={!selected.size || loading}>
                Verificar materiais <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('select')} disabled={creating}>← Voltar</Button>
              {hasShortages && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => handleCreate(false)}
                    disabled={creating || previewLoading || !shortageOverrideConfirmed}
                  >
                    {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Criar onda sem OC
                  </Button>
                  <Button onClick={() => handleCreate(true)} disabled={creating || previewLoading}>
                    {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShoppingBag className="h-4 w-4 mr-2" />}
                    Criar onda + Gerar OCs
                  </Button>
                </>
              )}
              {!hasShortages && (
                <Button onClick={() => handleCreate(false)} disabled={creating || previewLoading}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  Criar onda (materiais OK)
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Capacity Overflow → outsourcing dialog. Abre automaticamente
          após criar onda quando há OPs em setor com utilização > 100%.
          Fecha o WaveBuilder quando o dialog fecha (com ou sem transbordo). */}
      <CapacityOverflowDialog
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        orderIds={overflowOrderIds}
        onComplete={() => {
          if (pendingWaveId) onCreated?.(pendingWaveId);
          setPendingWaveId(null);
          setOverflowOrderIds([]);
          onOpenChange(false);
          setSelected(new Set());
          setStep('select');
        }}
      />
    </Dialog>
  );
}
