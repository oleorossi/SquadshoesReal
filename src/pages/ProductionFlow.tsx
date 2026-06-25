/**
 * Production Flow — quadro kanban ARRASTÁVEL das OPs por setor.
 * "Onde está cada ordem": cada OP cai na coluna do seu setor atual; arrastar pra
 * outra coluna empurra a OP pelo fluxo. Clicar abre o resumo da OP.
 *
 * Dados REAIS de order_stages (não mais o mock/production_step legado). Arrastar
 * chama a RPC advance_order_to_sector (atômica): conclui o que vem antes do alvo
 * NO FLUXO e inicia o alvo, respeitando o guard de pré-requisito e carimbando
 * started_at/completed_at via trigger.
 *
 * ⚠ A ordem das colunas é o FLUXO real (topológico), não o stage_order — na base
 * Costura tem stage_order 3 mas depende de Aviamento (4).
 *
 * UX (skills frontend-design + ui-ux-pro-max, 2026-06-25): cards clicáveis e
 * teclável (role=button, Enter/Espaço, aria-label) com feedback de pressão; foto
 * da referência com aspect-ratio reservado (sem CLS) + lazy; tokens semânticos
 * (dark-mode safe); painel lateral (Sheet) que anima da origem com escape.
 */
import { useMemo, useRef, useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useOrders } from '@/hooks/useOrders';
import { useAllOrderStages, type OrderStage } from '@/hooks/useOrderStages';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { SignedImage } from '@/components/ui/signed-image';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  DotsSixVertical, Package, Image as ImageIcon, Buildings, Receipt, CalendarBlank, CircleNotch as Loader2,
} from '@phosphor-icons/react';

const FLOW: { name: string; label: string; colorVar: string }[] = [
  { name: 'Corte Palmilha', label: 'Corte Palmilha', colorVar: 'var(--stage-cut)' },
  { name: 'Corte Forração', label: 'Corte Forração', colorVar: 'var(--stage-cut)' },
  { name: 'Aviamento',      label: 'Aviamento',      colorVar: 'var(--stage-cut)' },
  { name: 'Costura',        label: 'Costura',        colorVar: 'var(--stage-sew)' },
  { name: 'Silk',           label: 'Silk',           colorVar: 'var(--stage-sew)' },
  { name: 'Colagem',        label: 'Colagem',        colorVar: 'var(--stage-assy)' },
  { name: 'Montagem',       label: 'Montagem',       colorVar: 'var(--stage-assy)' },
  { name: 'Solagem',        label: 'Solagem',        colorVar: 'var(--stage-fin)' },
  { name: 'Acabamento',     label: 'Acabamento',     colorVar: 'var(--stage-fin)' },
  { name: 'Expedição',      label: 'Expedição',      colorVar: 'var(--stage-pack)' },
];
const FLOW_NAMES = FLOW.map(f => f.name);
const ACTIVE_STATUS = new Set(['reservado', 'em produção', 'em producao', 'em_producao', 'producao']);

function flowIndex(stageName: string): number {
  const n = stageName === 'Mesa' ? 'Aviamento' : stageName;
  return FLOW_NAMES.indexOf(n);
}
const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try { return format(parseISO(iso), 'dd/MM/yyyy', { locale: ptBR }); } catch { return iso; }
};

interface FlowOp {
  id: string;
  order_number: string;
  modelo: string;
  color: string | null;
  pairs: number;
  col: number;
  prog: number;
  currentStatus: string;
  late: boolean;
}

export default function ProductionFlow() {
  const qc = useQueryClient();
  const { data: orders = [] } = useOrders();
  const [selected, setSelected] = useState<FlowOp | null>(null);
  const justDragged = useRef(false);

  const activeOrders = useMemo(
    () => (orders as any[]).filter(o => ACTIVE_STATUS.has(String(o.status || '').toLowerCase().trim())),
    [orders],
  );
  const orderIds = useMemo(() => activeOrders.map(o => o.id), [activeOrders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);

  const stagesByOrder = useMemo(() => {
    const m = new Map<string, OrderStage[]>();
    for (const s of allStages) {
      const arr = m.get(s.order_id);
      if (arr) arr.push(s); else m.set(s.order_id, [s]);
    }
    return m;
  }, [allStages]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const ops = useMemo<FlowOp[]>(() => {
    const out: FlowOp[] = [];
    for (const o of activeOrders) {
      const stages = stagesByOrder.get(o.id) || [];
      const inFlow = stages.filter(s => flowIndex(s.stage_name) >= 0);
      if (inFlow.length === 0) continue;
      const open = inFlow.filter(s => s.status !== 'concluido');
      if (open.length === 0) continue;
      const inProg = open.filter(s => s.status === 'em_andamento');
      const current = inProg.length
        ? inProg.reduce((a, b) => (flowIndex(b.stage_name) > flowIndex(a.stage_name) ? b : a))
        : open.reduce((a, b) => (flowIndex(b.stage_name) < flowIndex(a.stage_name) ? b : a));
      const done = inFlow.filter(s => s.status === 'concluido').length;
      const plannedDelivery = o.planned_delivery || null;
      out.push({
        id: o.id,
        order_number: o.order_number || o.id.slice(0, 8),
        modelo: o.technical_sheets?.name || '—',
        color: o.color ?? null,
        pairs: Number(o.quantity) || 0,
        col: flowIndex(current.stage_name),
        prog: inFlow.length > 0 ? Math.round((done / inFlow.length) * 100) : 0,
        currentStatus: current.status,
        late: !!plannedDelivery && new Date(plannedDelivery + 'T00:00:00') < today,
      });
    }
    return out;
  }, [activeOrders, stagesByOrder, today]);

  const advance = useMutation({
    mutationFn: async ({ orderId, target }: { orderId: string; target: string }) => {
      const operator = (() => { try { return localStorage.getItem('sector_operator_employee_id') || null; } catch { return null; } })();
      const { error } = await (supabase as any).rpc('advance_order_to_sector', { p_order_id: orderId, p_target: target, p_operator: operator });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('OP movida no fluxo');
    },
    onError: (e: any) => toast.error(e?.message || 'Não foi possível mover a OP'),
  });

  // Detalhe da OP (resumo) — carregado sob demanda ao clicar no card.
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['flow-op-detail', selected?.id],
    enabled: !!selected?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, quantity, color, grade, planned_delivery, sale_order_id, technical_sheets:reference_id(name, code, image_url, reference_color_variants(color, image_url)), sale_orders!sale_order_id(order_number, client_order_number, client_name, delivery_deadline)')
        .eq('id', selected!.id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const stageStats = useMemo(() =>
    FLOW.map((s, i) => {
      const colOps = ops.filter(o => o.col === i);
      return { ...s, count: colOps.length, pairs: colOps.reduce((a, o) => a + o.pairs, 0) };
    }), [ops]);

  // Foto da referência: variante na cor da OP, senão a foto mestra da ficha.
  const detailPhoto = useMemo(() => {
    const ts = detail?.technical_sheets;
    if (!ts) return null;
    const variants: any[] = ts.reference_color_variants || [];
    const c = String(detail?.color || '').toLowerCase().trim();
    const variant = variants.find(v => String(v.color || '').toLowerCase().trim() === c && v.image_url);
    return variant?.image_url || ts.image_url || null;
  }, [detail]);

  const openOp = (o: FlowOp) => { if (justDragged.current) return; setSelected(o); };

  const activeGrade: Record<string, number> = (detail?.grade as any) || {};
  const gradeSizes = Object.keys(activeGrade).filter(k => Number(activeGrade[k]) > 0)
    .sort((a, b) => { const na = parseFloat(a), nb = parseFloat(b); return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb; });

  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · FLUXO"
        title="Onde está cada ordem"
        description="Arraste a OP pra outra coluna pra empurrá-la pelo fluxo — conclui o que vem antes e inicia o setor de destino (respeitando o pré-requisito). Clique no card pra ver o resumo. Vermelho = atraso."
      />

      <StatGrid>
        {stageStats.slice(0, 6).map((s) => (
          <StatCard key={s.name} label={s.label} value={s.count.toLocaleString('pt-BR')} unit="OPs" hint={`${s.pairs.toLocaleString('pt-BR')} pares`} />
        ))}
      </StatGrid>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="eyebrow">Quadro de fluxo</div>
            <div className="display text-lg mt-1">{ops.length} ordens em produção</div>
          </div>
          {advance.isPending && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> movendo…</span>
          )}
        </div>

        <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <div className="flex gap-2.5 min-w-max">
            {FLOW.map((s, i) => {
              const colOps = ops.filter(o => o.col === i);
              return (
                <div
                  key={s.name}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/plain');
                    if (id) advance.mutate({ orderId: id, target: s.name });
                  }}
                  className="bg-muted/30 rounded-xl p-2.5 min-h-[480px] w-[212px] shrink-0 transition-colors"
                  style={{ borderTop: `2.5px solid ${s.colorVar}` }}
                >
                  <div className="flex items-center gap-2 pb-2 border-b border-border/70 mb-2.5">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.colorVar }} aria-hidden />
                    <div className="flex-1 min-w-0">
                      <div className="display text-sm tracking-[0.03em] truncate leading-tight">{s.label}</div>
                      <div className="font-mono text-[10px] text-muted-foreground tabular-nums">{String(i + 1).padStart(2, '0')} / {FLOW.length}</div>
                    </div>
                    <span className="font-mono text-xs font-bold text-muted-foreground tabular-nums">{colOps.length}</span>
                  </div>

                  {colOps.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground/50 italic py-8">Nenhuma OP nesta etapa</div>
                  ) : (
                    <div className="space-y-1.5">
                      {colOps.map((o) => (
                        <div
                          key={o.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`OP ${o.order_number}, ${o.modelo}, ${o.pairs} pares${o.late ? ', atrasada' : ''}. Clique para ver o resumo.`}
                          draggable
                          onDragStart={(e) => { justDragged.current = true; e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; }}
                          onDragEnd={() => { setTimeout(() => { justDragged.current = false; }, 60); }}
                          onClick={() => openOp(o)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(o); } }}
                          className="group bg-card rounded-lg p-2.5 relative overflow-hidden cursor-pointer outline-none transition-all duration-150
                                     border hover:border-foreground/30 hover:shadow-sm active:scale-[0.98]
                                     focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                          style={{ borderColor: o.late ? 'hsl(var(--primary))' : 'hsl(var(--border))' }}
                        >
                          {o.late && (
                            <div className="absolute top-0 right-0" style={{ width: 0, height: 0, borderLeft: '14px solid transparent', borderTop: '14px solid hsl(var(--primary))' }} aria-hidden />
                          )}
                          <div className="flex justify-between items-center gap-1">
                            <span className="font-mono text-xs text-muted-foreground inline-flex items-center gap-1 min-w-0">
                              <DotsSixVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground/70 transition-colors" weight="bold" />
                              <span className="truncate">{o.order_number}</span>
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[9px] px-1 py-0 shrink-0 ${o.currentStatus === 'em_andamento' ? 'border-amber-500/40 text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
                            >
                              {o.currentStatus === 'em_andamento' ? 'em and.' : 'pend.'}
                            </Badge>
                          </div>
                          <div className="text-[12.5px] font-semibold mt-1 leading-tight truncate">{o.modelo}</div>
                          {o.color && <div className="text-[10px] text-muted-foreground truncate">Cor: {o.color}</div>}
                          <div className="flex items-baseline gap-1 mt-1">
                            <span className="display text-xl tabular-nums">{o.pairs}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">pares</span>
                          </div>
                          <div className="h-[3px] bg-border rounded-full mt-2 overflow-hidden" role="progressbar" aria-valuenow={o.prog} aria-valuemin={0} aria-valuemax={100}>
                            <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${o.prog}%`, background: o.late ? 'hsl(var(--primary))' : s.colorVar }} />
                          </div>
                          <div className="flex justify-between mt-1.5">
                            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{o.prog}%</span>
                            {o.late && <span className="font-mono text-[10px] font-bold" style={{ color: 'hsl(var(--primary))' }}>ATRASADA</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Resumo da OP — painel lateral */}
      <Sheet open={!!selected} onOpenChange={(v) => { if (!v) setSelected(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="flex items-center gap-2 font-mono text-base">
                  {selected.order_number}
                  <Badge variant="outline" className={`text-[10px] ${selected.currentStatus === 'em_andamento' ? 'border-amber-500/40 text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                    {FLOW[selected.col]?.label} · {selected.currentStatus === 'em_andamento' ? 'em andamento' : 'pendente'}
                  </Badge>
                </SheetTitle>
                <SheetDescription>Resumo da ordem de produção.</SheetDescription>
              </SheetHeader>

              {/* Foto da referência — aspect-ratio reservado (sem layout shift) */}
              <div className="mt-4 rounded-lg border border-border bg-muted/30 overflow-hidden aspect-[4/3] flex items-center justify-center">
                {detailLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : detailPhoto ? (
                  <SignedImage src={detailPhoto} alt={`Foto da referência ${detail?.technical_sheets?.name || ''}`} fit="contain" loading="lazy" className="w-full h-full" />
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-muted-foreground/50">
                    <ImageIcon className="h-8 w-8" />
                    <span className="text-xs">Sem foto da referência</span>
                  </div>
                )}
              </div>

              <dl className="mt-4 space-y-3 text-sm">
                <Field icon={Package} label="Referência">
                  <span className="font-semibold text-foreground">{detail?.technical_sheets?.name || selected.modelo}</span>
                  {detail?.technical_sheets?.code && <span className="ml-2 font-mono text-xs text-muted-foreground">{detail.technical_sheets.code}</span>}
                  {selected.color && <div className="text-xs text-muted-foreground mt-0.5">Cor: <span className="font-medium text-foreground">{selected.color}</span></div>}
                </Field>

                <Field icon={Buildings} label="Cliente">
                  <span className="font-medium text-foreground">{detail?.sale_orders?.client_name || '—'}</span>
                </Field>

                <Field icon={Receipt} label="Pedido">
                  <span className="font-mono font-medium text-foreground">{detail?.sale_orders?.order_number || '—'}</span>
                  {detail?.sale_orders?.client_order_number && (
                    <div className="text-xs text-muted-foreground mt-0.5">Ped. cliente: <span className="font-mono text-foreground">{detail.sale_orders.client_order_number}</span></div>
                  )}
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field icon={Package} label="Quantidade">
                    <span className="display text-xl tabular-nums text-foreground">{(detail?.quantity ?? selected.pairs).toLocaleString('pt-BR')}</span>
                    <span className="ml-1 text-xs text-muted-foreground">pares</span>
                  </Field>
                  <Field icon={CalendarBlank} label="Faturamento">
                    <span className="font-medium text-foreground tabular-nums">{fmtDate(detail?.sale_orders?.delivery_deadline)}</span>
                  </Field>
                </div>

                {gradeSizes.length > 0 && (
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Grade (numeração)</dt>
                    <dd className="flex flex-wrap gap-1">
                      {gradeSizes.map((sz) => (
                        <span key={sz} className="inline-flex flex-col items-center rounded-md border border-border bg-muted/40 px-2 py-1 leading-none">
                          <span className="text-[10px] font-mono text-muted-foreground">{sz}</span>
                          <span className="text-sm font-bold tabular-nums text-foreground">{activeGrade[sz]}</span>
                        </span>
                      ))}
                    </dd>
                  </div>
                )}

                <div>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Progresso</dt>
                  <dd>
                    <div className="h-2 bg-border rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${selected.prog}%`, background: selected.late ? 'hsl(var(--primary))' : FLOW[selected.col]?.colorVar }} />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums mt-1 inline-block">{selected.prog}% das etapas concluídas</span>
                  </dd>
                </div>
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Linha de campo do resumo (ícone + label + valor). */
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
