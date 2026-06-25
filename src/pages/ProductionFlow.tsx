/**
 * Production Flow — quadro kanban ARRASTÁVEL das OPs por setor.
 * "Onde está cada ordem": cada OP cai na coluna do seu setor atual; arrastar pra
 * outra coluna empurra a OP pelo fluxo.
 *
 * Dados REAIS de order_stages (não mais o mock/production_step legado). Arrastar
 * chama a RPC advance_order_to_sector (atômica): conclui o que vem antes do alvo
 * NO FLUXO e inicia o alvo, respeitando o guard de pré-requisito
 * (fn_guard_manual_stage_transition) e carimbando started_at/completed_at via
 * trigger. Se faltar pré-requisito, o guard reverte tudo e a mensagem aparece.
 *
 * ⚠ A ordem das colunas é o FLUXO real (topológico), não o stage_order — na base
 * Costura tem stage_order 3 mas depende de Aviamento (4). Ordem: 3 prep → Costura
 * → Silk → Colagem → Montagem → Solagem → Acabamento → Expedição.
 */
import { useMemo } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useOrders } from '@/hooks/useOrders';
import { useAllOrderStages, type OrderStage } from '@/hooks/useOrderStages';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { DotsSixVertical } from '@phosphor-icons/react';

// Ordem TOPOLÓGICA do fluxo (= ordem das colunas), alinhada ao guard e à
// computeParallelWindows. Cada coluna reusa uma CSS var de estágio (tematizada).
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

/** 'Mesa' (legado) === 'Aviamento'; devolve o índice no fluxo ou -1. */
function flowIndex(stageName: string): number {
  const n = stageName === 'Mesa' ? 'Aviamento' : stageName;
  return FLOW_NAMES.indexOf(n);
}

interface FlowOp {
  id: string;
  order_number: string;
  modelo: string;
  color: string | null;
  pairs: number;
  col: number;          // índice da coluna (setor atual)
  prog: number;         // 0..100 (etapas concluídas / total)
  currentStatus: string;
  late: boolean;
}

export default function ProductionFlow() {
  const qc = useQueryClient();
  const { data: orders = [] } = useOrders();

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
      if (open.length === 0) continue; // tudo concluído → não está mais "em produção"
      const inProg = open.filter(s => s.status === 'em_andamento');
      const current = inProg.length
        ? inProg.reduce((a, b) => (flowIndex(b.stage_name) > flowIndex(a.stage_name) ? b : a))
        : open.reduce((a, b) => (flowIndex(b.stage_name) < flowIndex(a.stage_name) ? b : a));
      const done = inFlow.filter(s => s.status === 'concluido').length;
      const plannedDelivery = o.planned_delivery || null;
      const late = !!plannedDelivery && new Date(plannedDelivery + 'T00:00:00') < today;
      out.push({
        id: o.id,
        order_number: o.order_number || o.id.slice(0, 8),
        modelo: o.technical_sheets?.name || '—',
        color: o.color ?? null,
        pairs: Number(o.quantity) || 0,
        col: flowIndex(current.stage_name),
        prog: inFlow.length > 0 ? Math.round((done / inFlow.length) * 100) : 0,
        currentStatus: current.status,
        late,
      });
    }
    return out;
  }, [activeOrders, stagesByOrder, today]);

  const advance = useMutation({
    mutationFn: async ({ orderId, target }: { orderId: string; target: string }) => {
      const operator = (() => { try { return localStorage.getItem('sector_operator_employee_id') || null; } catch { return null; } })();
      const { error } = await (supabase as any).rpc('advance_order_to_sector', {
        p_order_id: orderId, p_target: target, p_operator: operator,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success('OP movida no fluxo');
    },
    onError: (e: any) => toast.error(e?.message || 'Não foi possível mover a OP'),
  });

  const stageStats = useMemo(() =>
    FLOW.map((s, i) => {
      const colOps = ops.filter(o => o.col === i);
      return { ...s, count: colOps.length, pairs: colOps.reduce((a, o) => a + o.pairs, 0) };
    }), [ops]);

  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · FLUXO"
        title="Onde está cada ordem"
        description="Arraste a OP pra outra coluna pra empurrá-la pelo fluxo. Conclui o que vem antes e inicia o setor de destino (respeitando o pré-requisito). Vermelho = atraso."
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
          {advance.isPending && <span className="text-xs text-muted-foreground animate-pulse">movendo…</span>}
        </div>

        <div className="overflow-x-auto -mx-1 px-1">
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
                  className="bg-muted/40 rounded-lg p-2.5 min-h-[480px] w-[210px] shrink-0"
                  style={{ borderTop: `2px solid ${s.colorVar}` }}
                >
                  <div className="flex items-center gap-2 pb-2 border-b border-border mb-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="display text-sm tracking-[0.04em] truncate">{s.label}</div>
                      <div className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')} / {FLOW.length}</div>
                    </div>
                    <span className="font-mono text-xs font-bold text-muted-foreground">{colOps.length}</span>
                  </div>

                  {colOps.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground/50 italic py-6">Nenhuma OP nesta etapa</div>
                  ) : (
                    colOps.map((o) => (
                      <div
                        key={o.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', o.id)}
                        className="bg-card rounded-md p-2.5 mb-1.5 relative overflow-hidden cursor-grab active:cursor-grabbing"
                        style={{ border: `1px solid ${o.late ? 'hsl(var(--primary))' : 'hsl(var(--border))'}` }}
                      >
                        {o.late && (
                          <div className="absolute top-0 right-0" style={{ width: 0, height: 0, borderLeft: '14px solid transparent', borderTop: '14px solid hsl(var(--primary))' }} />
                        )}
                        <div className="flex justify-between items-center gap-1">
                          <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                            <DotsSixVertical className="h-3 w-3 text-muted-foreground/40" />{o.order_number}
                          </span>
                          <Badge variant="outline" className="text-[9px] px-1 py-0">
                            {o.currentStatus === 'em_andamento' ? '🔄' : '⏳'}
                          </Badge>
                        </div>
                        <div className="text-[12.5px] font-semibold mt-1 leading-tight truncate">{o.modelo}</div>
                        {o.color && <div className="text-[10px] text-muted-foreground truncate">Cor: {o.color}</div>}
                        <div className="flex items-baseline gap-1 mt-1">
                          <span className="display text-xl tabular-nums">{o.pairs}</span>
                          <span className="font-mono text-xs text-muted-foreground">pares</span>
                        </div>
                        <div className="h-[3px] bg-border rounded-sm mt-2 overflow-hidden">
                          <div className="h-full" style={{ width: `${o.prog}%`, background: o.late ? 'hsl(var(--primary))' : s.colorVar }} />
                        </div>
                        <div className="flex justify-between mt-1.5">
                          <span className="font-mono text-xs text-muted-foreground">{o.prog}%</span>
                          {o.late && <span className="font-mono text-xs" style={{ color: 'hsl(var(--primary))' }}>ATRASADA</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
