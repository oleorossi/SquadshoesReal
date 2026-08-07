import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Warning as AlertTriangle, CheckCircle, HandArrowUp as SendToThird,
  Sliders as SlidersIcon, CalendarX, Fire,
} from '@phosphor-icons/react';
import {
  useProductionOverloads, useProductionScheduleGrid, useAcceptOverload,
  useEnsureFreshSchedule, OverloadRow,
} from '@/hooks/useProductionEngine';
import { GenerateServiceOrdersWizard } from '@/components/contractors/GenerateServiceOrdersWizard';
import { useCan } from '@/hooks/useAccessControl';
import { useRealtimeOrderStages } from '@/hooks/useOrderStages';
import { todayISO, todayPlusDaysISO } from '@/lib/date';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
// Data LOCAL (não UTC): ver o aviso em `@/lib/date` — o slice do toISOString
// virava o dia a partir das ~21h BRT e a janela de 30 dias saía deslocada.
const plusDaysISO = todayPlusDaysISO;

/**
 * Tela ESTOURO DE PRODUÇÃO (R4) — a "dívida de produção" num lugar só:
 *  • OPs cuja conclusão projetada passa da semana de faturamento (atraso).
 *  • Saldo rolado (carryover) por setor — o que ficou pra trás e está na
 *    frente da fila (R2.3/R4.4).
 * Decisão acontece AQUI: mandar pra terceiro (OS), resolver eu mesmo
 * (repriorizar/capacidade) ou aceitar o atraso com autoria (R4.3).
 */
export default function ProducaoEstouro() {
  useEnsureFreshSchedule();
  // Apontamento em outro terminal → realtime invalida as views do motor
  useRealtimeOrderStages();
  const { data: overloads = [], isLoading } = useProductionOverloads();
  const { data: grid = [] } = useProductionScheduleGrid(todayISO(), plusDaysISO(30));
  const accept = useAcceptOverload();
  const canEdit = useCan('/producao/estouro').canEdit;

  const [osWizard, setOsWizard] = useState<{ saleOrderId: string } | null>(null);
  const [acceptRow, setAcceptRow] = useState<OverloadRow | null>(null);
  const [acceptReason, setAcceptReason] = useState('');

  const lateOps = useMemo(() => overloads.filter(o => o.kind === 'late_op'), [overloads]);
  const noDue = useMemo(() => overloads.filter(o => o.kind === 'no_due'), [overloads]);
  // Fluxo travado: OP com pares restantes e NENHUM dia agendado pelo motor
  const semAgenda = useMemo(() => overloads.filter(o => o.kind === 'sem_agenda'), [overloads]);

  // Backlog (carryover) por setor nos próximos 30 dias + dias saturados.
  // Saturação por UTILIZAÇÃO do motor (fração de dia) — pares×capacidade
  // global dava falso positivo quando o rate vinha da ficha técnica.
  const sectorBacklog = useMemo(() => {
    const m = new Map<string, { carryover: number; saturatedDays: number; flow: number }>();
    grid.forEach(c => {
      const cur = m.get(c.sector) || { carryover: 0, saturatedDays: 0, flow: c.flow_order };
      cur.carryover += c.carryover_pairs;
      if (c.utilization >= 0.999) cur.saturatedDays += 1;
      m.set(c.sector, cur);
    });
    return [...m.entries()]
      .filter(([, v]) => v.carryover > 0 || v.saturatedDays > 0)
      .sort((a, b) => a[1].flow - b[1].flow);
  }, [grid]);

  const confirmAccept = () => {
    if (!acceptRow) return;
    const prefix = acceptRow.kind === 'late_op' ? 'late' : acceptRow.kind === 'no_due' ? 'nodue' : 'noagenda';
    accept.mutate({
      scopeKey: `${prefix}:${acceptRow.order_id}`,
      orderId: acceptRow.order_id,
      reason: acceptReason.trim() || undefined,
    });
    setAcceptRow(null);
    setAcceptReason('');
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · ESTOURO"
        title="Estouro de Produção"
        description="Sobrecarga e atraso projetado num lugar só. Decida: mandar pra terceiro, repriorizar, ajustar capacidade ou aceitar o atraso (registrado)."
      />

      {/* ── Saldo rolado / saturação por setor (R4.4) ─────────────────────── */}
      {sectorBacklog.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Setores sob pressão (próximos 30 dias)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {sectorBacklog.map(([sector, v]) => (
              <Card key={sector} className={v.carryover > 0 ? 'border-red-500/40' : 'border-amber-500/40'}>
                <CardContent className="p-3">
                  <p className="text-xs font-bold uppercase">{sector}</p>
                  {v.carryover > 0 && (
                    <p className="text-sm font-mono text-red-600 dark:text-red-400 mt-1">
                      {v.carryover} pares rolados
                    </p>
                  )}
                  {v.saturatedDays > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      {v.saturatedDays} dia{v.saturatedDays > 1 ? 's' : ''} no limite
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── OPs atrasadas ──────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Fire className="h-3.5 w-3.5 text-red-600" />
          Atraso projetado ({lateOps.length})
        </h3>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : lateOps.length === 0 ? (
          <EmptyState
            icon={CheckCircle}
            title="Nenhum atraso projetado"
            description="Toda a fila fecha dentro da semana de faturamento de cada pedido."
          />
        ) : (
          <div className="space-y-2">
            {lateOps.map(o => (
              <Card key={o.order_id} className="border-red-500/30">
                <CardContent className="p-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex items-center gap-2">
                      <Link to={`/orders/${o.order_id}/edit`} className="font-mono text-sm font-bold text-primary hover:underline">
                        {o.order_number}
                      </Link>
                      <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600 border-red-500/30">
                        +{o.late_days} dia{o.late_days > 1 ? 's' : ''} de atraso
                      </Badge>
                      {o.carryover_peak > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30"
                          title={`Maior saldo rolado num único setor. Somando todos os setores dá ${o.carryover_total} pares·setor — mas aí o mesmo par conta uma vez por setor.`}
                        >
                          {o.carryover_peak} rolados
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {o.reference_name}{o.color ? ` · ${o.color}` : ''} · {o.quantity} pares ·{' '}
                      {o.client_name || 'sem cliente'} {o.sale_order_number ? `· PV ${o.sale_order_number}` : ''}
                    </p>
                    <p className="text-xs mt-0.5">
                      Prazo: <strong>{fmtDate(o.due_date)}</strong> → previsto:{' '}
                      <strong className="text-red-600 dark:text-red-400">{fmtDate(o.projected_completion)}</strong>
                      {' '}· restam {o.remaining_pairs_net} pares
                      {' '}<span
                        className="text-muted-foreground"
                        title="Quanto da rota de setores já foi executada. 'Restam' conta pares que ainda não embarcaram e só muda quando a última etapa é apontada — sozinho, ele não diz se a OP andou."
                      >({o.route_progress_pct}% da rota feita)</span>
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
                        disabled={!o.sale_order_id}
                        title={o.sale_order_id ? 'Gerar OS de terceirização pré-preenchida' : 'OP sem PV vinculado'}
                        onClick={() => o.sale_order_id && setOsWizard({ saleOrderId: o.sale_order_id })}
                      >
                        <SendToThird className="h-3.5 w-3.5" /> Enviar pra terceiro
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" asChild>
                        <Link to="/producao/planejamento"><SlidersIcon className="h-3.5 w-3.5" /> Repriorizar</Link>
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" asChild>
                        <Link to="/producao/setores"><SlidersIcon className="h-3.5 w-3.5" /> Capacidade</Link>
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-muted-foreground"
                        onClick={() => setAcceptRow(o)}
                      >
                        <CheckCircle className="h-3.5 w-3.5" /> Aceitar atraso
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── OPs sem prazo ──────────────────────────────────────────────────── */}
      {noDue.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <CalendarX className="h-3.5 w-3.5 text-amber-600" />
            Sem prazo definido ({noDue.length})
          </h3>
          <div className="space-y-2">
            {noDue.map(o => (
              <Card key={o.order_id} className="border-amber-500/30">
                <CardContent className="p-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[220px]">
                    <Link to={`/orders/${o.order_id}/edit`} className="font-mono text-sm font-bold text-primary hover:underline">
                      {o.order_number}
                    </Link>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {o.reference_name}{o.color ? ` · ${o.color}` : ''} · {o.quantity} pares — o motor
                      agenda no fim da fila; defina a semana de faturamento no PV pra priorizar direito.
                    </p>
                  </div>
                  {canEdit && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAcceptRow(o)}>
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Ciente
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── OPs travadas: trabalho restante sem NENHUM dia agendado ────────── */}
      {semAgenda.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
            Fluxo travado — sem agenda ({semAgenda.length})
          </h3>
          <div className="space-y-2">
            {semAgenda.map(o => (
              <Card key={o.order_id} className="border-red-500/30">
                <CardContent className="p-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[220px]">
                    <Link to={`/orders/${o.order_id}/edit`} className="font-mono text-sm font-bold text-primary hover:underline">
                      {o.order_number}
                    </Link>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {o.reference_name}{o.color ? ` · ${o.color}` : ''} · restam {o.remaining_pairs_net} pares e o motor
                      não conseguiu agendar NENHUM dia — normalmente um setor anterior fora do fluxo
                      (ficha/configuração) sem ter entregue, ou setor 100% apontado sem finalizar.
                    </p>
                    <p className="text-xs mt-0.5">Prazo: <strong>{fmtDate(o.due_date)}</strong></p>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" asChild>
                        <Link to="/producao/setores"><SlidersIcon className="h-3.5 w-3.5" /> Rever fluxo</Link>
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAcceptRow(o)}>
                        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Ciente
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* OS pré-preenchida (fluxo existente de terceirização por OP×setor) */}
      {osWizard && (
        <GenerateServiceOrdersWizard
          open
          onOpenChange={v => { if (!v) setOsWizard(null); }}
          initialSaleOrderId={osWizard.saleOrderId}
          onGenerated={() => setOsWizard(null)}
        />
      )}

      {/* Aceitar atraso com motivo + autoria (R4.3) */}
      <Dialog open={!!acceptRow} onOpenChange={v => { if (!v) setAcceptRow(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Aceitar atraso — {acceptRow?.order_number}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              O estouro some da lista ativa e fica registrado com a sua autoria e data.
            </p>
            <div>
              <Label className="text-xs">Motivo (opcional)</Label>
              <Textarea
                value={acceptReason}
                onChange={e => setAcceptReason(e.target.value)}
                rows={2}
                className="mt-1"
                placeholder="Ex.: cliente avisado, prazo renegociado pra semana seguinte…"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAcceptRow(null)}>Cancelar</Button>
              <Button onClick={confirmAccept} disabled={accept.isPending}>Aceitar e registrar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
