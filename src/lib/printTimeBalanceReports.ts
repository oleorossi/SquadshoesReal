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

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function outcomeLabel(minutes: number): string {
  if (minutes > 0) return 'PAGAR HORAS EXTRAS';
  if (minutes < 0) return 'DÉBITO DE HORAS';
  return 'COMPENSADO';
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
  const finalClass = report.finalPayableBalanceMinutes > 0
    ? 'positive-text'
    : report.finalPayableBalanceMinutes < 0 ? 'negative-text' : '';

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
    <div class="final-summary">
      <div><span>Pendências de horas</span><strong class="negative-text">${formatBalanceMinutes(-report.totalRawDebitMinutes)}</strong></div>
      <div><span>Horas extras</span><strong class="positive-text">${formatBalanceMinutes(report.totalRawCreditMinutes)}</strong></div>
      <div><span>Resultado final</span><strong class="${finalClass}">${formatBalanceMinutes(report.finalPayableBalanceMinutes)}</strong><small class="${finalClass}">${outcomeLabel(report.finalPayableBalanceMinutes)}</small></div>
      <div><span>Valor de HE a pagar</span><strong>${formatBRL(report.overtimeValue)}</strong><small>${formatBalanceMinutes(report.totalPayableOvertimeMinutes, false)} após compensação</small></div>
    </div>
    <p class="legend">Cada célula mostra: batidas · trabalhado/meta · saldo do dia. O fechamento é semanal; crédito e débito se compensam apenas dentro da mesma semana. Dias abonados e sem cobertura não geram débito.</p>
    ${report.overtimeRateMissing ? '<p class="rate-warning">Atenção: há hora extra a pagar sem taxa cadastrada.</p>' : ''}
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
    .final-summary { display:grid; grid-template-columns:repeat(4, 1fr); margin-top:6px; border:1px solid #777; }
    .final-summary > div { padding:5px 7px; border-right:1px solid #aaa; }
    .final-summary > div:last-child { border-right:0; }
    .final-summary span, .final-summary small { display:block; font-size:8px; text-transform:uppercase; color:#444; }
    .final-summary strong { display:block; margin-top:2px; font-size:14px; }
    .final-summary small { margin-top:2px; font-weight:700; }
    .rate-warning { margin-top:4px; font-size:8px; font-weight:700; color:#b45309; }
    @media print { .employee { break-inside:avoid; } .page-break { break-before:page; } }
  </style>${body}`;
}

export function buildTimeBalanceManagementHtml(
  reports: EmployeeTimeBalanceReport[],
  periodLabel: string,
): string {
  const salaryReports = reports.filter(report => report.paymentType === 'mensalista');
  const totalDebit = salaryReports.reduce((sum, report) => sum + report.totalRawDebitMinutes, 0);
  const totalCredit = salaryReports.reduce((sum, report) => sum + report.totalRawCreditMinutes, 0);
  const totalFinal = salaryReports.reduce((sum, report) => sum + report.finalPayableBalanceMinutes, 0);
  const totalValue = salaryReports.reduce((sum, report) => sum + report.overtimeValue, 0);

  const rows = reports.map((report) => {
    const applies = report.paymentType === 'mensalista';
    const finalClass = report.finalPayableBalanceMinutes > 0
      ? 'positive-text'
      : report.finalPayableBalanceMinutes < 0 ? 'negative-text' : '';
    const situation = applies ? outcomeLabel(report.finalPayableBalanceMinutes) : 'REGIME NÃO SEMANAL';
    return `<tr>
      <td><strong>${escapeHtml(report.name)}</strong></td>
      <td>${escapeHtml(report.department)}</td>
      <td class="number negative-text">${applies ? formatBalanceMinutes(-report.totalRawDebitMinutes) : '—'}</td>
      <td class="number positive-text">${applies ? formatBalanceMinutes(report.totalRawCreditMinutes) : '—'}</td>
      <td class="number">${applies ? formatBalanceMinutes(report.totalCompensatedMinutes, false) : '—'}</td>
      <td class="number ${finalClass}">${applies ? formatBalanceMinutes(report.finalPayableBalanceMinutes) : '—'}</td>
      <td class="status ${finalClass}">${situation}</td>
      <td class="number">${applies ? formatBalanceMinutes(report.totalPayableOvertimeMinutes, false) : '—'}</td>
      <td class="number">${applies ? formatBRL(report.overtimeValue) : '—'}${report.overtimeRateMissing ? '<small>taxa pendente</small>' : ''}</td>
    </tr>`;
  }).join('');

  return `<style>
    .management h1 { margin:0; font-size:20px; }
    .management .subtitle { margin:2px 0 8px; font-size:10px; color:#444; }
    .management-summary { display:grid; grid-template-columns:repeat(4,1fr); gap:5px; margin-bottom:8px; }
    .management-summary > div { border:1px solid #777; padding:6px 8px; }
    .management-summary span { display:block; font-size:8px; text-transform:uppercase; color:#444; }
    .management-summary strong { display:block; margin-top:2px; font-size:14px; }
    .management-table { width:100%; border-collapse:collapse; font-size:9px; }
    .management-table th { background:#1f2937; color:#fff; padding:5px; text-align:left; text-transform:uppercase; font-size:8px; }
    .management-table td { border:1px solid #aaa; padding:5px; }
    .management-table .number { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; font-weight:700; }
    .management-table .status { white-space:nowrap; font-size:8px; font-weight:800; }
    .management-table small { display:block; margin-top:2px; color:#b45309; font-weight:700; }
    .positive-text { color:#047857; }
    .negative-text { color:#b91c1c; }
    .management-note { margin-top:7px; font-size:8px; color:#333; }
    @media print { .management { break-inside:auto; } .management-table tr { break-inside:avoid; } }
  </style>
  <section class="management">
    <h1>Relatório gerência · saldo de horas</h1>
    <p class="subtitle">${escapeHtml(periodLabel)} · ${reports.length} funcionário(s) no período</p>
    <div class="management-summary">
      <div><span>Pendências de horas</span><strong class="negative-text">${formatBalanceMinutes(-totalDebit)}</strong></div>
      <div><span>Horas extras</span><strong class="positive-text">${formatBalanceMinutes(totalCredit)}</strong></div>
      <div><span>Resultado consolidado</span><strong class="${totalFinal > 0 ? 'positive-text' : totalFinal < 0 ? 'negative-text' : ''}">${formatBalanceMinutes(totalFinal)}</strong></div>
      <div><span>HE total a pagar</span><strong>${formatBRL(totalValue)}</strong></div>
    </div>
    <table class="management-table">
      <thead><tr><th>Funcionário</th><th>Setor</th><th>Pendências</th><th>Horas extras</th><th>Compensadas</th><th>Saldo final</th><th>Situação</th><th>HE a pagar</th><th>Valor HE</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="management-note">Pendências e horas extras são os valores brutos do período. O saldo final e o valor de HE vêm do mesmo cálculo usado pela Folha. Faltas de dia inteiro, adiantamentos e demais descontos aparecem no fechamento da folha e não são convertidos em horas nesta tabela.</p>
  </section>`;
}

export function printTimeBalanceReports(
  reports: EmployeeTimeBalanceReport[],
  kind: TimeBalanceReportKind,
  periodLabel: string,
): void {
  const title = kind === 'overtime' ? 'Horas extras' : 'Pendências semanais';
  printHtml(`${title} · ${periodLabel}`, buildTimeBalanceReportHtml(reports, kind, periodLabel), { landscape: true });
}

export function printTimeBalanceManagementReport(
  reports: EmployeeTimeBalanceReport[],
  periodLabel: string,
): void {
  printHtml(`Relatório gerência · ${periodLabel}`, buildTimeBalanceManagementHtml(reports, periodLabel), { landscape: true });
}
