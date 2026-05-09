// WaveBuilder: 2-step dialog.
// Step 1 — select pending orders for the week.
// Step 2 — review calculated timeline + material needs, then create wave.
import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import {
  CalendarDays, Package, AlertTriangle, Users, ChevronDown, ChevronRight,
  CheckCircle, XCircle, Clock, ShoppingBag, ArrowRight, Scissors, Loader2, Wrench, Search,
  Hand, Printer, Flame, Hammer, Footprints, Sparkles, Truck,
} from 'lucide-react';
import { snapToMonday } from '@/lib/isoWeek';
import { useCreateWave } from '@/hooks/useProductionWaves';
import {
  listPendingSaleOrdersForWeek,
  findActiveWaveConflicts,
} from '@/services/productionWavesService';
import {
  computeWaveTimeline, getWaveMaterialNeeds,
  createWaveWithMaterialOrders, autoCreateArtisanalServiceOrders,
  WaveTimeline, WaveMaterialNeed, ArtisanalOsNeed,
} from '@/services/waveTimelineService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
  const stages = [
    { label: 'Compra',         date: tl.purchase_deadline,           icon: ShoppingBag, className: 'text-orange-600 bg-orange-500/10 border-orange-500/20' },
    { label: 'Mat. chega',     date: tl.material_ready_date,         icon: Package,     className: 'text-blue-600 bg-blue-500/10 border-blue-500/20' },
    { label: 'Corte Palmilha', date: tl.corte_palmilha_start_date,   icon: Scissors,    className: 'text-violet-600 bg-violet-500/10 border-violet-500/20' },
    { label: 'Corte Forração', date: tl.corte_forracao_start_date,   icon: Wrench,      className: 'text-indigo-600 bg-indigo-500/10 border-indigo-500/20' },
    tl.mesa_start_date      ? { label: 'Mesa',      date: tl.mesa_start_date,      icon: Hand,      className: 'text-rose-600 bg-rose-500/10 border-rose-500/20' }      : null,
    tl.silk_start_date      ? { label: 'Silk',      date: tl.silk_start_date,      icon: Printer,   className: 'text-cyan-600 bg-cyan-500/10 border-cyan-500/20' }      : null,
    tl.colagem_start_date   ? { label: 'Colagem',   date: tl.colagem_start_date,   icon: Flame,     className: 'text-orange-600 bg-orange-500/10 border-orange-500/20' } : null,
    { label: 'Montagem',       date: tl.montagem_start_date,         icon: Hammer,      className: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' },
    tl.solagem_start_date   ? { label: 'Solagem',   date: tl.solagem_start_date,   icon: Footprints,className: 'text-amber-600 bg-amber-500/10 border-amber-500/20' }  : null,
    { label: 'Acabamento',     date: tl.acabamento_start_date,       icon: Sparkles,    className: 'text-indigo-600 bg-indigo-500/10 border-indigo-500/20' },
    tl.pickup_tuesday_date  ? { label: 'Pickup Ter',  date: tl.pickup_tuesday_date,  icon: Truck,      className: 'text-blue-600 bg-blue-500/10 border-blue-500/20' }    : null,
    tl.pickup_friday_date   ? { label: 'Pickup Sex',  date: tl.pickup_friday_date,   icon: Truck,      className: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' } : null,
    { label: 'Entrega',        date: tl.earliest_deadline,           icon: CalendarDays,className: 'text-green-600 bg-green-500/10 border-green-500/20' },
  ].filter(Boolean) as { label: string; date: string; icon: React.ElementType; className: string }[];

  const today = new Date().toISOString().slice(0, 10);

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

      {/* Artisanal rows */}
      {artisanal.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 overflow-hidden">
          <div className="px-3 py-1.5 bg-amber-500/5 text-xs font-medium text-amber-600">Materiais artesanais — exigem OS ao terceirizado</div>
          <div className="divide-y divide-border/50">
            {artisanal.map(n => (
              <div key={n.product_id + n.color} className="px-3 py-2 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-medium">{n.product_name}</span>
                    {n.color && <span className="text-muted-foreground">· {n.color}</span>}
                    {n.shortage > 0
                      ? <Badge variant="outline" className="text-[10px] py-0 bg-red-500/10 text-red-600 border-red-500/20">Falta {n.shortage.toFixed(2)} {n.unit}</Badge>
                      : <Badge variant="outline" className="text-[10px] py-0 bg-green-500/10 text-green-600 border-green-500/20">Em estoque</Badge>
                    }
                  </div>
                  {n.os_send_date && (
                    <Badge variant="outline" className={cn('text-[10px] gap-1 shrink-0', new Date(n.os_send_date + 'T00:00:00') < new Date() ? 'bg-red-500/10 text-red-600 border-red-500/20' : 'bg-amber-500/10 text-amber-600 border-amber-500/20')}>
                      <Clock className="h-2.5 w-2.5" /> OS até {fmtDateLong(n.os_send_date)}
                    </Badge>
                  )}
                </div>
                {n.base_product_name && (
                  <div className="text-muted-foreground pl-2 border-l border-border/50">
                    MP base: <span className="font-medium">{n.base_product_name}</span>
                    {n.base_needed_qty != null && <span> — necessário {n.base_needed_qty.toFixed(3)} m</span>}
                    {n.base_stock_qty != null && <span> / estoque {n.base_stock_qty.toFixed(3)} m</span>}
                    {(n.base_shortage ?? 0) > 0
                      ? <span className="text-red-600 font-medium"> · Falta {n.base_shortage!.toFixed(3)} m (OC gerada)</span>
                      : <span className="text-green-600"> · OK</span>
                    }
                  </div>
                )}
              </div>
            ))}
          </div>
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

  const createWave = useCreateWave();

  useEffect(() => {
    if (!open) { setStep('select'); setTimeline(null); setMaterialNeeds([]); return; }
    setLoading(true);
    setSelected(new Set());
    setConflictIds(new Set());
    listPendingSaleOrdersForWeek(weekStart)
      .then(setPendingOrders)
      .finally(() => setLoading(false));
  }, [open, weekStart]);

  const searchTokens = useMemo(
    () => search.split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean),
    [search],
  );

  function orderMatchesSearch(o: PendingOrder): boolean {
    if (searchTokens.length === 0) return true;
    const cnpjDigits = (o.cnpj ?? '').replace(/\D/g, '');
    const textFields = [
      (o.client_name ?? '').toLowerCase(),
      (o.code ?? '').toLowerCase(),
      ...o.op_numbers.map(n => n.toLowerCase()),
    ];
    return searchTokens.every(token => {
      const tokenDigits = token.replace(/\D/g, '');
      if (tokenDigits.length >= 3 && cnpjDigits.includes(tokenDigits)) return true;
      return textFields.some(f => f.includes(token));
    });
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
  }, [pendingOrders, selected, conflictIds, searchTokens]);

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
      const result = await createWaveWithMaterialOrders({ weekStart, saleOrderIds: ids, waveId, generatePOs });

      // Always auto-create artisanal service orders assigned to "nego"
      const osCreated = await autoCreateArtisanalServiceOrders(result.artisanalOsNeeds);

      const parts: string[] = ['Onda criada!'];
      if (generatePOs && result.posCreated > 0) parts.push(`${result.posCreated} OC(s) gerada(s).`);
      if (osCreated > 0) parts.push(`${osCreated} OS(s) artesanal(is) gerada(s) para "nego".`);
      toast.success(parts.join(' '));

      onCreated?.(waveId);
      onOpenChange(false);
      setSelected(new Set());
      setStep('select');
    } catch (err: any) {
      // Surface the real error — could be from useCreateWave, createWaveWithMaterialOrders,
      // or autoCreateArtisanalServiceOrders (which throws when "nego" contractor is missing).
      // Invalidate queries so any partial results (wave + POs without artisanal OS) are visible.
      toast.error(`Erro ao criar onda: ${err?.message || 'desconhecido'}`);
    } finally {
      setCreating(false);
    }
  }

  const selectableCount = pendingOrders.filter(o => !conflictIds.has(o.id)).length;
  const totalPairs = pendingOrders.filter(o => selected.has(o.id)).reduce((s, o) => s + o.total_pairs, 0);
  const hasShortages = materialNeeds.some(n => n.shortage > 0 || (n.base_shortage ?? 0) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            {step === 'select' ? 'Criar onda de produção semanal' : 'Revisão de materiais e cronograma'}
          </DialogTitle>
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
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Buscar por razão social, CNPJ, nº pedido, OP… (separe por espaço ou vírgula)"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-9 pl-8 text-sm"
              />
            </div>

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
                              checked={group.allSelected}
                              data-state={group.someSelected && !group.allSelected ? 'indeterminate' : undefined}
                              disabled={group.orders.every(o => conflictIds.has(o.id))}
                              onCheckedChange={() => toggleClient(group)}
                            />
                          </div>
                          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-semibold text-sm flex-1 truncate">{group.client}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {group.hasConflict && <Badge variant="destructive" className="text-[10px] gap-1 py-0"><AlertTriangle className="h-2.5 w-2.5" />Conflito</Badge>}
                            <Badge variant="secondary" className="text-[10px] py-0">{group.orders.length} ped.</Badge>
                            <Badge variant="outline" className="text-[10px] py-0 font-mono">{group.totalPairs} pares</Badge>
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
                                        <Badge variant="outline" className={cn('text-[10px] font-mono py-0',
                                          o.delivery_deadline < new Date().toISOString().slice(0, 10) ? 'border-destructive/50 text-destructive' : '')}>
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
              <Button variant="outline" onClick={() => handleCreate(false)} disabled={creating || previewLoading}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Criar onda
              </Button>
              {hasShortages && (
                <Button onClick={() => handleCreate(true)} disabled={creating || previewLoading}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShoppingBag className="h-4 w-4 mr-2" />}
                  Criar onda + Gerar OCs
                </Button>
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
    </Dialog>
  );
}
