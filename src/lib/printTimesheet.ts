import { printHtml, writePrintWindow, openPrintWindow } from './printOrder';
import { calculateWeeklyPeriod } from './weeklyTimeCalculation';
import { escapeHtml } from './htmlUtils';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function minutesToDisplay(mins: number): string {
  const sign = mins < 0 ? '-' : '';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface EmployeeTimesheetData {
  name: string;
  days: {
    date: string;
    dayOfWeek: number;
    punches: string[];
    workedMinutes: number;
    expectedMinutes: number;
    overtimeMinutes: number;
    isHoliday: boolean;
    isAbsent: boolean;
    status: string;
  }[];
  schedule: {
    overtime_multiplier: number;
    holiday_multiplier: number;
    minimum_overtime_minutes?: number;
  };
  hourlySalary?: number;
  /** Per-employee overtime hourly rate (R$/hr). Overrides hourlySalary * multiplier when set. */
  overtimeHourlyRate?: number | null;
}

function calcEmployeeBalance(emp: EmployeeTimesheetData) {
  
  // Build a minimal schedule for the calculation
  const schedule = {
    tolerance_minutes: 10,
    weekly_hours: 44,
    ...emp.schedule,
  };
  
  const period = calculateWeeklyPeriod(emp.days, schedule);
  
  const totalWorked = period.totalWorkedMinutes;
  const totalExpected = period.totalExpectedMinutes;
  const absences = period.totalAbsences;
  const holidayWorked = emp.days.filter(d => d.isHoliday && d.workedMinutes > 0);

  // Weekly-based overtime
  const totalRawOvertime = period.totalOvertimeMinutes;
  const deficitMinutes = period.totalDeficitMinutes;
  const compensatedOvertime = Math.max(0, totalRawOvertime - deficitMinutes);
  const remainingDeficit = Math.max(0, deficitMinutes - totalRawOvertime);

  // Overtime days detail (for display purposes)
  const overtimeDays = emp.days.filter(d => d.overtimeMinutes > 0).map(d => ({
    date: d.date,
    dayOfWeek: d.dayOfWeek,
    punches: d.punches,
    overtime: d.overtimeMinutes,
    isHoliday: d.isHoliday,
  }));

  // Holiday overtime (double rate) — capped to compensated total
  const holidayOvertimeFull = holidayWorked.reduce((s, d) => s + d.workedMinutes, 0);
  const holidayOvertimeMinutes = Math.min(compensatedOvertime, holidayOvertimeFull);
  const normalOvertimeMinutes = Math.max(0, compensatedOvertime - holidayOvertimeMinutes);

  // Value calculation — use per-employee rate when configured
  const hourlyRate = emp.hourlySalary || 0;
  const hasCustomRate = emp.overtimeHourlyRate != null && emp.overtimeHourlyRate > 0;
  const effectiveOTRate = hasCustomRate
    ? emp.overtimeHourlyRate!
    : hourlyRate * emp.schedule.overtime_multiplier;
  const effectiveHolidayRate = hasCustomRate
    ? emp.overtimeHourlyRate! * (emp.schedule.holiday_multiplier / emp.schedule.overtime_multiplier)
    : hourlyRate * emp.schedule.holiday_multiplier;
  const normalOvertimeValue = (normalOvertimeMinutes / 60) * effectiveOTRate;
  const holidayOvertimeValue = (holidayOvertimeMinutes / 60) * effectiveHolidayRate;
  const totalOvertimeValue = normalOvertimeValue + holidayOvertimeValue;
  const deficitValue = (remainingDeficit / 60) * hourlyRate;

  return {
    totalWorked, totalExpected, totalRawOvertime, absences, deficitMinutes,
    compensatedOvertime, remainingDeficit, overtimeDays, holidayOvertimeMinutes,
    normalOvertimeMinutes, normalOvertimeValue, holidayOvertimeValue, totalOvertimeValue,
    deficitValue, holidayWorked: holidayWorked.length,
  };
}

function statusLabel(status: string): string {
  switch (status) {
    case 'normal': return '✓';
    case 'overtime': return '⏰ HE';
    case 'absent': return '✗ Falta';
    case 'holiday': return '🏖️ Feriado';
    case 'weekend': return '— Folga';
    case 'incomplete': return '⚠️ Incompleto';
    default: return '';
  }
}

// ── Individual Employee Report ──────────────────────
export function printEmployeeTimesheet(emp: EmployeeTimesheetData, periodLabel: string) {
  const bal = calcEmployeeBalance(emp);

  const daysRows = emp.days.map(d => `
    <tr class="${d.status === 'absent' ? 'absent-row' : d.status === 'overtime' ? 'overtime-row' : d.status === 'holiday' ? 'holiday-row' : ''}">
      <td class="mono">${new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td>${DAYS_PT[d.dayOfWeek]}</td>
      <td class="mono">${d.punches.join(' · ') || '—'}</td>
      <td class="text-right mono">${minutesToDisplay(d.workedMinutes)}</td>
      <td class="text-right mono" style="color:#111">${minutesToDisplay(d.expectedMinutes)}</td>
      <td class="text-right mono">${d.overtimeMinutes > 0 ? `<b style="color:#b45309">${minutesToDisplay(d.overtimeMinutes)}</b>` : '—'}</td>
      <td class="text-center">${statusLabel(d.status)}</td>
    </tr>
  `).join('');

  const overtimeDetailRows = bal.overtimeDays.map(d => `
    <tr>
      <td class="mono">${new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td>${DAYS_PT[d.dayOfWeek]}</td>
      <td class="mono">${d.punches.join(' · ')}</td>
      <td class="text-right mono"><b style="color:#b45309">${minutesToDisplay(d.overtime)}</b></td>
      <td class="text-center">${d.isHoliday ? 'Feriado' : 'Normal'}</td>
    </tr>
  `).join('');

  const formatMoney = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const html = `
    <h1>📋 Relatório de Ponto — ${escapeHtml(emp.name)}</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

    <h2>Resumo</h2>
    <div class="info-grid">
      <div><span class="label">Horas Trabalhadas:</span> ${minutesToDisplay(bal.totalWorked)}</div>
      <div><span class="label">Horas Esperadas:</span> ${minutesToDisplay(bal.totalExpected)}</div>
      <div><span class="label">Horas Extras Brutas:</span> <b style="color:#b45309">${minutesToDisplay(bal.totalRawOvertime)}</b></div>
      <div><span class="label">Déficit (atrasos + faltas):</span> <b style="color:#dc2626">${minutesToDisplay(bal.deficitMinutes)}</b></div>
      <div><span class="label">HE após compensar déficit:</span> <b style="color:#16a34a">${minutesToDisplay(bal.compensatedOvertime)}</b></div>
      <div><span class="label">Déficit restante:</span> ${bal.remainingDeficit > 0 ? `<b style="color:#dc2626">${minutesToDisplay(bal.remainingDeficit)}</b>` : '—'}</div>
      <div><span class="label">Faltas (dias):</span> ${bal.absences}</div>
      <div><span class="label">Feriados trabalhados:</span> ${bal.holidayWorked}</div>
    </div>

    ${emp.hourlySalary ? `
    <h2>Valores</h2>
    <div class="info-grid">
      <div><span class="label">Valor/hora:</span> ${formatMoney(emp.hourlySalary)}</div>
      <div><span class="label">HE Normal (${emp.schedule.overtime_multiplier}x):</span> ${minutesToDisplay(bal.normalOvertimeMinutes)} = <b>${formatMoney(bal.normalOvertimeValue)}</b></div>
      <div><span class="label">HE Feriado (${emp.schedule.holiday_multiplier}x):</span> ${minutesToDisplay(bal.holidayOvertimeMinutes)} = <b>${formatMoney(bal.holidayOvertimeValue)}</b></div>
      <div><span class="label">Total HE a pagar:</span> <b style="color:#16a34a;font-size:14px">${formatMoney(bal.totalOvertimeValue)}</b></div>
      ${bal.remainingDeficit > 0 ? `<div><span class="label">Desconto déficit (${minutesToDisplay(bal.remainingDeficit)}):</span> <b style="color:#dc2626">-${formatMoney(bal.deficitValue)}</b></div>` : ''}
      <div><span class="label">Saldo Líquido:</span> <b style="color:${bal.totalOvertimeValue - bal.deficitValue >= 0 ? '#16a34a' : '#dc2626'};font-size:14px">${bal.totalOvertimeValue - bal.deficitValue >= 0 ? '+' : ''}${formatMoney(bal.totalOvertimeValue - bal.deficitValue)}</b></div>
    </div>
    ` : ''}

    <h2>Registro Diário</h2>
    <table>
      <thead><tr>
        <th>Data</th><th>Dia</th><th>Batidas</th>
        <th class="text-right">Trabalhado</th><th class="text-right">Esperado</th>
        <th class="text-right">HE</th><th class="text-center">Status</th>
      </tr></thead>
      <tbody>${daysRows}
        <tr class="total-row">
          <td colspan="3">TOTAL</td>
          <td class="text-right mono">${minutesToDisplay(bal.totalWorked)}</td>
          <td class="text-right mono">${minutesToDisplay(bal.totalExpected)}</td>
          <td class="text-right mono" style="color:#b45309">${minutesToDisplay(bal.totalRawOvertime)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>

    ${bal.overtimeDays.length > 0 ? `
    <h2>Detalhamento de Horas Extras</h2>
    <table>
      <thead><tr>
        <th>Data</th><th>Dia</th><th>Batidas</th>
        <th class="text-right">HE</th><th class="text-center">Tipo</th>
      </tr></thead>
      <tbody>${overtimeDetailRows}
        <tr class="total-row">
          <td colspan="3">TOTAL HE BRUTA</td>
          <td class="text-right mono" style="color:#b45309">${minutesToDisplay(bal.totalRawOvertime)}</td>
          <td></td>
        </tr>
        <tr class="total-row">
          <td colspan="3">(-) Compensação déficit</td>
          <td class="text-right mono" style="color:#dc2626">-${minutesToDisplay(Math.min(bal.deficitMinutes, bal.totalRawOvertime))}</td>
          <td></td>
        </tr>
        <tr class="total-row" style="font-size:13px">
          <td colspan="3"><b>= HE LÍQUIDA A PAGAR</b></td>
          <td class="text-right mono" style="color:#16a34a"><b>${minutesToDisplay(bal.compensatedOvertime)}</b></td>
          <td></td>
        </tr>
      </tbody>
    </table>
    ` : ''}
  `;

  printHtml(`Ponto - ${emp.name}`, `
    <style>
      .absent-row td { background: #fecaca !important; color: #7f1d1d !important; font-weight: 700; }
      .overtime-row td { background: #fde68a !important; color: #78350f !important; font-weight: 700; }
      .holiday-row td { background: #bfdbfe !important; color: #1e3a8a !important; font-weight: 700; }
      tbody tr:nth-child(even).absent-row td,
      tbody tr:nth-child(even).overtime-row td,
      tbody tr:nth-child(even).holiday-row td { background-image: linear-gradient(rgba(0,0,0,0.03), rgba(0,0,0,0.03)); }
    </style>
    ${html}
  `);
}

// ── Save Individual Employee Report as PDF ──────────
export function saveEmployeeTimesheetPdf(emp: EmployeeTimesheetData, periodLabel: string) {
  const bal = calcEmployeeBalance(emp);
  const formatMoney = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const daysRows = emp.days.map(d => `
    <tr class="${d.status === 'absent' ? 'absent-row' : d.status === 'overtime' ? 'overtime-row' : d.status === 'holiday' ? 'holiday-row' : ''}">
      <td class="mono">${new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td>${DAYS_PT[d.dayOfWeek]}</td>
      <td class="mono">${d.punches.join(' · ') || '—'}</td>
      <td class="text-right mono">${minutesToDisplay(d.workedMinutes)}</td>
      <td class="text-right mono" style="color:#111">${minutesToDisplay(d.expectedMinutes)}</td>
      <td class="text-right mono">${d.overtimeMinutes > 0 ? `<b style="color:#b45309">${minutesToDisplay(d.overtimeMinutes)}</b>` : '—'}</td>
      <td class="text-center">${statusLabel(d.status)}</td>
    </tr>
  `).join('');

  const overtimeDetailRows = bal.overtimeDays.map(d => `
    <tr>
      <td class="mono">${new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td>${DAYS_PT[d.dayOfWeek]}</td>
      <td class="mono">${d.punches.join(' · ')}</td>
      <td class="text-right mono"><b style="color:#b45309">${minutesToDisplay(d.overtime)}</b></td>
      <td class="text-center">${d.isHoliday ? 'Feriado' : 'Normal'}</td>
    </tr>
  `).join('');

  const html = `
    <style>
      .absent-row td { background: #fecaca !important; color: #7f1d1d !important; font-weight: 700; }
      .overtime-row td { background: #fde68a !important; color: #78350f !important; font-weight: 700; }
      .holiday-row td { background: #bfdbfe !important; color: #1e3a8a !important; font-weight: 700; }
    </style>
    <h1>📋 Relatório de Ponto — ${escapeHtml(emp.name)}</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · Gerado em ${new Date().toLocaleString('pt-BR')}</p>

    <h2>Resumo</h2>
    <div class="info-grid">
      <div><span class="label">Horas Trabalhadas:</span> ${minutesToDisplay(bal.totalWorked)}</div>
      <div><span class="label">Horas Esperadas:</span> ${minutesToDisplay(bal.totalExpected)}</div>
      <div><span class="label">Horas Extras Brutas:</span> <b style="color:#b45309">${minutesToDisplay(bal.totalRawOvertime)}</b></div>
      <div><span class="label">Déficit (atrasos + faltas):</span> <b style="color:#dc2626">${minutesToDisplay(bal.deficitMinutes)}</b></div>
      <div><span class="label">HE após compensar déficit:</span> <b style="color:#16a34a">${minutesToDisplay(bal.compensatedOvertime)}</b></div>
      <div><span class="label">Déficit restante:</span> ${bal.remainingDeficit > 0 ? `<b style="color:#dc2626">${minutesToDisplay(bal.remainingDeficit)}</b>` : '—'}</div>
      <div><span class="label">Faltas (dias):</span> ${bal.absences}</div>
      <div><span class="label">Feriados trabalhados:</span> ${bal.holidayWorked}</div>
    </div>

    ${emp.hourlySalary ? `
    <h2>Valores</h2>
    <div class="info-grid">
      <div><span class="label">Valor/hora:</span> ${formatMoney(emp.hourlySalary)}</div>
      <div><span class="label">HE Normal (${emp.schedule.overtime_multiplier}x):</span> ${minutesToDisplay(bal.normalOvertimeMinutes)} = <b>${formatMoney(bal.normalOvertimeValue)}</b></div>
      <div><span class="label">HE Feriado (${emp.schedule.holiday_multiplier}x):</span> ${minutesToDisplay(bal.holidayOvertimeMinutes)} = <b>${formatMoney(bal.holidayOvertimeValue)}</b></div>
      <div><span class="label">Total HE a pagar:</span> <b style="color:#16a34a;font-size:14px">${formatMoney(bal.totalOvertimeValue)}</b></div>
      ${bal.remainingDeficit > 0 ? `<div><span class="label">Desconto déficit (${minutesToDisplay(bal.remainingDeficit)}):</span> <b style="color:#dc2626">-${formatMoney(bal.deficitValue)}</b></div>` : ''}
      <div><span class="label">Saldo Líquido:</span> <b style="color:${bal.totalOvertimeValue - bal.deficitValue >= 0 ? '#16a34a' : '#dc2626'};font-size:14px">${bal.totalOvertimeValue - bal.deficitValue >= 0 ? '+' : ''}${formatMoney(bal.totalOvertimeValue - bal.deficitValue)}</b></div>
    </div>
    ` : ''}

    <h2>Registro Diário</h2>
    <table>
      <thead><tr>
        <th>Data</th><th>Dia</th><th>Batidas</th>
        <th class="text-right">Trabalhado</th><th class="text-right">Esperado</th>
        <th class="text-right">HE</th><th class="text-center">Status</th>
      </tr></thead>
      <tbody>${daysRows}
        <tr class="total-row">
          <td colspan="3">TOTAL</td>
          <td class="text-right mono">${minutesToDisplay(bal.totalWorked)}</td>
          <td class="text-right mono">${minutesToDisplay(bal.totalExpected)}</td>
          <td class="text-right mono" style="color:#b45309">${minutesToDisplay(bal.totalRawOvertime)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>

    ${bal.overtimeDays.length > 0 ? `
    <h2>Detalhamento de Horas Extras</h2>
    <table>
      <thead><tr>
        <th>Data</th><th>Dia</th><th>Batidas</th>
        <th class="text-right">HE</th><th class="text-center">Tipo</th>
      </tr></thead>
      <tbody>${overtimeDetailRows}
        <tr class="total-row">
          <td colspan="3">TOTAL HE BRUTA</td>
          <td class="text-right mono" style="color:#b45309">${minutesToDisplay(bal.totalRawOvertime)}</td>
          <td></td>
        </tr>
        <tr class="total-row">
          <td colspan="3">(-) Compensação déficit</td>
          <td class="text-right mono" style="color:#dc2626">-${minutesToDisplay(Math.min(bal.deficitMinutes, bal.totalRawOvertime))}</td>
          <td></td>
        </tr>
        <tr class="total-row" style="font-size:13px">
          <td colspan="3"><b>= HE LÍQUIDA A PAGAR</b></td>
          <td class="text-right mono" style="color:#16a34a"><b>${minutesToDisplay(bal.compensatedOvertime)}</b></td>
          <td></td>
        </tr>
      </tbody>
    </table>
    ` : ''}
  `;

  const title = `Ponto - ${emp.name}`;
  const win = openPrintWindow(title);
  writePrintWindow(win, title, html);
}

// ── Print All Individual Reports (one per page) ──────
export function printAllIndividualTimesheets(employees: EmployeeTimesheetData[], periodLabel: string) {
  const pages = employees.map((emp, idx) => {
    const bal = calcEmployeeBalance(emp);
    const formatMoney = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

    const daysRows = emp.days.map(d => `
      <tr class="${d.status === 'absent' ? 'absent-row' : d.status === 'overtime' ? 'overtime-row' : d.status === 'holiday' ? 'holiday-row' : ''}">
        <td class="mono">${new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
        <td>${DAYS_PT[d.dayOfWeek]}</td>
        <td class="mono">${d.punches.join(' · ') || '—'}</td>
        <td class="text-right mono">${minutesToDisplay(d.workedMinutes)}</td>
        <td class="text-right mono" style="color:#111">${minutesToDisplay(d.expectedMinutes)}</td>
        <td class="text-right mono">${d.overtimeMinutes > 0 ? `<b style="color:#b45309">${minutesToDisplay(d.overtimeMinutes)}</b>` : '—'}</td>
        <td class="text-center">${statusLabel(d.status)}</td>
      </tr>
    `).join('');

    const overtimeDetailRows = bal.overtimeDays.map(d => `
      <tr>
        <td class="mono">${new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
        <td>${DAYS_PT[d.dayOfWeek]}</td>
        <td class="mono">${d.punches.join(' · ')}</td>
        <td class="text-right mono"><b style="color:#b45309">${minutesToDisplay(d.overtime)}</b></td>
        <td class="text-center">${d.isHoliday ? 'Feriado' : 'Normal'}</td>
      </tr>
    `).join('');

    return `
      ${idx > 0 ? '<div style="page-break-before:always"></div>' : ''}
      <h1>📋 Relatório de Ponto — ${escapeHtml(emp.name)}</h1>
      <p class="subtitle">Período: ${escapeHtml(periodLabel)} · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

      <h2>Resumo</h2>
      <div class="info-grid">
        <div><span class="label">Horas Trabalhadas:</span> ${minutesToDisplay(bal.totalWorked)}</div>
        <div><span class="label">Horas Esperadas:</span> ${minutesToDisplay(bal.totalExpected)}</div>
        <div><span class="label">Horas Extras:</span> <b style="color:#b45309">${minutesToDisplay(bal.totalRawOvertime)}</b></div>
        <div><span class="label">Déficit:</span> ${bal.deficitMinutes > 0 ? `<b style="color:#dc2626">${minutesToDisplay(bal.deficitMinutes)}</b>` : '—'}</div>
        <div><span class="label">Faltas (dias):</span> ${bal.absences}</div>
        <div><span class="label">Feriados trabalhados:</span> ${bal.holidayWorked}</div>
      </div>

      ${emp.hourlySalary ? `
      <h2>Valores</h2>
      <div class="info-grid">
        <div><span class="label">Valor/hora:</span> ${formatMoney(emp.hourlySalary)}</div>
        <div><span class="label">HE Normal (${emp.schedule.overtime_multiplier}x):</span> ${minutesToDisplay(bal.normalOvertimeMinutes)} = <b>${formatMoney(bal.normalOvertimeValue)}</b></div>
        <div><span class="label">HE Feriado (${emp.schedule.holiday_multiplier}x):</span> ${minutesToDisplay(bal.holidayOvertimeMinutes)} = <b>${formatMoney(bal.holidayOvertimeValue)}</b></div>
        <div><span class="label">Total HE a pagar:</span> <b style="color:#16a34a;font-size:14px">${formatMoney(bal.totalOvertimeValue)}</b></div>
        ${bal.remainingDeficit > 0 ? `<div><span class="label">Desconto déficit:</span> <b style="color:#dc2626">-${formatMoney(bal.deficitValue)}</b></div>` : ''}
        <div><span class="label">Total Líquido:</span> <b style="color:${bal.totalOvertimeValue - bal.deficitValue >= 0 ? '#16a34a' : '#dc2626'};font-size:14px">${bal.totalOvertimeValue - bal.deficitValue >= 0 ? '+' : ''}${formatMoney(bal.totalOvertimeValue - bal.deficitValue)}</b></div>
      </div>
      ` : ''}

      <h2>Registro Diário</h2>
      <table>
        <thead><tr>
          <th>Data</th><th>Dia</th><th>Batidas</th>
          <th class="text-right">Trabalhado</th><th class="text-right">Esperado</th>
          <th class="text-right">HE</th><th class="text-center">Status</th>
        </tr></thead>
        <tbody>${daysRows}
          <tr class="total-row">
            <td colspan="3">TOTAL</td>
            <td class="text-right mono">${minutesToDisplay(bal.totalWorked)}</td>
            <td class="text-right mono">${minutesToDisplay(bal.totalExpected)}</td>
            <td class="text-right mono" style="color:#b45309">${minutesToDisplay(bal.totalRawOvertime)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      ${bal.overtimeDays.length > 0 ? `
      <h2>Detalhamento de Horas Extras</h2>
      <table>
        <thead><tr>
          <th>Data</th><th>Dia</th><th>Batidas</th>
          <th class="text-right">HE</th><th class="text-center">Tipo</th>
        </tr></thead>
        <tbody>${overtimeDetailRows}
          <tr class="total-row">
            <td colspan="3">TOTAL HE</td>
            <td class="text-right mono" style="color:#b45309">${minutesToDisplay(bal.totalRawOvertime)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      ` : ''}
    `;
  });

  printHtml(`Relatórios Individuais de Ponto`, `
    <style>
      .absent-row td { background: #fecaca !important; color: #7f1d1d !important; font-weight: 700; }
      .overtime-row td { background: #fde68a !important; color: #78350f !important; font-weight: 700; }
      .holiday-row td { background: #bfdbfe !important; color: #1e3a8a !important; font-weight: 700; }
    </style>
    ${pages.join('')}
  `);
}

// ── Relatório Consolidado Simples ─────────────────────────────────────
// Tabela enxuta focada nas 3 grandezas que o RH/gestor olha primeiro:
//   ESPERADO · TRABALHADO · HE · FALTAS
// Sem custos/valores — pra audit visual rápido sobre o período.
// User pediu 22/05/2026: "quantidade esperada x quantidade trabalhada x
// quantidade de hora extra por funcionário".
export function printConsolidatedHoursReport(employees: EmployeeTimesheetData[], periodLabel: string) {
  const allBalances = employees.map(emp => ({
    name: emp.name,
    ...calcEmployeeBalance(emp),
  }));

  const rows = allBalances.map(b => {
    const balance = b.totalWorked - b.totalExpected; // saldo simples (positivo = trabalhou mais)
    const adherencePct = b.totalExpected > 0
      ? Math.round((b.totalWorked / b.totalExpected) * 100)
      : 100;
    const adherenceColor =
      adherencePct >= 95 ? '#16a34a' :
      adherencePct >= 80 ? '#b45309' :
      '#dc2626';
    return `
      <tr>
        <td class="emp-name">${escapeHtml(b.name)}</td>
        <td class="text-right mono">${minutesToDisplay(b.totalExpected)}</td>
        <td class="text-right mono"><b>${minutesToDisplay(b.totalWorked)}</b></td>
        <td class="text-right mono">${b.totalRawOvertime > 0 ? `<b style="color:#16a34a">${minutesToDisplay(b.totalRawOvertime)}</b>` : '—'}</td>
        <td class="text-right mono">${b.deficitMinutes > 0 ? `<span style="color:#dc2626">${minutesToDisplay(b.deficitMinutes)}</span>` : '—'}</td>
        <td class="text-right mono" style="color:${balance >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${balance >= 0 ? '+' : ''}${minutesToDisplay(balance)}</td>
        <td class="text-center">${b.absences > 0 ? `<b style="color:#dc2626">${b.absences}</b>` : '—'}</td>
        <td class="text-center" style="color:${adherenceColor};font-weight:700">${adherencePct}%</td>
      </tr>
    `;
  }).join('');

  const totExpected = allBalances.reduce((s, b) => s + b.totalExpected, 0);
  const totWorked = allBalances.reduce((s, b) => s + b.totalWorked, 0);
  const totOT = allBalances.reduce((s, b) => s + b.totalRawOvertime, 0);
  const totDeficit = allBalances.reduce((s, b) => s + b.deficitMinutes, 0);
  const totAbsences = allBalances.reduce((s, b) => s + b.absences, 0);
  const overallBalance = totWorked - totExpected;
  const overallAdherence = totExpected > 0 ? Math.round((totWorked / totExpected) * 100) : 100;

  const html = `
    <h1>📊 Relatório Consolidado de Horas</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · ${employees.length} funcionários · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

    <div style="display:flex;gap:6px;margin:6px 0;flex-wrap:wrap">
      <div class="summary-card">
        <div class="sc-label">Horas Esperadas</div>
        <div class="sc-value">${minutesToDisplay(totExpected)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Horas Trabalhadas</div>
        <div class="sc-value" style="color:#000">${minutesToDisplay(totWorked)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Hora Extra</div>
        <div class="sc-value" style="color:#16a34a">${minutesToDisplay(totOT)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Déficit</div>
        <div class="sc-value" style="color:#dc2626">${minutesToDisplay(totDeficit)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Saldo</div>
        <div class="sc-value" style="color:${overallBalance >= 0 ? '#16a34a' : '#dc2626'}">${overallBalance >= 0 ? '+' : ''}${minutesToDisplay(overallBalance)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Aderência Geral</div>
        <div class="sc-value">${overallAdherence}%</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Faltas</div>
        <div class="sc-value" style="color:#dc2626">${totAbsences}</div>
      </div>
    </div>

    <h2>Detalhamento por Funcionário</h2>
    <table>
      <thead><tr>
        <th>Funcionário</th>
        <th class="text-right">Esperado</th>
        <th class="text-right">Trabalhado</th>
        <th class="text-right">Hora Extra</th>
        <th class="text-right">Déficit</th>
        <th class="text-right">Saldo</th>
        <th class="text-center">Faltas</th>
        <th class="text-center">Aderência</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="total-row" style="font-size:12px">
          <td><b>TOTAL</b></td>
          <td class="text-right mono"><b>${minutesToDisplay(totExpected)}</b></td>
          <td class="text-right mono"><b>${minutesToDisplay(totWorked)}</b></td>
          <td class="text-right mono" style="color:#16a34a"><b>${minutesToDisplay(totOT)}</b></td>
          <td class="text-right mono" style="color:#dc2626"><b>${minutesToDisplay(totDeficit)}</b></td>
          <td class="text-right mono" style="color:${overallBalance >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${overallBalance >= 0 ? '+' : ''}${minutesToDisplay(overallBalance)}</td>
          <td class="text-center" style="color:#dc2626"><b>${totAbsences}</b></td>
          <td class="text-center"><b>${overallAdherence}%</b></td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:16px;font-size:10px;color:#222;line-height:1.5">
      <b>Como ler:</b>
      <b>Esperado</b> = horas contratuais do período (calculado a partir do horário individual de cada funcionário) ·
      <b>Trabalhado</b> = soma das batidas confirmadas (dias incompletos não entram) ·
      <b>Hora Extra</b> = excedente trabalhado acima do esperado (regra CLT semanal) ·
      <b>Déficit</b> = atrasos + faltas ·
      <b>Saldo</b> = Trabalhado − Esperado (positivo = a favor do funcionário) ·
      <b>Aderência</b> = Trabalhado ÷ Esperado · ≥95% verde, 80-94% âmbar, &lt;80% vermelho.
    </div>
  `;

  printHtml('Relatório Consolidado de Horas', `
    <style>
      .summary-card { border: 1.5px solid #000; border-radius: 4px; padding: 6px 10px; min-width: 110px; background: #f9fafb; }
      .sc-label { font-size: 9px; text-transform: uppercase; color: #000; letter-spacing: 0.4px; font-weight: 800; }
      .sc-value { font-size: 16px; font-weight: 800; font-family: 'SFMono-Regular', 'Courier New', monospace; color: #000; font-variant-numeric: tabular-nums; }
      .emp-name { font-weight: 700; color: #000; }
      tr { page-break-inside: avoid; }
      tbody tr:nth-child(even) td { background: #f3f4f6 !important; }
      .total-row td { background: #fde68a !important; border-top: 2px solid #000 !important; }
      @page { size: A4 portrait; margin: 10mm 8mm; }
    </style>
    ${html}
  `);
}

// ── General All-Employees Report ──────────────────────
export function printAllEmployeesTimesheet(employees: EmployeeTimesheetData[], periodLabel: string) {
  const allBalances = employees.map(emp => ({
    name: emp.name,
    ...calcEmployeeBalance(emp),
    hourlySalary: emp.hourlySalary || 0,
  }));

  const formatMoney = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const rows = allBalances.map(b => `
    <tr>
      <td class="emp-name">${escapeHtml(b.name)}</td>
      <td class="text-right mono">${minutesToDisplay(b.totalWorked)}</td>
      <td class="text-right mono" style="color:#111">${minutesToDisplay(b.totalExpected)}</td>
      <td class="text-right mono">${b.totalRawOvertime > 0 ? `<span style="color:#b45309">${minutesToDisplay(b.totalRawOvertime)}</span>` : '—'}</td>
      <td class="text-right mono">${b.deficitMinutes > 0 ? `<span style="color:#dc2626">${minutesToDisplay(b.deficitMinutes)}</span>` : '—'}</td>
      <td class="text-right mono">${b.compensatedOvertime > 0 ? `<b style="color:#16a34a">${minutesToDisplay(b.compensatedOvertime)}</b>` : '—'}</td>
      <td class="text-right mono">${b.remainingDeficit > 0 ? `<span style="color:#dc2626">${minutesToDisplay(b.remainingDeficit)}</span>` : '—'}</td>
      <td class="text-center">${b.absences > 0 ? `<b style="color:#dc2626">${b.absences}</b>` : '—'}</td>
      <td class="text-right mono">${b.totalOvertimeValue > 0 ? `<b style="color:#16a34a">${formatMoney(b.totalOvertimeValue)}</b>` : '—'}</td>
      <td class="text-right mono">${b.remainingDeficit > 0 ? (b.hourlySalary > 0 ? `<span style="color:#dc2626">-${formatMoney(b.deficitValue)}</span>` : `<span style="color:#dc2626">N/D (sem salário)</span>`) : '—'}</td>
      <td class="text-right mono" style="color:${b.totalOvertimeValue - b.deficitValue >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${b.hourlySalary > 0 ? (b.totalOvertimeValue - b.deficitValue >= 0 ? '' : '-') + formatMoney(Math.abs(b.totalOvertimeValue - b.deficitValue)) : 'N/D'}</td>
    </tr>
  `).join('');

  const totWorked = allBalances.reduce((s, b) => s + b.totalWorked, 0);
  const totExpected = allBalances.reduce((s, b) => s + b.totalExpected, 0);
  const totOTRaw = allBalances.reduce((s, b) => s + b.totalRawOvertime, 0);
  const totDeficit = allBalances.reduce((s, b) => s + b.deficitMinutes, 0);
  const totOTCompensated = allBalances.reduce((s, b) => s + b.compensatedOvertime, 0);
  const totRemDeficit = allBalances.reduce((s, b) => s + b.remainingDeficit, 0);
  const totAbsences = allBalances.reduce((s, b) => s + b.absences, 0);
  const totOTValue = allBalances.reduce((s, b) => s + b.totalOvertimeValue, 0);
  const totDeficitValue = allBalances.reduce((s, b) => s + b.deficitValue, 0);

  const html = `
    <h1>📊 Relatório Geral de Ponto</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · ${employees.length} funcionários · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

    <div style="display:flex;gap:6px;margin:4px 0;flex-wrap:wrap">
      <div class="summary-card">
        <div class="sc-label">Total Trabalhado</div>
        <div class="sc-value">${minutesToDisplay(totWorked)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Total Esperado</div>
        <div class="sc-value">${minutesToDisplay(totExpected)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">HE Brutas</div>
        <div class="sc-value" style="color:#b45309">${minutesToDisplay(totOTRaw)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">HE Líquidas</div>
        <div class="sc-value" style="color:#16a34a">${minutesToDisplay(totOTCompensated)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Valor HE</div>
        <div class="sc-value" style="color:#16a34a">${formatMoney(totOTValue)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Faltas</div>
        <div class="sc-value" style="color:#dc2626">${totAbsences}</div>
      </div>
    </div>

    <h2>Detalhamento por Funcionário</h2>
    <table>
      <thead><tr>
        <th>Funcionário</th>
        <th class="text-right">Trab.</th>
        <th class="text-right">Esper.</th>
        <th class="text-right">HE Bruta</th>
        <th class="text-right">Déficit</th>
        <th class="text-right">HE Líquida</th>
        <th class="text-right">Déf. Rest.</th>
        <th class="text-center">Faltas</th>
        <th class="text-right">Valor HE</th>
        <th class="text-right">Desc.</th>
        <th class="text-right">Total</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="total-row" style="font-size:12px">
          <td><b>TOTAL</b></td>
          <td class="text-right mono">${minutesToDisplay(totWorked)}</td>
          <td class="text-right mono">${minutesToDisplay(totExpected)}</td>
          <td class="text-right mono" style="color:#b45309">${minutesToDisplay(totOTRaw)}</td>
          <td class="text-right mono" style="color:#dc2626">${minutesToDisplay(totDeficit)}</td>
          <td class="text-right mono" style="color:#16a34a"><b>${minutesToDisplay(totOTCompensated)}</b></td>
          <td class="text-right mono">${minutesToDisplay(totRemDeficit)}</td>
          <td class="text-center" style="color:#dc2626"><b>${totAbsences}</b></td>
          <td class="text-right mono" style="color:#16a34a"><b>${formatMoney(totOTValue)}</b></td>
          <td class="text-right mono" style="color:#dc2626">${totDeficitValue > 0 ? `-${formatMoney(totDeficitValue)}` : '—'}</td>
          <td class="text-right mono" style="color:${totOTValue - totDeficitValue >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${totOTValue - totDeficitValue >= 0 ? '' : '-'}${formatMoney(Math.abs(totOTValue - totDeficitValue))}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:16px;font-size:10px;color:#222;font-weight:700">
      <b>Legenda:</b> HE Bruta = total de horas extras sem compensação · Déficit = atrasos + faltas ·
      HE Líquida = HE após descontar déficit · Déf. Rest. = déficit não coberto pelas HE ·
      Valor HE = valor a pagar pelas HE líquidas (multiplicadores aplicados) ·
      Desc. = desconto referente ao déficit restante
    </div>
  `;

  printHtml('Relatório Geral de Ponto', `
    <style>
      .summary-card { border: 1.5px solid #000; border-radius: 4px; padding: 6px 10px; min-width: 100px; background: #f9fafb; }
      .sc-label { font-size: 9px; text-transform: uppercase; color: #000; letter-spacing: 0.4px; font-weight: 800; }
      .sc-value { font-size: 15px; font-weight: 800; font-family: 'SFMono-Regular', 'Courier New', monospace; color: #000; font-variant-numeric: tabular-nums; }
      .emp-name { font-weight: 700; color: #000; }
      tr { page-break-inside: avoid; }
      tbody tr:nth-child(even) td { background: #f3f4f6 !important; }
      @page { size: A4 landscape; margin: 8mm 8mm; }
    </style>
    ${html}
  `);
}

// ── Individual Calendar Report — Single employee, all punches by day (landscape A4) ──
export function printIndividualCalendarReport(emp: EmployeeTimesheetData, periodLabel: string) {
  if (emp.days.length === 0) return;

  const allDates = emp.days.map(d => d.date).sort();
  const balance = calcEmployeeBalance(emp);

  // chunk into weeks of 7
  const weeks: string[][] = [];
  for (let i = 0; i < allDates.length; i += 7) {
    weeks.push(allDates.slice(i, i + 7));
  }

  const dayMap = new Map(emp.days.map(d => [d.date, d]));

  const sections = weeks.map((weekDates, wi) => {
    const headerCells = weekDates.map(d => {
      const dt = new Date(d + 'T12:00:00');
      const dow = DAYS_PT[dt.getDay()];
      const dayNum = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      return `<th style="min-width:110px;font-size:12px;font-weight:800;padding:7px 4px;color:#fff !important;${isWeekend ? 'background:#374151 !important;' : ''}">${dow}<br/>${dayNum}</th>`;
    }).join('');

    const cells = weekDates.map(d => {
      const day = dayMap.get(d);
      if (!day) return '<td style="text-align:center;color:#000;font-weight:700;font-size:13px;vertical-align:top;padding:6px">—</td>';
      const dt = new Date(d + 'T12:00:00');
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      const bgColor = day.status === 'absent' ? '#fecaca'
        : day.status === 'overtime' ? '#fde68a'
        : day.status === 'holiday' ? '#bfdbfe'
        : isWeekend ? '#e5e7eb' : '';
      const punchesStr = day.punches.length > 0
        ? day.punches.map(p => `<div style="font-family:'Courier New',monospace;font-size:14px;font-weight:800;color:#000">${p}</div>`).join('')
        : '<span style="color:#000;font-weight:700;font-size:13px">—</span>';
      const workedStr = day.workedMinutes > 0
        ? `<div style="font-size:12px;color:#000;font-weight:700;margin-top:3px;font-family:'Courier New',monospace;border-top:1.5px solid #000;padding-top:3px">Trab: ${minutesToDisplay(day.workedMinutes)}</div>`
        : '';
      const expectedStr = day.expectedMinutes > 0
        ? `<div style="font-size:11px;color:#1f2937;font-weight:600;font-family:'Courier New',monospace">Esp: ${minutesToDisplay(day.expectedMinutes)}</div>`
        : '';
      const overtimeStr = day.overtimeMinutes > 0
        ? `<div style="font-size:12px;color:#7c2d12;font-weight:800;font-family:'Courier New',monospace">+${minutesToDisplay(day.overtimeMinutes)}</div>`
        : '';
      const statusLabel = day.status === 'absent' ? '<div style="font-size:11px;color:#7f1d1d;font-weight:800">FALTA</div>'
        : day.isHoliday ? '<div style="font-size:11px;color:#1e3a8a;font-weight:800">FERIADO</div>'
        : '';
      return `<td style="text-align:center;vertical-align:top;padding:5px 4px;${bgColor ? `background:${bgColor};` : ''}">${statusLabel}${punchesStr}${workedStr}${expectedStr}${overtimeStr}</td>`;
    }).join('');

    return `
      <h3 style="margin:8px 0 4px;font-size:13px;color:#000;font-weight:800;page-break-after:avoid">Semana ${wi + 1} — ${weekDates[0].split('-').reverse().join('/')} a ${weekDates[weekDates.length - 1].split('-').reverse().join('/')}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:12px;page-break-inside:avoid;margin-bottom:4px">
        <thead><tr><th style="width:100%;font-size:11px;font-weight:800;padding:5px 6px;text-align:left;color:#fff !important;background:#1f2937 !important">Batidas</th>${headerCells}</tr></thead>
        <tbody><tr><td style="font-weight:800;font-size:12px;color:#000;padding:4px 6px;vertical-align:top;background:#f3f4f6">${escapeHtml(emp.name)}</td>${cells}</tbody>
      </table>
    `;
  }).join('');

  const html = `
    <h1 style="font-size:18px;margin-bottom:2px;color:#000;font-weight:900">📅 Calendário Individual — ${escapeHtml(emp.name)}</h1>
    <p class="subtitle" style="margin-bottom:4px;font-size:12px;color:#000;font-weight:600">Período: ${escapeHtml(periodLabel)} · ${allDates.length} dias · Impresso em ${new Date().toLocaleString('pt-BR')}</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 6px">
      <div class="summary-card"><div class="sc-label">Trabalhado</div><div class="sc-value">${minutesToDisplay(balance.totalWorked)}</div></div>
      <div class="summary-card"><div class="sc-label">Esperado</div><div class="sc-value">${minutesToDisplay(balance.totalExpected)}</div></div>
      <div class="summary-card"><div class="sc-label">HE Líquida</div><div class="sc-value" style="color:#14532d">${minutesToDisplay(balance.compensatedOvertime)}</div></div>
      <div class="summary-card"><div class="sc-label">Faltas</div><div class="sc-value" style="color:#7f1d1d">${balance.absences}</div></div>
    </div>
    ${sections}
    <div style="margin-top:5px;font-size:11px;color:#000;font-weight:700">
      <b>Legenda:</b> 🟡 HE · 🔴 Falta · 🔵 Feriado · Cinza = fim de semana
    </div>
  `;

  printHtml(`Calendário — ${emp.name}`, `
    <style>
      body { color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      table { border: 2px solid #000; }
      th, td { border: 1px solid #000; color: #000; }
      th { background: #1f2937 !important; color: #fff !important; font-weight: 800; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .summary-card { border: 2px solid #000; border-radius: 4px; padding: 7px 12px; min-width: 110px; background: #f3f4f6; }
      .sc-label { font-size: 10px; text-transform: uppercase; color: #000; letter-spacing: 0.4px; font-weight: 800; }
      .sc-value { font-size: 17px; font-weight: 900; font-family: 'SFMono-Regular', 'Courier New', monospace; color: #000; font-variant-numeric: tabular-nums; }
      @page { size: A4 landscape; margin: 8mm 8mm; }
    </style>
    ${html}
  `);
}

// ── Calendar Report — All employees, all punches by day ──────────
export function printCalendarReport(allData: EmployeeTimesheetData[], periodLabel: string) {
  if (allData.length === 0) return;

  // Collect all unique dates across all employees
  const allDatesSet = new Set<string>();
  allData.forEach(emp => emp.days.forEach(d => allDatesSet.add(d.date)));
  const allDates = [...allDatesSet].sort();

  // Build a lookup: employee -> date -> day data
  const empMap = new Map<string, Map<string, EmployeeTimesheetData['days'][0]>>();
  allData.forEach(emp => {
    const dateMap = new Map<string, EmployeeTimesheetData['days'][0]>();
    emp.days.forEach(d => dateMap.set(d.date, d));
    empMap.set(emp.name, dateMap);
  });

  const sortedNames = allData.map(e => e.name).sort();

  // Build table rows — one row per employee, columns = dates
  // For readability, chunk dates into groups of 7 (one week per page/section)
  const weeks: string[][] = [];
  for (let i = 0; i < allDates.length; i += 7) {
    weeks.push(allDates.slice(i, i + 7));
  }

  const sections = weeks.map((weekDates, wi) => {
    const headerCells = weekDates.map(d => {
      const dt = new Date(d + 'T12:00:00');
      const dow = DAYS_PT[dt.getDay()];
      const dayNum = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      return `<th style="min-width:90px;font-size:9px;${isWeekend ? 'background:#f0f0f0;' : ''}">${dow}<br/>${dayNum}</th>`;
    }).join('');

    const bodyRows = sortedNames.map(name => {
      const dateMap = empMap.get(name)!;
      const cells = weekDates.map(d => {
        const day = dateMap.get(d);
        if (!day) return '<td style="text-align:center;color:#ccc;font-size:10px">—</td>';
        const dt = new Date(d + 'T12:00:00');
        const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
        const bgColor = day.status === 'absent' ? '#fef2f2'
          : day.status === 'overtime' ? '#fffbeb'
          : day.status === 'holiday' ? '#eff6ff'
          : isWeekend ? '#f8f8f8' : '';
        const punchesStr = day.punches.length > 0
          ? day.punches.map(p => `<span style="font-family:'Courier New',monospace;font-size:10px">${p}</span>`).join('<br/>')
          : '<span style="color:#ccc;font-size:10px">—</span>';
        const workedStr = day.workedMinutes > 0
          ? `<div style="font-size:9px;color:#555;margin-top:2px;font-family:'Courier New',monospace">${minutesToDisplay(day.workedMinutes)}</div>`
          : '';
        const overtimeStr = day.overtimeMinutes > 0
          ? `<div style="font-size:9px;color:#b45309;font-weight:700;font-family:'Courier New',monospace">+${minutesToDisplay(day.overtimeMinutes)}</div>`
          : '';
        return `<td style="text-align:center;vertical-align:top;padding:3px 4px;${bgColor ? `background:${bgColor};` : ''}">${punchesStr}${workedStr}${overtimeStr}</td>`;
      }).join('');
      return `<tr><td style="font-weight:600;font-size:11px;white-space:nowrap;padding:4px 8px">${escapeHtml(name)}</td>${cells}</tr>`;
    }).join('');

    return `
      <h3 style="margin:5px 0 3px;font-size:10px;color:#333;page-break-after:avoid">Semana ${wi + 1} — ${weekDates[0].split('-').reverse().join('/')} a ${weekDates[weekDates.length - 1].split('-').reverse().join('/')}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:10px;page-break-inside:auto;margin-bottom:4px">
        <thead><tr style="background:#f5f5f5"><th style="text-align:left;padding:3px 6px;font-size:9px">Funcionário</th>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `;
  }).join('');

  const html = `
    <h1 style="font-size:14px;margin-bottom:1px">📅 Calendário de Ponto — Todos os Funcionários</h1>
    <p class="subtitle" style="margin-bottom:4px">Período: ${escapeHtml(periodLabel)} · ${sortedNames.length} funcionários · ${allDates.length} dias · Impresso em ${new Date().toLocaleString('pt-BR')}</p>
    ${sections}
    <div style="margin-top:4px;font-size:9px;color:#666">
      <b>Legenda:</b> 🟡 HE · 🔴 Falta · 🔵 Feriado · Cinza = fim de semana
    </div>
  `;

  printHtml('Calendário de Ponto', `
    <style>
      table { border: 1.5px solid #000; }
      th, td { border: 1px solid #888; }
      th { background: #1f2937 !important; color: #fff !important; font-weight: 700; }
      tr { page-break-inside: avoid; }
      @page { size: A4 landscape; margin: 8mm 8mm; }
    </style>
    ${html}
  `);
}
