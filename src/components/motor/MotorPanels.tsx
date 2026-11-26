/**
 * Abas próprias do menu "Motor de produção" (/motor). Só leitura — reaproveitam
 * as fontes que o motor já grava (v_production_motor_plan,
 * purchase_order_motor_priority, atelier_jobs_expected_dates, reservas
 * atelier_prep). Nada aqui liga o motor automático.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowClockwise, CircleNotch as Loader2, Info } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { useMotorConfig } from '@/hooks/useMotorConfig';
import { useMotorAtelier, useMotorPlan } from '@/hooks/useMotorPanels';
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { usePurchaseOrderMotorPriority } from '@/hooks/usePurchaseOrderMotorPriority';
import { useLastEngineRun, useRecomputeSchedule } from '@/hooks/useProductionEngine';
import { useCan } from '@/hooks/useAccessControl';
import { ATELIER_SECTOR_LABEL, type AtelierSector } from '@/lib/atelier';
import { motorUrgencyLabel, sortByMotorPriority } from '@/lib/purchaseOrderMotorPriority';
import { formatCurrency } from '@/lib/utils';

const TH = 'px-3 py-2 text-left font-medium';
const TD = 'px-3 py-2 whitespace-nowrap';

function fmtMotorDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y.slice(2)}` : iso;
}

const WAIT_LABEL: Record<string, string> = {
  aguardando_prestador: 'Aguardando prestador',
  aguardando_material: 'Aguardando material',
  aguardando_solado: 'Aguardando solado',
};

function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Botão "Recalcular fila" — o mesmo recálculo manual de Produção › Setores. */
export function MotorRecalcularButton() {
  const recompute = useRecomputeSchedule();
  const canEdit = useCan('/motor').canEdit;
  return (
    <Button
      variant="outline"
      className="h-9 gap-2"
      onClick={() => recompute.mutate()}
      disabled={!canEdit || recompute.isPending}
    >
      <ArrowClockwise className={`h-4 w-4 ${recompute.isPending ? 'animate-spin' : ''}`} />
      Recalcular fila
    </Button>
  );
}

export function MotorUltimoRecalculo() {
  const { data: lastRun } = useLastEngineRun();
  if (!lastRun) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Info className="h-3.5 w-3.5" />
      Último recálculo: {new Date(lastRun.ran_at).toLocaleString('pt-BR')} · {lastRun.queue_size} OPs · gatilho: {lastRun.triggered_by}
    </p>
  );
}

/** Plano/agenda: ordem única do motor com espera, retorno do prestador e fim previsto. */
export function MotorPlanoPanel() {
  const { data: rows = [], isLoading, isError } = useMotorPlan();
  const computedAt = rows[0]?.computed_at;
  return (
    <Panel
      eyebrow="MOTOR · PLANO"
      title="Plano e agenda"
      subtitle={computedAt
        ? `Ordem única do motor (complexo antes de simples na mesma semana). Calculado em ${new Date(computedAt).toLocaleString('pt-BR')}.`
        : 'Ordem única do motor (complexo antes de simples na mesma semana).'}
      actions={<MotorRecalcularButton />}
      flush
    >
      {isLoading ? <Loading /> : isError ? (
        <Empty>Não foi possível carregar o plano do motor.</Empty>
      ) : rows.length === 0 ? (
        <Empty>O plano aparece depois do próximo recálculo (apontamento, salvar um setor ou o recálculo diário).</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>PV</th>
                <th className={TH}>OP</th>
                <th className={TH}>Referência</th>
                <th className={TH}>Pares</th>
                <th className={TH}>Classe</th>
                <th className={TH}>Semana</th>
                <th className={TH}>Espera</th>
                <th className={TH}>Volta prestador</th>
                <th className={TH}>Material</th>
                <th className={TH}>Início</th>
                <th className={TH}>Fim previsto</th>
                <th className={TH}>Faturar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.order_key} className="border-t border-border">
                  <td className={TD}>{r.motor_position}</td>
                  <td className={TD}>
                    {r.sale_order_number ?? '—'}
                    {r.is_urgent && <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">Urgente</Badge>}
                  </td>
                  <td className={TD}>{r.is_virtual ? <span className="text-muted-foreground">no prestador</span> : r.order_number ?? '—'}</td>
                  <td className={TD}>{[r.reference_code, r.color].filter(Boolean).join(' · ') || '—'}</td>
                  <td className={TD}>{r.pairs ?? '—'}</td>
                  <td className={TD}>{r.item_class === 'complexo' ? 'Complexo' : r.item_class === 'simples' ? 'Simples' : '—'}</td>
                  <td className={TD}>{r.billing_week ?? '—'}</td>
                  <td className={TD}>{r.wait_reason ? WAIT_LABEL[r.wait_reason] ?? r.wait_reason : '—'}</td>
                  <td className={TD}>{fmtMotorDate(r.cabedal_expected_return)}</td>
                  <td className={TD}>{fmtMotorDate(r.material_eta)}</td>
                  <td className={TD}>{fmtMotorDate(r.earliest_start)}</td>
                  <td className={TD}>{fmtMotorDate(r.projected_completion)}</td>
                  <td className={TD}>
                    {fmtMotorDate(r.billing_anchor)}
                    {r.days_vs_billing != null && r.days_vs_billing > 0 && (
                      <span className="ml-1 text-destructive">+{r.days_vs_billing}d</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Compras do motor: OCs em rascunho/sugeridas na ordem de prioridade (comprar até). */
export function MotorComprasPanel() {
  const { data: orders = [], isLoading } = usePurchaseOrders();
  const { data: priority } = usePurchaseOrderMotorPriority();
  const prioritized = useMemo(() => {
    if (!priority) return [];
    return sortByMotorPriority(orders.filter((o) => priority.has(o.id)), priority);
  }, [orders, priority]);

  return (
    <Panel
      eyebrow="MOTOR · COMPRAS"
      title="OCs priorizadas pelo motor"
      subtitle="Rascunhos ordenados por atrasada → urgente → normal e comprar-até. A OC de verdade continua pelo clique em “Gerar OC”."
      actions={(
        <Button variant="outline" className="h-9" asChild>
          <Link to="/purchase-orders">Abrir Ordens de compra</Link>
        </Button>
      )}
      flush
    >
      {isLoading ? <Loading /> : prioritized.length === 0 ? (
        <Empty>Nenhuma OC em rascunho com prioridade do motor.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>OC</th>
                <th className={TH}>Fornecedor</th>
                <th className={TH}>Situação</th>
                <th className={TH}>Comprar até</th>
                <th className={TH}>Material precisa</th>
                <th className={TH}>Envio prestador</th>
                <th className={TH}>Lead</th>
                <th className={TH}>Valor</th>
                <th className={TH}>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {prioritized.map((o) => {
                const p = priority?.get(o.id);
                const label = p ? motorUrgencyLabel(p) : null;
                return (
                  <tr key={o.id} className="border-t border-border">
                    <td className={TD}>{p?.motor_rank ?? '—'}</td>
                    <td className={TD}>{o.order_number}</td>
                    <td className={TD}>{o.supplier_name || '—'}</td>
                    <td className={TD}>
                      {label ? (
                        <Badge variant={p?.urgency === 'atrasada' ? 'destructive' : 'secondary'} className="h-5 px-1.5 text-[10px]">{label}</Badge>
                      ) : 'No prazo'}
                      {p?.over_weekly_cap && <span className="ml-1 text-muted-foreground">acima do teto semanal</span>}
                    </td>
                    <td className={TD}>{fmtMotorDate(p?.purchase_by_date)}</td>
                    <td className={TD}>{fmtMotorDate(p?.material_need_date)}</td>
                    <td className={TD}>{fmtMotorDate(p?.send_to_contractor_date)}</td>
                    <td className={TD}>{p?.lead_days != null ? `${p.lead_days}d` : '—'}</td>
                    <td className={TD}>{formatCurrency(o.total_value)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p?.reason ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Ateliê: envio/volta prevista do prestador por serviço + reservas do kit (atelier_prep). */
export function MotorAtelierPanel() {
  const { data, isLoading, isError } = useMotorAtelier();
  const jobs = (data?.jobs ?? []).filter((j) => !j.returned);
  const reservations = data?.reservations ?? [];
  return (
    <div className="space-y-4">
      <Panel
        eyebrow="MOTOR · ATELIÊ"
        title="Prestador: envio e volta prevista"
        subtitle="Serviços de cabedal complexo ainda não devolvidos. O motor segura a montagem até a volta prevista."
        actions={(
          <Button variant="outline" className="h-9" asChild>
            <Link to="/terceirizados?tab=corte">Abrir Ateliê</Link>
          </Button>
        )}
        flush
      >
        {isLoading ? <Loading /> : isError ? (
          <Empty>Não foi possível carregar o Ateliê.</Empty>
        ) : jobs.length === 0 ? (
          <Empty>Nenhum serviço de prestador em aberto.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className={TH}>PV</th>
                  <th className={TH}>Referência</th>
                  <th className={TH}>Setor</th>
                  <th className={TH}>Kit chega</th>
                  <th className={TH}>Envio</th>
                  <th className={TH}>Prazo (dias úteis)</th>
                  <th className={TH}>Volta prevista</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.job_id} className="border-t border-border">
                    <td className={TD}>{j.pv ?? '—'}</td>
                    <td className={TD}>{[j.reference, j.color].filter(Boolean).join(' · ') || '—'}</td>
                    <td className={TD}>{ATELIER_SECTOR_LABEL[j.sector as AtelierSector] ?? j.sector}</td>
                    <td className={TD}>{fmtMotorDate(j.kit_material_eta)}</td>
                    <td className={TD}>{fmtMotorDate(j.planned_send)}</td>
                    <td className={TD}>{j.prep_business_days ?? '—'}</td>
                    <td className={TD}>
                      {fmtMotorDate(j.expected_return)}
                      {j.capacity_pushed && <span className="ml-1 text-muted-foreground">empurrado pela capacidade</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        eyebrow="MOTOR · RESERVAS"
        title="Reservas do kit do Ateliê"
        subtitle="Material empenhado para o cabedal complexo: não é realocado para outro PV. A falta vira OC rascunho."
        flush
      >
        {isLoading ? <Loading /> : reservations.length === 0 ? (
          <Empty>Nenhuma reserva de kit do Ateliê em aberto.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className={TH}>PV</th>
                  <th className={TH}>Material</th>
                  <th className={TH}>Reservado</th>
                  <th className={TH}>Falta</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className={TD}>{r.pv ?? '—'}</td>
                    <td className={TD}>{r.material}</td>
                    <td className={TD}>{r.reserved.toLocaleString('pt-BR')} {r.unit ?? ''}</td>
                    <td className={TD}>{r.short > 0 ? `${r.short.toLocaleString('pt-BR')} ${r.unit ?? ''}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/** Configurações: as chaves do motor só aparecem aqui — quem decide ligar é o Leonardo. */
export function MotorConfigPanel() {
  const { data: config, isLoading } = useMotorConfig();
  const s = config?.settings;
  return (
    <Panel
      eyebrow="MOTOR · CONFIGURAÇÕES"
      title="Chaves do motor"
      subtitle="Só exibição. Nenhuma chave é ligada por esta tela."
      actions={<MotorRecalcularButton />}
    >
      {isLoading || !s ? <Loading /> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-64">Motor automático</span>
            <Badge variant={s.auto_motor_enabled ? 'default' : 'secondary'}>{s.auto_motor_enabled ? 'Ligado' : 'Desligado'}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-64">Liberar urgente sem material</span>
            <Badge variant={s.urgent_release_without_material ? 'default' : 'secondary'}>{s.urgent_release_without_material ? 'Ligado' : 'Desligado'}</Badge>
          </div>
          <MotorUltimoRecalculo />
          <p className="text-xs text-muted-foreground">
            “Recalcular fila” refaz a fila e a agenda com os dados atuais (o mesmo botão de Produção › Setores). Os números que
            alimentam o motor ficam na aba <Link className="underline" to="/motor?tab=prazos">Prazos</Link>; capacidade e equipe,
            na aba <Link className="underline" to="/motor?tab=capacidade">Capacidade e equipe</Link>.
          </p>
        </div>
      )}
    </Panel>
  );
}
