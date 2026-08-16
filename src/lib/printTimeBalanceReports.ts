import { escapeHtml } from '@/lib/htmlUtils';
import { printHtml } from '@/lib/printOrder';
import {
  formatBalanceMinutes,
  type EmployeeTimeBalanceReport,
  type TimeBalanceDay,
  type TimeBalanceReportKind,
} from '@/lib/ponto/timeBalanceReports';

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function formatDate(date: string): string {
  return date.split('-').reverse().join('/');
}

function daySlot(dayOfWeek: number): number {
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
}

function renderDay(day?: TimeBalanceDay): string {
  if (!day) return '<td class="day empty"></td>';
  const balance = day.balanceMinutes;
  const state = day.status === 'pending'
    ? 'pending'
    : balance > 0
      ? 'positive'
      : balance < 0
        ? 'negative'
        : 'neutral';
  const result = day.status === 'pending'
    ? 'Batida pendente'
    : day.status === 'excused'
      ? 'Abonado'
      : day.status === 'neutral'
        ? 'Folga'
        : formatBalanceMinutes(balance);
  const punches = day.punches.length > 2
    ? `${day.punches[0]} → ${day.punches[day.punches.length - 1]}`
    : day.punches.join(' · ') || '—';
  return `<td class="day ${state}">
    <div class="date">${formatDate(day.date).slice(0, 5)}</div>
    <div class="punches">${escapeHtml(punches)}</div>
    <div class="hours">${formatBalanceMinutes(day.workedMinutes, false)} / ${formatBalanceMinutes(day.expectedMinutes, false)}</div>
    <div class="balance">${escapeHtml(result)}</div>
  </td>`;
}

function renderEmployee(report: EmployeeTimeBalanceReport, kind: TimeBalanceReportKind, periodLabel: string, index: number): string {
  const relevantMinutes = kind === 'overtime' ? report.totalOvertimeMinutes : report.totalDeficitMinutes;
  const relevantWeeks = kind === 'overtime' ? report.overtimeWeeks : report.deficitWeeks;
  const weekRows = report.weeks.map(week => {
    const slots = Array.from<TimeBalanceDay | undefined>({ length: 7 });
    for (const day of week.days) slots[daySlot(day.dayOfWeek)] = day;
    const weekBalance = week.balanceMinutes === 0 ? '0h00' : formatBalanceMinutes(week.balanceMinutes);
    return `<tr>
      <th class="week-summary">
        <span>${formatDate(week.startDate).slice(0, 5)}–${formatDate(week.endDate).slice(0, 5)}</span>
        <small>${formatBalanceMinutes(week.workedMinutes, false)} de ${formatBalanceMinutes(week.expectedMinutes, false)}</small>
        <strong class="${week.balanceMinutes < 0 ? 'negative-text' : week.balanceMinutes > 0 ? 'positive-text' : ''}">${weekBalance}</strong>
      </th>
      ${slots.map(renderDay).join('')}
    </tr>`;
  }).join('');

  return `<section class="employee${index > 0 ? ' page-break' : ''}">
    <h1>${kind === 'overtime' ? 'Relatório de horas extras' : 'Relatório de pendências semanais'}</h1>
    <p class="subtitle">${escapeHtml(report.name)} · ${escapeHtml(report.department)} · ${escapeHtml(periodLabel)}</p>
    <div class="summary">
      <div><span>${kind === 'overtime' ? 'Horas extras' : 'Débito semanal'}</span><strong class="${kind === 'overtime' ? 'positive-text' : 'negative-text'}">${formatBalanceMinutes(kind === 'overtime' ? relevantMinutes : -relevantMinutes)}</strong></div>
      <div><span>Semanas no relatório</span><strong>${relevantWeeks}</strong></div>
      <div><span>Trabalhadas</span><strong>${formatBalanceMinutes(report.totalWorkedMinutes, false)}</strong></div>
      <div><span>Meta do período</span><strong>${formatBalanceMinutes(report.totalExpectedMinutes, false)}</strong></div>
      ${report.pendingPunchDays > 0 ? `<div><span>Batidas pendentes</span><strong class="pending-text">${report.pendingPunchDays}</strong></div>` : ''}
    </div>
    <table class="calendar">
      <thead><tr><th>Semana</th>${DAY_LABELS.map(label => `<th>${label}</th>`).join('')}</tr></thead>
      <tbody>${weekRows}</tbody>
    </table>
    <p class="legend">Cada célula mostra: batidas · trabalhado/meta · saldo do dia. O fechamento é semanal; crédito e débito se compensam apenas dentro da mesma semana. Dias abonados e sem cobertura não geram débito.</p>
  </section>`;
}

export function buildTimeBalanceReportHtml(
  reports: EmployeeTimeBalanceReport[],
  kind: TimeBalanceReportKind,
  periodLabel: string,
): string {
  const body = reports.map((report, index) => renderEmployee(report, kind, periodLabel, index)).join('');
  return `<style>
    .employee { break-inside: avoid; }
    .summary { display:flex; gap:5px; margin:6px 0; }
    .summary > div { flex:1; border:1px solid #777; padding:5px 7px; }
    .summary span { display:block; font-size:8px; text-transform:uppercase; color:#444; }
    .summary strong { display:block; margin-top:2px; font-size:13px; }
    .calendar { table-layout:fixed; }
    .calendar th, .calendar td { padding:3px; vertical-align:top; }
    .calendar thead th:first-child { width:13%; }
    .calendar thead th:not(:first-child) { width:12.42%; text-align:center; }
    .week-summary { background:#f3f4f6 !important; color:#111 !important; text-align:left; text-transform:none; }
    .week-summary span, .week-summary small, .week-summary strong { display:block; }
    .week-summary small { margin-top:3px; font-size:8px; font-weight:500; }
    .week-summary strong { margin-top:4px; font-size:12px; }
    .day { height:58px; }
    .day .date { font-size:8px; color:#555; }
    .day .punches { margin-top:2px; font-size:8px; font-weight:700; white-space:nowrap; }
    .day .hours { margin-top:2px; font-size:7px; color:#555; }
    .day .balance { margin-top:3px; font-size:10px; font-weight:800; }
    .day.positive { background:#ecfdf5; }
    .day.negative { background:#fef2f2; }
    .day.pending { background:#fffbeb; }
    .day.neutral, .day.empty { background:#f8fafc; color:#777; }
    .positive-text, .day.positive .balance { color:#047857; }
    .negative-text, .day.negative .balance { color:#b91c1c; }
    .pending-text, .day.pending .balance { color:#b45309; }
    .legend { margin-top:5px; font-size:8px; color:#333; }
    @media print { .employee { break-inside:avoid; } .page-break { break-before:page; } }
  </style>${body}`;
}

export function printTimeBalanceReports(
  reports: EmployeeTimeBalanceReport[],
  kind: TimeBalanceReportKind,
  periodLabel: string,
): void {
  const title = kind === 'overtime' ? 'Horas extras' : 'Pendências semanais';
  printHtml(`${title} · ${periodLabel}`, buildTimeBalanceReportHtml(reports, kind, periodLabel), { landscape: true });
}
