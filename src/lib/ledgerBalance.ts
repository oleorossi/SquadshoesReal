/**
 * Regra CANÔNICA dos dois jeitos de somar contas a pagar / a receber.
 *
 * Existem DOIS conceitos legítimos, e confundi-los foi a origem do bug em que o
 * painel exibia "Total: R$ 3.521,99" ao lado do card "TOTAL A PAGAR R$ 0,00"
 * para a MESMA e única conta:
 *
 *   • SALDO EM ABERTO  — quanto ainda se deve / se tem a receber.
 *     Exclui cancelada (não é obrigação) e liquidada (já passou pelo caixa),
 *     e conta apenas o que FALTA numa parcial. É o número dos cards do topo.
 *
 *   • VOLUME           — quanto girou no período, pago ou não.
 *     Exclui só cancelada e usa o valor cheio. É o número dos rankings e da
 *     despesa por categoria: responde "quem é meu maior cliente", pergunta que
 *     o saldo em aberto não responde (quem pagou tudo sairia da lista).
 *
 * Os dois estão certos — o que não pode é um deles aparecer com rótulo do
 * outro. Toda tela que soma AP/AR deve chamar uma destas funções e nomear a
 * coluna de acordo, em vez de escrever o próprio reduce.
 */

/** Forma mínima que as funções precisam — evita a lib depender dos hooks. */
export interface LedgerRow {
  status: string;
  amount: number;
  amount_paid?: number;
  amount_received?: number;
  due_date?: string | null;
}

export type LedgerKind = 'payable' | 'receivable';

/** Status que encerram a conta: nada mais entra ou sai. */
const SETTLED_STATUSES: Record<LedgerKind, readonly string[]> = {
  payable: ['paid', 'pago', 'cancelled', 'cancelado'],
  receivable: ['received', 'recebido', 'cancelled', 'cancelado'],
};

/** Canceladas saem das DUAS visões — nunca foram obrigação real. */
const CANCELLED_STATUSES: readonly string[] = ['cancelled', 'cancelado'];

function normalizedStatus(row: LedgerRow): string {
  return String(row.status || '').trim().toLowerCase();
}

function finiteAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isCancelled(row: LedgerRow): boolean {
  return CANCELLED_STATUSES.includes(normalizedStatus(row));
}

export function isSettled(row: LedgerRow, kind: LedgerKind): boolean {
  return isCancelled(row) || SETTLED_STATUSES[kind].includes(normalizedStatus(row));
}

/** Quanto já foi liquidado nesta linha, no campo certo para o tipo de razão. */
export function settledAmountOf(row: LedgerRow, kind: LedgerKind): number {
  return Math.max(0, finiteAmount(kind === 'payable' ? row.amount_paid : row.amount_received));
}

/** SALDO EM ABERTO da linha — 0 se liquidada ou cancelada. */
export function openBalanceOf(row: LedgerRow, kind: LedgerKind): number {
  if (isSettled(row, kind)) return 0;
  return Math.max(0, finiteAmount(row.amount) - settledAmountOf(row, kind));
}

/** VOLUME da linha — valor cheio; 0 apenas se cancelada. */
export function volumeOf(row: LedgerRow): number {
  return isCancelled(row) ? 0 : Math.max(0, finiteAmount(row.amount));
}

export function sumOpenBalance(rows: LedgerRow[], kind: LedgerKind): number {
  return rows.reduce((s, r) => s + openBalanceOf(r, kind), 0);
}

export function sumVolume(rows: LedgerRow[]): number {
  return rows.reduce((s, r) => s + volumeOf(r), 0);
}

/**
 * As duas visões, com os rótulos que devem aparecer na UI. Serve de fonte única
 * para o alternador Volume/Em aberto dos rankings e da despesa por categoria —
 * assim os textos não divergem entre telas.
 */
export const LEDGER_VIEW_LABELS = {
  volume: {
    label: 'Volume',
    payableColumn: 'Comprado',
    receivableColumn: 'Faturado',
    hint: 'Valor cheio de tudo que foi lançado, pago ou não. Exclui apenas cancelados.',
  },
  open: {
    label: 'Em aberto',
    payableColumn: 'A pagar',
    receivableColumn: 'A receber',
    hint: 'Apenas o saldo que ainda falta liquidar. Bate com os cards do topo do Financeiro.',
  },
} as const;

export type LedgerView = keyof typeof LEDGER_VIEW_LABELS;
