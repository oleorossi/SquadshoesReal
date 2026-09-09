import { format } from 'date-fns';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle as CheckCircle2, CurrencyDollar as DollarSign, Package,
  Warning as AlertTriangle, ArrowRight, Circle, PaperPlaneTilt, ArrowUUpLeft, Receipt,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { isOsCancelled, isOsDone } from '@/lib/osStatusMachine';
import { resolveServiceOrderWorkflow } from '@/lib/serviceOrderWorkflow';
import {
  resolveOsCycleBalance,
  resolveOsReceiptState,
  summarizeMaterialsSent,
  type CockpitMaterialSent,
} from '@/lib/serviceOrderCockpit';
import type { ServiceOrder, ServiceOrderOverview } from '@/hooks/useContractors';

/**
 * Indicadores de estado da OS partilhados entre a visão em cartões e a tabela.
 * Extraídos de Contractors.tsx (que passava de 2.900 linhas) para que a mesma
 * leitura de pagamento e saldo valha nas duas visões — antes o pagamento só
 * existia no rodapé do cartão, e a tabela, que é a visão PADRÃO, não o mostrava.
 */

// ── Indicador de pagamento da OS (vem da view v_service_order_overview) ───────
// Mostra Pago/A pagar + vencimento da conta a pagar gerada na finalização da OS.
//
// Ausência de conta a pagar tem DOIS significados e eles não podem ficar mudos
// do mesmo jeito: OS ainda aberta legitimamente não tem conta (a AP nasce na
// finalização) — silêncio correto; mas OS FINALIZADA sem conta é dinheiro que
// ninguém vai cobrar, e antes disso não aparecia em lugar nenhum da tela.
export function OsPaymentBadge({ ov, osStatus, orderNumber, expectsPayable = true }: { ov?: ServiceOrderOverview; osStatus?: string; orderNumber?: string; expectsPayable?: boolean }) {
  const financeHref = orderNumber
    ? `/finance?tab=payable&q=${encodeURIComponent(orderNumber)}`
    : null;
  const wrap = (node: ReactNode) => financeHref
    ? <Link to={financeHref} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{node}</Link>
    : node;

  if (!ov || !ov.has_payable) {
    if (!isOsDone(osStatus)) return null; // OS aberta: a conta ainda não deve existir
    if (!expectsPayable) {
      return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3" /> Interno · sem AP</span>;
    }
    return wrap(
      <span
        className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400"
        title="OS finalizada sem conta a pagar — o prestador não será cobrado. Verifique o lançamento no financeiro."
      >
        <AlertTriangle className="h-3 w-3" />
        Sem conta a pagar
      </span>,
    );
  }
  if (ov.is_paid) {
    return wrap(
      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" />
        Pago{ov.payment_date ? ` · ${format(new Date(ov.payment_date + 'T12:00:00'), 'dd/MM')}` : ''}
      </span>,
    );
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdue = !!ov.payment_due_date && ov.payment_due_date < todayIso;
  return wrap(
    <span className={cn('inline-flex items-center gap-1 text-xs', overdue ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>
      <DollarSign className="h-3 w-3" />
      A pagar{ov.payment_due_date ? ` · vence ${format(new Date(ov.payment_due_date + 'T12:00:00'), 'dd/MM')}` : ''}
    </span>,
  );
}

/** Régua compacta do processo real: emissão → remessa → conferência → AP. */
export function OsWorkflowRail({ order, ov }: { order: ServiceOrder; ov?: ServiceOrderOverview }) {
  const expectsPayable = Number(order.contractors?.payment_days ?? 30) < 999;
  const state = resolveServiceOrderWorkflow({
    status: order.status,
    dispatchTracked: order.dispatch_tracked,
    quantity: order.quantity,
    qtyDispatched: ov?.qty_dispatched,
    qtyInField: ov?.qty_in_field,
    qtyToDispatch: ov?.qty_to_dispatch,
    qtyReturnedGood: ov?.qty_returned_good,
    qtyReturnedDefect: ov?.qty_returned_defect,
    qtyLoss: ov?.qty_loss,
    hasPayable: ov?.has_payable,
    isPaid: ov?.is_paid,
    expectsPayable,
  });

  if (isOsCancelled(order.status)) {
    return <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">Fluxo cancelado · histórico preservado</div>;
  }

  const stages = [
    { label: 'Emitida', done: state.createdDone },
    { label: state.qtyInField > 0 ? 'Na rua' : 'Enviada', done: state.dispatchedDone },
    { label: 'Conferida', done: state.conferenceDone },
    { label: !expectsPayable ? 'Sem AP' : state.financePaid ? 'Paga' : 'Financeiro', done: state.financeDone },
  ];
  const firstPending = stages.findIndex((stage) => !stage.done);

  return (
    <div className="mt-2.5 grid grid-cols-4" aria-label="Etapas da ordem de serviço">
      {stages.map((stage, index) => {
        const current = firstPending === index;
        return (
          <div key={stage.label} className="relative flex min-w-0 flex-col items-center gap-1 text-center">
            {index > 0 && (
              <span className={cn('absolute right-1/2 top-[6px] h-px w-full', stages[index - 1].done ? 'bg-primary/60' : 'bg-border')} />
            )}
            <span className={cn(
              'relative z-10 grid h-3 w-3 place-items-center rounded-full border bg-card',
              stage.done && 'border-primary bg-primary text-primary-foreground',
              current && 'border-amber-500 ring-2 ring-amber-500/20',
              !stage.done && !current && 'border-border text-muted-foreground',
            )}>
              {stage.done ? <CheckCircle2 className="h-3 w-3" weight="fill" /> : <Circle className="h-2 w-2" />}
            </span>
            <span className={cn(
              'truncate text-[9px] font-semibold uppercase tracking-wide',
              stage.done ? 'text-foreground' : current ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
            )}>{stage.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Saldo de recebimento parcial (Enviado / Devolvido bom / Na rua) ──────────
// Só aparece quando houve algum retorno mas ainda há pares na rua (parcial).
export function OsBalanceLine({ ov }: { ov?: ServiceOrderOverview }) {
  if (!ov) return null;
  const sent = Number(ov.qty_dispatched ?? ov.qty_sent ?? 0);
  const good = Number(ov.qty_returned_good ?? 0);
  const defect = Number(ov.qty_returned_defect ?? 0);
  const loss = Number(ov.qty_loss ?? 0);
  const inField = Number(ov.qty_in_field ?? 0);
  const returned = good + defect + loss;
  const rework = Number(ov.qty_defect_pending_rework ?? 0);
  const short = Number(ov.qty_short ?? 0);
  // Defeito e perda precisam aparecer MESMO com a OS sem saldo na rua: são
  // justamente os casos em que o par sumiu do controle (voltou com defeito ou
  // se perdeu no prestador) e alguém precisa decidir retrabalho ou reposição.
  if (sent <= 0 || returned <= 0) return null;
  if (inField <= 0 && rework <= 0 && short <= 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      {inField > 0 && (
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
              title={`Bons ${good} · Defeito ${defect} · Perda ${loss}`}>
          <Package className="h-3 w-3" />
          Devolvido {returned}/{sent} · {inField} na rua
        </span>
      )}
      {rework > 0 && (
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
              title="Pares com defeito aguardando retrabalho — podem ser enviados de volta ao prestador">
          <ArrowRight className="h-3 w-3" />
          {rework} p/ retrabalho
        </span>
      )}
      {short > 0 && (
        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400"
              title="Perda no prestador + sucata: a OS não entrega essa quantidade sem repor material">
          <AlertTriangle className="h-3 w-3" />
          {short} a repor
        </span>
      )}
    </span>
  );
}

/** Sempre visível: o que já foi, o que já voltou, o material da remessa e o recibo. */
export function OsCycleLine({
  order,
  ov,
}: {
  order: Pick<ServiceOrder, 'quantity' | 'dispatch_tracked' | 'signed_photo_url' | 'materials_sent'>;
  ov?: ServiceOrderOverview;
}) {
  const balance = resolveOsCycleBalance({
    quantity: order.quantity,
    dispatchTracked: order.dispatch_tracked,
    qtyDispatched: ov?.qty_dispatched,
    qtySent: ov?.qty_sent,
    qtyInField: ov?.qty_in_field,
    qtyToDispatch: ov?.qty_to_dispatch,
    qtyReturnedGood: ov?.qty_returned_good,
    qtyReturnedDefect: ov?.qty_returned_defect,
    qtyLoss: ov?.qty_loss,
  });
  const materials = summarizeMaterialsSent(order.materials_sent as CockpitMaterialSent[] | null);
  const receipt = resolveOsReceiptState({
    signedPhotoUrl: order.signed_photo_url,
    sentPairs: balance.sent,
  });

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1" title="Pares enviados ao prestador">
        <PaperPlaneTilt className="h-3 w-3" />
        Enviado {balance.sent.toLocaleString('pt-BR')}
      </span>
      <span className="inline-flex items-center gap-1" title="Pares que já voltaram (bom + defeito + perda)">
        <ArrowUUpLeft className="h-3 w-3" />
        Voltou {balance.returned.toLocaleString('pt-BR')}
      </span>
      {balance.inField > 0 && (
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
          {balance.inField.toLocaleString('pt-BR')} na rua
        </span>
      )}
      <span className="inline-flex items-center gap-1" title="Quantidade de material documentada na remessa">
        <Package className="h-3 w-3" />
        {materials.label}
      </span>
      {receipt !== 'none' && (
        <span className={cn(
          'inline-flex items-center gap-1',
          receipt === 'signed' ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400',
        )}>
          <Receipt className="h-3 w-3" />
          {receipt === 'signed' ? 'Recibo assinado' : 'Recibo pendente'}
        </span>
      )}
    </span>
  );
}
