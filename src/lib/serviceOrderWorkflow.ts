import { isOsActive, isOsCancelled, isOsDone } from '@/lib/osStatusMachine';

export type ServiceOrderPrimaryAction = 'dispatch' | 'conference' | 'finance' | null;

export interface ServiceOrderWorkflowInput {
  status?: string | null;
  dispatchTracked?: boolean | null;
  quantity?: number | null;
  qtyDispatched?: number | null;
  qtyInField?: number | null;
  qtyToDispatch?: number | null;
  qtyReturnedGood?: number | null;
  qtyReturnedDefect?: number | null;
  qtyLoss?: number | null;
  hasPayable?: boolean | null;
  isPaid?: boolean | null;
  /** Falso para o marcador interno FÁBRICA, que encerra sem gerar AP. */
  expectsPayable?: boolean | null;
}

export interface ServiceOrderWorkflowState {
  primaryAction: ServiceOrderPrimaryAction;
  canDispatch: boolean;
  canConference: boolean;
  canOpenFinance: boolean;
  createdDone: boolean;
  dispatchedDone: boolean;
  conferenceDone: boolean;
  financeDone: boolean;
  financePaid: boolean;
  qtyDispatched: number;
  qtyInField: number;
  qtyToDispatch: number;
  qtyReturned: number;
}

const qty = (value: number | null | undefined) => Math.max(0, Number(value) || 0);

/**
 * Resolve a próxima ação da OS a partir do ledger físico e financeiro.
 *
 * Status textual é deliberadamente secundário: uma OS "Em Andamento" sem
 * despacho não pode ser conferida, e uma "Pendente" com remessa registrada
 * precisa ser conferida. O saldo das views é a fonte de verdade.
 *
 * OS legadas (`dispatchTracked=false`) preservam o modelo histórico em que a
 * quantidade inteira era considerada enviada na criação.
 */
export function resolveServiceOrderWorkflow(input: ServiceOrderWorkflowInput): ServiceOrderWorkflowState {
  const active = isOsActive(input.status);
  const done = isOsDone(input.status);
  const cancelled = isOsCancelled(input.status);
  const tracked = Boolean(input.dispatchTracked);
  const quantity = qty(input.quantity);
  const dispatched = qty(input.qtyDispatched ?? (tracked ? 0 : quantity));
  const inField = qty(input.qtyInField ?? (tracked ? 0 : active ? quantity : 0));
  const returned = qty(input.qtyReturnedGood) + qty(input.qtyReturnedDefect) + qty(input.qtyLoss);
  const toDispatch = qty(input.qtyToDispatch ?? (tracked ? quantity - dispatched : 0));

  const canDispatch = active && tracked && toDispatch > 0;
  const canConference = active && (inField > 0 || (!tracked && quantity > returned));
  const canOpenFinance = Boolean(input.hasPayable);
  const financeNotApplicable = input.expectsPayable === false && (returned > 0 || done);

  // Conferência vence quando já há material na rua. O envio restante continua
  // disponível no menu secundário; isso evita receber algo que nunca saiu.
  const primaryAction: ServiceOrderPrimaryAction = canConference
    ? 'conference'
    : canDispatch
      ? 'dispatch'
      : canOpenFinance && (done || !active)
        ? 'finance'
        : null;

  return {
    primaryAction,
    canDispatch,
    canConference,
    canOpenFinance,
    createdDone: !cancelled,
    dispatchedDone: dispatched > 0 || (!tracked && quantity > 0),
    conferenceDone: returned > 0 || done,
    financeDone: Boolean(input.hasPayable) || financeNotApplicable,
    financePaid: Boolean(input.isPaid),
    qtyDispatched: dispatched,
    qtyInField: inField,
    qtyToDispatch: toDispatch,
    qtyReturned: returned,
  };
}
