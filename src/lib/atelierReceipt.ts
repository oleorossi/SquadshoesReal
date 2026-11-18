import { atelierEffectiveMode, type AtelierExecutionMode } from '@/lib/atelier';

/**
 * Recebimento parcial do Ateliê.
 * A soma vive no banco (`atelier_job_receipts`). Aqui só a conta que a tela
 * e o Kanban usam para não oferecer mais pares do que já voltaram.
 */

export const ATELIER_DOWNSTREAM_STAGES = [
  'Colagem',
  'Montagem',
  'Solagem',
  'Acabamento',
  'Expedição',
] as const;

export function atelierReceiptRemaining(pairs: number, received: number): number {
  const total = Number(pairs) || 0;
  const done = Number(received) || 0;
  return Math.max(0, total - done);
}

/** Só inteiro positivo. Vírgula, ponto e sinal não viram par. */
export function atelierWholePairs(raw: string, allowZero = false): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isInteger(value)) return null;
  if (value < 0 || (!allowZero && value === 0)) return null;
  return value;
}

export function atelierReceiptProgressLabel(
  sectorLabel: string,
  received: number,
  pairs: number,
): string {
  const total = Number(pairs) || 0;
  const done = Math.max(0, Number(received) || 0);
  return `${sectorLabel} · ${formatPair(done)}/${formatPair(total)} recebidos`;
}

function formatPair(n: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);
}

/** Menor saldo conferido entre os jobs de rua do item. null = item sem Ateliê. */
export function atelierReceivedCap(receivedBySector: readonly number[] | null | undefined): number | null {
  if (!receivedBySector || receivedBySector.length === 0) return null;
  return Math.min(...receivedBySector.map((n) => Math.max(0, Number(n) || 0)));
}

/**
 * Quanto ainda pode ser apontado neste setor.
 * `cap` null = sem teto de Ateliê. Com teto, Colagem/Montagem/… não passam do saldo.
 */
export function pointingRemainingWithAtelierCap(input: {
  stageName: string;
  stageRemaining: number;
  inboundRemaining: number | null;
  alreadyProcessed: number;
  cap: number | null;
}): number {
  let remaining = Math.max(0, input.stageRemaining);
  if (input.inboundRemaining != null) {
    remaining = Math.min(remaining, Math.max(0, input.inboundRemaining));
  }
  if (input.cap == null) return remaining;
  if (!(ATELIER_DOWNSTREAM_STAGES as readonly string[]).includes(input.stageName)) return remaining;
  const room = Math.max(0, input.cap - Math.max(0, input.alreadyProcessed));
  return Math.min(remaining, room);
}

export function atelierCanRecordReceipt(job: {
  execution_mode?: AtelierExecutionMode | string | null;
  pipeline_status: string;
  pairs?: number | null;
  received_pairs?: number | null;
}): boolean {
  const remaining = atelierReceiptRemaining(Number(job.pairs) || 0, Number(job.received_pairs) || 0);
  if (remaining <= 0) return false;
  if (atelierEffectiveMode(job.execution_mode) === 'internal') {
    return job.pipeline_status === 'in_progress' || job.pipeline_status === 'partially_done';
  }
  return job.pipeline_status === 'sent_to_contractor'
    || job.pipeline_status === 'realized'
    || job.pipeline_status === 'partially_received';
}
