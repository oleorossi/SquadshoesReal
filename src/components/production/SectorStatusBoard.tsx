import { useMemo, useState } from 'react';
import { useOrders } from '@/hooks/useOrders';
import {
  PRODUCTION_STAGES,
  useAllOrderStages,
  useUpdateOrderStage,
  type OrderStage,
} from '@/hooks/useOrderStages';
import SectorStageDialog from '@/components/orders/SectorStageDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, Play, ClipboardText, DotsSixVertical } from '@phosphor-icons/react';

/**
 * Quadro de Apontamento (Kanban) — board NOVO escrito direto sobre `order_stages`
 * (sem o legado `production_step` do antigo ProductionKanban). Por setor, mostra
 * as OPs em 3 colunas de status e deixa o operador ARRASTAR pra apontar:
 *   - Pendente → Em andamento: dispara a MESMA mutation guardada
 *     (`useUpdateOrderStage`), que grava started_at e respeita o guard de
 *     pré-requisitos do banco (fn_guard_manual_stage_transition) + o trigger que
 *     carimba started_at. Se o setor pré-requisito não estiver concluído, o
 *     banco rejeita e mostra o motivo.
 *   - Em andamento → Concluído: abre o SectorStageDialog (operário obrigatório +
 *     finalização), preservando a atribuição de produtividade/qualidade.
 * Reverter (arrastar pra trás) é proibido de propósito — não joga started_at fora.
 */

type StatusKey = 'pendente' | 'em_andamento' | 'concluido';
const COLUMNS: { key: StatusKey; label: string; accent: string }[] = [
  { key: 'pendente',     label: 'Pendente',     accent: 'border-t-muted-foreground/40' },
  { key: 'em_andamento', label: 'Em andamento',  accent: 'border-t-amber-500' },
  { key: 'concluido',    label: 'Concluído',    accent: 'border-t-emerald-500' },
];

interface OrderInfo {
  id: string;
  order_number: string | null;
  reference_name: string | null;
  color: string | null;
  quantity: number;
}

export function SectorStatusBoard() {
  const update = useUpdateOrderStage();
  const [sector, setSector] = useState<string>(PRODUCTION_STAGES[0].name);
  const [dialogStage, setDialogStage] = useState<OrderStage | null>(null);
  const [dialogOrderNumber, setDialogOrderNumber] = useState<string | undefined>();
  const [dragOver, setDragOver] = useState<StatusKey | null>(null);

  const { data: orders = [], isLoading: ordersLoading } = useOrders();

  // OPs vivas (em produção/reservadas) — fora finalizadas/canceladas.
  const activeOrders = useMemo<OrderInfo[]>(() => {
    return (orders as any[])
      .filter((o) => {
        const st = String(o.status || '').toLowerCase();
        return st !== 'finalizado' && st !== 'cancelada' && st !== 'cancelado';
      })
      .map((o) => ({
        id: o.id,
        order_number: o.order_number ?? null,
        reference_name: o.technical_sheets?.name ?? null,
        color: o.color ?? null,
        quantity: Number(o.quantity || 0),
      }));
  }, [orders]);

  const orderIds = useMemo(() => activeOrders.map((o) => o.id), [activeOrders]);
  const orderById = useMemo(() => new Map(activeOrders.map((o) => [o.id, o])), [activeOrders]);
  const { data: allStages = [], isLoading: stagesLoading } = useAllOrderStages(orderIds);

  // Etapa do setor selecionado por OP. 'Mesa' (legado) === 'Aviamento'.
  const sectorStages = useMemo(() => {
    const matches = (name: string) =>
      name === sector || (sector === 'Mesa' && name === 'Aviamento') || (sector === 'Aviamento' && name === 'Mesa');
    return (allStages as OrderStage[]).filter((s) => matches(s.stage_name));
  }, [allStages, sector]);

  const byStatus = useMemo(() => {
    const cols: Record<StatusKey, OrderStage[]> = { pendente: [], em_andamento: [], concluido: [] };
    for (const s of sectorStages) {
      const k = (s.status as StatusKey) in cols ? (s.status as StatusKey) : 'pendente';
      cols[k].push(s);
    }
    return cols;
  }, [sectorStages]);

  const handleDrop = (target: StatusKey, stageId: string) => {
    setDragOver(null);
    const stage = sectorStages.find((s) => s.id === stageId);
    if (!stage || stage.status === target) return;

    if (target === 'em_andamento' && stage.status === 'pendente') {
      // Início: o trigger carimba started_at; o guard valida pré-requisitos.
      update.mutate({ id: stage.id, status: 'em_andamento', started_at: new Date().toISOString() });
      return;
    }
    if (target === 'concluido' && stage.status === 'em_andamento') {
      // Conclusão exige operário → abre o diálogo completo.
      setDialogStage(stage);
      setDialogOrderNumber(orderById.get(stage.order_id)?.order_number ?? undefined);
      return;
    }
    // Demais transições (reverter, pular pendente→concluído) não são permitidas aqui.
  };

  const loading = ordersLoading || stagesLoading;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={sector} onValueChange={setSector}>
          <SelectTrigger className="w-56 h-9">
            <SelectValue placeholder="Setor" />
          </SelectTrigger>
          <SelectContent>
            {PRODUCTION_STAGES.map((s) => (
              <SelectItem key={s.name} value={s.name}>{s.name === 'Mesa' ? 'Aviamento' : s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Arraste o card pra <strong>Em andamento</strong> (aponta o início) ou pra <strong>Concluído</strong> (finaliza com operário).
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {COLUMNS.map((col) => {
            const items = byStatus[col.key];
            return (
              <div
                key={col.key}
                onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
                onDragLeave={() => setDragOver((d) => (d === col.key ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  const stageId = e.dataTransfer.getData('text/plain');
                  if (stageId) handleDrop(col.key, stageId);
                }}
                className={`rounded-lg border border-t-2 bg-muted/20 ${col.accent} ${dragOver === col.key ? 'ring-2 ring-primary/40 bg-muted/40' : ''}`}
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
                  <span className="text-xs font-bold uppercase tracking-wider text-foreground">{col.label}</span>
                  <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
                </div>
                <div className="p-2 space-y-2 min-h-[120px]">
                  {items.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic text-center py-6">vazio</p>
                  ) : (
                    items.map((stage) => {
                      const ord = orderById.get(stage.order_id);
                      const canStart = col.key === 'pendente';
                      const canFinish = col.key === 'em_andamento';
                      return (
                        <div
                          key={stage.id}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', stage.id)}
                          className="rounded-md border border-border/70 bg-card p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors"
                        >
                          <div className="flex items-start gap-1.5">
                            <DotsSixVertical className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-mono font-bold truncate">{ord?.order_number || '—'}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{ord?.reference_name || '—'}</p>
                              <p className="text-[11px] mt-0.5">
                                <span className="text-muted-foreground">Cor:</span>{' '}
                                <span className="font-medium">{ord?.color || '—'}</span>
                                {' · '}<span className="font-mono">{ord?.quantity ?? 0}p</span>
                              </p>
                              {(canStart || canFinish) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (canStart) {
                                      update.mutate({ id: stage.id, status: 'em_andamento', started_at: new Date().toISOString() });
                                    } else {
                                      setDialogStage(stage);
                                      setDialogOrderNumber(ord?.order_number ?? undefined);
                                    }
                                  }}
                                  disabled={canStart && update.isPending}
                                  className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                                >
                                  {canStart ? <><Play className="h-3 w-3" weight="fill" /> Iniciar</> : <><ClipboardText className="h-3 w-3" /> Apontar / concluir</>}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialogStage && (
        <SectorStageDialog
          stage={dialogStage}
          open={!!dialogStage}
          onOpenChange={(v) => { if (!v) setDialogStage(null); }}
          orderNumber={dialogOrderNumber}
        />
      )}
    </div>
  );
}
