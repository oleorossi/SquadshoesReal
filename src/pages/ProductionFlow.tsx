/**
 * Production Flow — "Onde está cada ordem": MATRIZ DE STATUS POR SETOR.
 *
 * Por que matriz (e não kanban de 1 card): o fluxo calçadista é CONVERGENTE —
 * cabedal, palmilha, aviamentos e silk são preparados EM PARALELO e só se casam
 * na montagem. No banco, 46/60 OPs ativas têm as 10 etapas abertas ao mesmo
 * tempo; a ordem dos setores no roteiro nem é consistente entre fichas. Logo a
 * OP NÃO está "num setor" — está em vários. O padrão da indústria (shop-floor
 * control / MES apparel: Aptean Exenta, Prodio, Kontrollis) é rastrear por
 * OPERAÇÃO com % de conclusão, e apontar POR SETOR. É o que esta tela faz:
 *   - linha = OP; coluna = setor; célula = status (✓ concluído / ● em andamento /
 *     ○ pendente / – não passa).
 *   - clicar numa célula abre o apontamento DAQUELE setor (SectorStageDialog →
 *     mutation guardada + guard de pré-requisito + trigger de timestamp).
 *   - clicar na identidade da OP abre o resumo (foto/ref/cliente/pedido/faturamento).
 * Sem "avançar linear" (que era conceitualmente errado pra fluxo paralelo).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useOrders } from '@/hooks/useOrders';
import { useAllOrderStages, type OrderStage } from '@/hooks/useOrderStages';
import SectorStageDialog from '@/components/orders/SectorStageDialog';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SignedImage } from '@/components/ui/signed-image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { normalizeForSearch } from '@/lib/searchUtils';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Package, Image as ImageIcon, Buildings, Receipt, CalendarBlank, MagnifyingGlass as Search,
  Check, CircleNotch as Loader2, Circle, Minus,
} from '@phosphor-icons/react';

// Setores do fluxo, na ordem de exibição. `phase` só agrupa visualmente:
// preparação (paralela) → montagem (convergência) → final.
const SECTORS: { name: string; label: string; short: string; phase: 1 | 2 | 3 }[] = [
  { name: 'Corte Palmilha', label: 'Corte Palmilha', short: 'C.Palm', phase: 1 },
  { name: 'Corte Forração', label: 'Corte Forração', short: 'C.Forr', phase: 1 },
  { name: 'Costura',        label: 'Costura',        short: 'Cost',   phase: 1 },
  { name: 'Aviamento',      label: 'Aviamento',      short: 'Aviam',  phase: 1 },
  { name: 'Silk',           label: 'Silk',           short: 'Silk',   phase: 1 },
  { name: 'Colagem',        label: 'Colagem',        short: 'Colag',  phase: 2 },
  { name: 'Montagem',       label: 'Montagem',       short: 'Mont',   phase: 2 },
  { name: 'Solagem',        label: 'Solagem',        short: 'Solag',  phase: 2 },
  { name: 'Acabamento',     label: 'Acabamento',     short: 'Acab',   phase: 3 },
  { name: 'Expedição',      label: 'Expedição',      short: 'Exped',  phase: 3 },
];
const ACTIVE_STATUS = new Set(['reservado', 'em produção', 'em producao', 'em_producao', 'producao']);

/** índice do setor (coluna) pro stage_name; 'Mesa' (legado) = 'Aviamento'. */
function sectorIndexOf(stageName: string): number {
  const n = stageName === 'Mesa' ? 'Aviamento' : stageName;
  return SECTORS.findIndex(s => s.name === n);
}
const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'dd/MM/yyyy', { locale: ptBR }); } catch { return iso; }
};

interface FlowRow {
  id: string;
  op: string;
  ref: string;
  code: string | null;
  color: string | null;
  pairs: number;
  client: string;
  pv: string | null;
  deadline: string | null;
  late: boolean;
  prog: number;
  bySector: Map<number, OrderStage>;
}

export default function ProductionFlow({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: orders = [] } = useOrders();
  const [search, setSearch] = useState('');
  const [apontStage, setApontStage] = useState<{ stage: OrderStage; op: string } | null>(null);
  const [summary, setSummary] = useState<FlowRow | null>(null);

  const activeOrders = useMemo(
    () => (orders as any[]).filter(o => ACTIVE_STATUS.has(String(o.status || '').toLowerCase().trim())),
    [orders],
  );
  const orderIds = useMemo(() => activeOrders.map(o => o.id), [activeOrders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);

  // PVs das OPs ativas → cliente + nº do pedido + data de faturamento.
  const soIds = useMemo(
    () => Array.from(new Set(activeOrders.map(o => o.sale_order_id).filter(Boolean))) as string[],
    [activeOrders],
  );
  const { data: soMap } = useQuery({
    queryKey: ['flow-sale-orders', soIds.slice().sort().join(',')],
    enabled: soIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, order_number, client_name, delivery_deadline')
        .in('id', soIds);
      if (error) throw error;
      const m = new Map<string, any>();
      (data || []).forEach((s: any) => m.set(s.id, s));
      return m;
    },
  });

  const stagesByOrder = useMemo(() => {
    const m = new Map<string, OrderStage[]>();
    for (const s of allStages) {
      const arr = m.get(s.order_id);
      if (arr) arr.push(s); else m.set(s.order_id, [s]);
    }
    return m;
  }, [allStages]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const rows = useMemo<FlowRow[]>(() => {
    const out: FlowRow[] = [];
    for (const o of activeOrders) {
      const stages = stagesByOrder.get(o.id) || [];
      const bySector = new Map<number, OrderStage>();
      for (const s of stages) {
        const k = sectorIndexOf(s.stage_name);
        if (k >= 0 && !bySector.has(k)) bySector.set(k, s);
      }
      const inFlow = Array.from(bySector.values());
      if (inFlow.length === 0) continue;
      const done = inFlow.filter(s => s.status === 'concluido').length;
      if (done === inFlow.length) continue; // tudo concluído → não está mais em produção
      const prog = Math.round((done / inFlow.length) * 100);
      const so = o.sale_order_id ? soMap?.get(o.sale_order_id) : null;
      const deadline = so?.delivery_deadline || o.planned_delivery || null;
      out.push({
        id: o.id,
        op: o.order_number || o.id.slice(0, 8),
        ref: o.technical_sheets?.name || '—',
        code: o.technical_sheets?.code ?? null,
        color: o.color ?? null,
        pairs: Number(o.quantity) || 0,
        client: so?.client_name || '—',
        pv: so?.order_number ?? null,
        deadline,
        late: !!deadline && new Date(deadline + 'T00:00:00') < today && prog < 100,
        prog,
        bySector,
      });
    }
    // Urgência: atrasadas primeiro, depois por prazo (mais cedo primeiro, sem prazo no fim).
    return out.sort((a, b) => {
      if (a.late !== b.late) return a.late ? -1 : 1;
      const da = a.deadline || '9999', db = b.deadline || '9999';
      return da < db ? -1 : da > db ? 1 : a.op.localeCompare(b.op);
    });
  }, [activeOrders, stagesByOrder, soMap, today]);

  const filteredRows = useMemo(() => {
    const q = normalizeForSearch(search);
    if (!q) return rows;
    return rows.filter(r => normalizeForSearch([r.op, r.ref, r.code, r.color, r.client, r.pv].filter(Boolean).join(' ')).includes(q));
  }, [rows, search]);

  // WIP por setor (cabeçalho de coluna): em andamento + pendente entre as OPs visíveis.
  const sectorWip = useMemo(() => SECTORS.map((_, i) => {
    let andamento = 0, aberto = 0;
    for (const r of filteredRows) {
      const st = r.bySector.get(i);
      if (!st || st.status === 'concluido') continue;
      aberto++;
      if (st.status === 'em_andamento') andamento++;
    }
    return { andamento, aberto };
  }), [filteredRows]);

  const lateCount = filteredRows.filter(r => r.late).length;

  // Resumo (foto etc.) — carregado sob demanda ao abrir.
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['flow-op-detail', summary?.id],
    enabled: !!summary?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, color, grade, technical_sheets:reference_id(name, code, image_url, images, reference_color_variants(color, image_url))')
        .eq('id', summary!.id).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
  const detailPhoto = useMemo(() => {
    const ts = detail?.technical_sheets;
    if (!ts) return null;
    const variants: any[] = ts.reference_color_variants || [];
    const c = String(detail?.color || '').toLowerCase().trim();
    const variant = variants.find(v => String(v.color || '').toLowerCase().trim() === c && v.image_url);
    const imagesArr: string[] = Array.isArray(ts.images) ? ts.images.filter(Boolean) : [];
    return variant?.image_url || imagesArr[0] || ts.image_url || null;
  }, [detail]);
  const activeGrade: Record<string, number> = (detail?.grade as any) || {};
  const gradeSizes = Object.keys(activeGrade).filter(k => Number(activeGrade[k]) > 0)
    .sort((a, b) => { const na = parseFloat(a), nb = parseFloat(b); return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb; });

  return (
    <div className="space-y-4 page-enter">
      {!embedded && (
        <EditorialPageHeader
          sectionLabel="PRODUÇÃO · FLUXO"
          title="Onde está cada ordem"
          description="Cada OP aparece em TODOS os seus setores ao mesmo tempo (a preparação roda em paralelo). Clique numa célula pra apontar aquele setor; clique na OP pra ver o resumo. Vermelho = atraso."
        />
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input className="pl-8 h-9" placeholder="Buscar OP, referência, cliente, PV…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-bold text-foreground tabular-nums">{filteredRows.length}</span> OPs em produção
          {lateCount > 0 && <span className="ml-2 text-destructive">· {lateCount} atrasada{lateCount === 1 ? '' : 's'}</span>}
        </div>
        {/* Legenda */}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-success" weight="bold" />concluído</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />em andamento</span>
          <span className="inline-flex items-center gap-1"><Circle className="h-3 w-3 text-muted-foreground/50" />pendente</span>
          <span className="inline-flex items-center gap-1"><Minus className="h-3.5 w-3.5 text-muted-foreground/40" />não passa</span>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/40">
                <th className="sticky left-0 z-20 bg-muted/40 text-left p-2 min-w-[220px] border-b border-border">
                  <span className="section-label">OP · Referência</span>
                </th>
                {SECTORS.map((s, i) => (
                  <th
                    key={s.name}
                    className={`p-1.5 text-center border-b border-border align-bottom ${i > 0 && SECTORS[i - 1].phase !== s.phase ? 'border-l-2 border-l-border' : ''}`}
                    title={s.label}
                  >
                    <div className="font-bold text-[10px] uppercase tracking-wide text-foreground whitespace-nowrap">{s.short}</div>
                    <div className="font-mono text-[9px] text-muted-foreground tabular-nums mt-0.5">
                      {sectorWip[i].andamento > 0 ? <span className="text-amber-600 dark:text-amber-400">{sectorWip[i].andamento}▸</span> : null}
                      {sectorWip[i].aberto > 0 ? <span className={sectorWip[i].andamento > 0 ? 'ml-1' : ''}>{sectorWip[i].aberto}</span> : <span className="text-muted-foreground/40">0</span>}
                    </div>
                  </th>
                ))}
                <th className="p-1.5 text-center border-b border-border border-l-2 border-l-border"><span className="section-label">%</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={SECTORS.length + 2} className="p-0">
                    <EmptyState
                      icon={Package}
                      title={search ? 'Nenhuma OP encontrada' : 'Nenhuma OP em produção'}
                      description={search ? 'Ajuste a busca por OP, referência, cliente ou PV.' : 'Quando houver ordens reservadas ou em produção, elas aparecerão aqui.'}
                      size="sm"
                    />
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20">
                    {/* Identidade da OP (sticky) — clique abre o resumo */}
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-card hover:bg-muted/30 text-left p-2 cursor-pointer transition-colors"
                      onClick={() => setSummary(r)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Resumo da OP ${r.op}, ${r.ref}`}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSummary(r); } }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold">{r.op}</span>
                        {r.late && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" title="Atrasada" />}
                      </div>
                      <div className="font-medium text-foreground truncate max-w-[200px]">{r.ref}{r.color ? <span className="text-muted-foreground font-normal"> · {r.color}</span> : null}</div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                        {r.client} · <span className="tabular-nums">{r.pairs}p</span>{r.deadline ? <> · {fmtDate(r.deadline)}</> : null}
                      </div>
                    </th>
                    {/* Células por setor */}
                    {SECTORS.map((s, i) => {
                      const st = r.bySector.get(i);
                      const divider = i > 0 && SECTORS[i - 1].phase !== s.phase ? 'border-l-2 border-l-border' : '';
                      if (!st) {
                        return <td key={s.name} className={`text-center text-muted-foreground/30 ${divider}`} aria-label={`${s.label}: não passa`}>–</td>;
                      }
                      const isDone = st.status === 'concluido';
                      const isProg = st.status === 'em_andamento';
                      const stLabel = isDone ? 'concluído' : isProg ? 'em andamento' : 'pendente';
                      return (
                        <td key={s.name} className={`p-0.5 text-center ${divider}`}>
                          <button
                            type="button"
                            onClick={() => setApontStage({ stage: st, op: r.op })}
                            aria-label={`OP ${r.op} · ${s.label}: ${stLabel}. Clique para apontar.`}
                            className={`w-full h-8 inline-flex items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring
                              ${isDone ? 'bg-success/15 text-success hover:bg-success/25'
                                : isProg ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/40 hover:bg-amber-500/25'
                                : 'text-muted-foreground/50 hover:bg-muted/60 hover:text-foreground'}`}
                          >
                            {isDone ? <Check className="h-4 w-4" weight="bold" /> : isProg ? <span className="h-2.5 w-2.5 rounded-full bg-current" /> : <Circle className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                      );
                    })}
                    {/* Progresso */}
                    <td className="p-1.5 text-center border-l-2 border-l-border min-w-[64px]">
                      <div className="h-1.5 bg-border rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${r.prog}%`, background: r.late ? 'hsl(var(--primary))' : 'hsl(var(--success))' }} />
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{r.prog}%</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        ▸ no cabeçalho = OPs com o setor <strong>em andamento</strong>; o outro número = total <strong>aberto</strong> naquele setor.
        Os setores de <strong>preparação</strong> (até a 1ª divisória) rodam em paralelo e convergem na <strong>Montagem</strong> — por isso a OP aparece em vários ao mesmo tempo.
      </p>

      {/* Apontamento de UM setor (per-work-center) — reusa o diálogo guardado */}
      {apontStage && (
        <SectorStageDialog
          stage={apontStage.stage}
          open={!!apontStage}
          onOpenChange={(v) => { if (!v) setApontStage(null); }}
          orderNumber={apontStage.op}
        />
      )}

      {/* Resumo da OP — modal centralizado */}
      <Dialog open={!!summary} onOpenChange={(v) => { if (!v) setSummary(null); }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          {summary && (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="font-mono text-base">{summary.op}</DialogTitle>
                <DialogDescription>Resumo da ordem de produção.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-[190px_1fr]">
                <div className="rounded-lg border border-border bg-muted/30 overflow-hidden aspect-square flex items-center justify-center">
                  {detailLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : detailPhoto ? (
                    <SignedImage src={detailPhoto} alt={`Foto da referência ${summary.ref}`} fit="contain" loading="lazy" className="w-full h-full" />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-muted-foreground/50">
                      <ImageIcon className="h-8 w-8" /><span className="text-xs">Sem foto da referência</span>
                    </div>
                  )}
                </div>
                <dl className="space-y-3 text-sm min-w-0">
                  <Field icon={Package} label="Referência">
                    <span className="font-semibold text-foreground">{summary.ref}</span>
                    {summary.code && <span className="ml-2 font-mono text-xs text-muted-foreground">{summary.code}</span>}
                    {summary.color && <div className="text-xs text-muted-foreground mt-0.5">Cor: <span className="font-medium text-foreground">{summary.color}</span></div>}
                  </Field>
                  <Field icon={Buildings} label="Cliente"><span className="font-medium text-foreground">{summary.client}</span></Field>
                  <Field icon={Receipt} label="Pedido"><span className="font-mono font-medium text-foreground">{summary.pv || '—'}</span></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field icon={Package} label="Quantidade">
                      <span className="display text-xl tabular-nums text-foreground">{summary.pairs.toLocaleString('pt-BR')}</span>
                      <span className="ml-1 text-xs text-muted-foreground">pares</span>
                    </Field>
                    <Field icon={CalendarBlank} label="Faturamento">
                      <span className="font-medium text-foreground tabular-nums">{fmtDate(summary.deadline)}</span>
                    </Field>
                  </div>
                </dl>
              </div>
              {gradeSizes.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Grade (numeração)</div>
                  <div className="flex flex-wrap gap-1">
                    {gradeSizes.map((sz) => (
                      <span key={sz} className="inline-flex flex-col items-center rounded-md border border-border bg-muted/40 px-2 py-1 leading-none">
                        <span className="text-[10px] font-mono text-muted-foreground">{sz}</span>
                        <span className="text-sm font-bold tabular-nums text-foreground">{activeGrade[sz]}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                Para apontar (iniciar/concluir) um setor desta OP, clique na célula correspondente no quadro.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground mb-0.5">
        <Icon className="h-3.5 w-3.5" /> {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
