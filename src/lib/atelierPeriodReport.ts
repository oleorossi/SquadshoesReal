/**
 * Resumo do período do Ateliê para a tela e para o CSV.
 * Os números vêm da função SQL atelier_period_report.
 */

export interface AtelierPeriodRow {
  side: 'internal' | 'contractor' | string;
  contractor_id: string | null;
  contractor_name: string | null;
  sent_pairs: number;
  received_pairs: number;
  pending_pairs: number;
  late_jobs: number;
  avg_lead_first_days: number | null;
  avg_lead_full_days: number | null;
  cost: number;
  done_pairs: number;
  defect_pairs: number;
  loss_pairs: number;
  defect_resolved_pairs: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizePeriodRow(raw: Record<string, unknown>): AtelierPeriodRow {
  return {
    side: String(raw.side ?? ''),
    contractor_id: raw.contractor_id ? String(raw.contractor_id) : null,
    contractor_name: raw.contractor_name ? String(raw.contractor_name) : null,
    sent_pairs: num(raw.sent_pairs),
    received_pairs: num(raw.received_pairs),
    pending_pairs: num(raw.pending_pairs),
    late_jobs: num(raw.late_jobs),
    avg_lead_first_days: raw.avg_lead_first_days == null ? null : num(raw.avg_lead_first_days),
    avg_lead_full_days: raw.avg_lead_full_days == null ? null : num(raw.avg_lead_full_days),
    cost: num(raw.cost),
    done_pairs: num(raw.done_pairs),
    defect_pairs: num(raw.defect_pairs),
    loss_pairs: num(raw.loss_pairs),
    defect_resolved_pairs: num(raw.defect_resolved_pairs),
  };
}

function csvCell(value: string | number | null): string {
  const text = value == null ? '' : String(value);
  if (/[;"\n]/.test(text)) return `"${text.split('"').join('""')}"`;
  return text;
}

export function atelierPeriodCsv(rows: readonly AtelierPeriodRow[]): string {
  const header = [
    'lado',
    'prestador',
    'pares enviados',
    'pares bons',
    'defeito pendente',
    'defeito retrabalhado',
    'perda',
    'pares a receber',
    'jobs atrasados',
    'lead até a primeira entrada (dias)',
    'lead até 100% (dias)',
    'custo',
    'pares concluídos na fábrica',
  ];
  const lines = rows.map((row) => [
    row.side === 'internal' ? 'interno' : 'prestador',
    row.side === 'internal' ? 'Interno' : (row.contractor_name ?? ''),
    row.sent_pairs,
    row.received_pairs,
    row.defect_pairs,
    row.defect_resolved_pairs,
    row.loss_pairs,
    row.pending_pairs,
    row.late_jobs,
    row.avg_lead_first_days,
    row.avg_lead_full_days,
    row.cost,
    row.done_pairs,
  ].map(csvCell).join(';'));
  return [header.join(';'), ...lines].join('\n');
}

export function periodLabel(row: AtelierPeriodRow): string {
  if (row.side === 'internal') return 'Interno';
  return row.contractor_name || 'Prestador sem nome';
}
