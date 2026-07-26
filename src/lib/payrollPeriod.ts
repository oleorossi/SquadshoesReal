// ─────────────────────────────────────────────────────────────────────────────
// Helpers do PERÍODO da folha (payroll_runs.period) — extraídos de Payroll.tsx
// pra serem compartilhados com a Ficha de Montadores (relatório de pagamento
// por produção). Encoding do período (UNIQUE employee_id+period no banco):
//   · mês cheio (01→último dia)  → "YYYY-MM"   (compat com folhas mensais antigas)
//   · qualquer outro intervalo   → "YYYY-MM-DD_YYYY-MM-DD"
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Último dia do mês "YYYY-MM" como "YYYY-MM-DD". */
export function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return '';
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/**
 * Chave/armazenamento do período em `payroll_runs.period` (UNIQUE employee_id+period):
 * mês cheio (01→último dia) vira "YYYY-MM" (compat com folhas mensais já gravadas);
 * qualquer outro intervalo vira "YYYY-MM-DD_YYYY-MM-DD".
 */
export function rangeToPeriod(from: string, to: string): string {
  if (!from || !to) return '';
  const fm = from.slice(0, 7);
  if (from.slice(8) === '01' && fm === to.slice(0, 7) && to === lastDayOfMonth(fm)) return fm;
  return `${from}_${to}`;
}

/** Inverso de rangeToPeriod: "YYYY-MM" ou "YYYY-MM-DD_YYYY-MM-DD" → {from, to}. */
export function periodToRange(period: string): { from: string; to: string } {
  if (/^\d{4}-\d{2}$/.test(period)) return { from: `${period}-01`, to: lastDayOfMonth(period) };
  const m = period.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (m) return { from: m[1], to: m[2] };
  return { from: '', to: '' };
}

/** Rótulo amigável: mês cheio → "mai/2026"; senão → "01/05–15/05/2026". */
export function payrollPeriodLabel(from: string, to: string): string {
  if (!from || !to) return '—';
  if (rangeToPeriod(from, to).length === 7) {
    const [y, m] = from.slice(0, 7).split('-').map(Number);
    return `${MONTHS_PT[m - 1]}/${y}`;
  }
  const dm = (d: string) => d.slice(8) + '/' + d.slice(5, 7);
  return `${dm(from)}–${dm(to)}/${to.slice(0, 4)}`;
}
