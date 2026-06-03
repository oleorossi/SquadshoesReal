import { printHtml, writePrintWindow, openPrintWindow } from './printOrder';
import { calculateHourlyPayroll, splitDayMinutes, PREMIUM_MULTIPLIER } from './hourlyPayroll';
import { SALARY_DAY_DIVISOR, SALARY_HOUR_DIVISOR } from './salaryPayroll';
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
  /**
   * Jornada esperada por dia útil (min) vinda da ESCALA — saída − entrada − almoço
   * (ex.: 540 = 9h). É o MESMO "esperado" que a folha usa (expectedDayMinutes), pra
   * a Avaliação de Jornada descontar atraso igual à folha. Cai em `expectedMinutes`
   * do dia quando ausente (compat. com chamadas que não preenchem).
   */
  expectedDayMin?: number;
}

/**
 * Folha por HORA TRABALHADA aplicada aos relatórios de ponto (modelo único do
 * RH, 2026-06). Quebra cada dia em minutos normais (1,0×) e 1,5× via o MESMO
 * `splitDayMinutes` da folha (sáb/dom/feriado/após 18h = 1,5×, sem acumular; 1h
 * de almoço descontada em dia longo). Valor = VH × horas (VH = salário ÷ 220,
 * em `emp.hourlySalary`). Bruto — adiantamento é descontado na folha.
 */
function hoursWorkedDetail(emp: EmployeeTimesheetData) {
  const vh = emp.hourlySalary || 0;
  const days = emp.days.map(d => {
    const punches = Array.isArray(d.punches) ? d.punches : [];
    const sp = punches.length >= 2
      ? splitDayMinutes(punches, d.dayOfWeek, d.isHoliday)
      : { normal: 0, premium: 0, incomplete: punches.length === 1 };
    return {
      date: d.date,
      dayOfWeek: d.dayOfWeek,
      punches,
      isHoliday: d.isHoliday,
      isAbsent: d.isAbsent,
      normalMin: sp.normal,
      premiumMin: sp.premium,
      dayWorkedMin: sp.normal + sp.premium,
      incomplete: sp.incomplete,
    };
  });
  const normalMin = days.reduce((s, d) => s + d.normalMin, 0);
  const premiumMin = days.reduce((s, d) => s + d.premiumMin, 0);
  const absences = emp.days.filter(d => d.isAbsent).length;
  const incompleteDays = days.filter(d => d.incomplete).length;
  const daysWorked = days.filter(d => d.dayWorkedMin > 0).length;
  const normalValue = (normalMin / 60) * vh;
  const premiumValue = (premiumMin / 60) * vh * PREMIUM_MULTIPLIER;
  return {
    vh, days, normalMin, premiumMin, workedMin: normalMin + premiumMin,
    absences, incompleteDays, daysWorked,
    normalValue, premiumValue, total: normalValue + premiumValue,
    hasSalary: vh > 0,
  };
}

/** Status diário no modelo de horas trabalhadas (sem conceito de HE/déficit). */
function statusLabelHW(d: { isAbsent: boolean; isHoliday: boolean; dayWorkedMin: number; incomplete: boolean; dayOfWeek: number }): string {
  if (d.incomplete) return '⚠️ Incompleto';
  if (d.dayWorkedMin > 0) return d.isHoliday ? '🏖️ Feriado (1,5×)' : (d.dayOfWeek === 0 || d.dayOfWeek === 6) ? '✓ 1,5×' : '✓';
  if (d.isAbsent) return '✗ Falta';
  if (d.isHoliday) return '🏖️ Feriado';
  if (d.dayOfWeek === 0 || d.dayOfWeek === 6) return '— Folga';
  return '—';
}

/** Corpo HTML do relatório individual (horas trabalhadas). Compartilhado por
 *  printEmployeeTimesheet, saveEmployeeTimesheetPdf e printAllIndividualTimesheets. */
function employeeReportInnerHtml(emp: EmployeeTimesheetData, periodLabel: string): string {
  const b = hoursWorkedDetail(emp);
  const formatMoney = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const daysRows = b.days.map(d => `
    <tr class="${d.isAbsent ? 'absent-row' : d.premiumMin > 0 ? 'overtime-row' : d.isHoliday ? 'holiday-row' : ''}">
      <td class="mono">${new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td>${DAYS_PT[d.dayOfWeek]}</td>
      <td class="mono">${d.punches.join(' · ') || '—'}</td>
      <td class="text-right mono">${d.normalMin > 0 ? minutesToDisplay(d.normalMin) : '—'}</td>
      <td class="text-right mono">${d.premiumMin > 0 ? `<b style="color:#b45309">${minutesToDisplay(d.premiumMin)}</b>` : '—'}</td>
      <td class="text-right mono"><b>${d.dayWorkedMin > 0 ? minutesToDisplay(d.dayWorkedMin) : '—'}</b></td>
      <td class="text-center">${statusLabelHW(d)}</td>
    </tr>
  `).join('');

  return `
    <h1>📋 Relatório de Ponto — ${escapeHtml(emp.name)}</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · Pagamento por horas trabalhadas · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

    <h2>Resumo</h2>
    <div class="info-grid">
      <div><span class="label">Horas Trabalhadas:</span> <b>${minutesToDisplay(b.workedMin)}</b></div>
      <div><span class="label">Horas Normais (1×):</span> ${minutesToDisplay(b.normalMin)}</div>
      <div><span class="label">Horas 1,5×:</span> <b style="color:#b45309">${minutesToDisplay(b.premiumMin)}</b></div>
      <div><span class="label">Dias trabalhados:</span> ${b.daysWorked}</div>
      <div><span class="label">Faltas (dias):</span> ${b.absences}</div>
      <div><span class="label">Dias incompletos:</span> ${b.incompleteDays > 0 ? `<b style="color:#b45309">${b.incompleteDays}</b>` : '—'}</div>
    </div>

    ${b.hasSalary ? `
    <h2>Valores</h2>
    <div class="info-grid">
      <div><span class="label">Valor/hora:</span> ${formatMoney(b.vh)}</div>
      <div><span class="label">Horas Normais (1×):</span> ${minutesToDisplay(b.normalMin)} = <b>${formatMoney(b.normalValue)}</b></div>
      <div><span class="label">Horas 1,5×:</span> ${minutesToDisplay(b.premiumMin)} = <b>${formatMoney(b.premiumValue)}</b></div>
      <div><span class="label">Total a Pagar:</span> <b style="color:#16a34a;font-size:14px">${formatMoney(b.total)}</b></div>
    </div>
    <p style="font-size:10px;color:#b45309;margin-top:4px"><b>⚠ Estimativa por horas trabalhadas — NÃO é a folha oficial.</b> A folha paga por salário cheio − descontos (faltas/atrasos); o valor a pagar oficial está na aba Folha.</p>
    ` : ''}

    <h2>Registro Diário</h2>
    <table>
      <thead><tr>
        <th>Data</th><th>Dia</th><th>Batidas</th>
        <th class="text-right">Normais (1×)</th><th class="text-right">1,5×</th>
        <th class="text-right">Total dia</th><th class="text-center">Status</th>
      </tr></thead>
      <tbody>${daysRows}
        <tr class="total-row">
          <td colspan="3">TOTAL</td>
          <td class="text-right mono">${minutesToDisplay(b.normalMin)}</td>
          <td class="text-right mono" style="color:#b45309">${minutesToDisplay(b.premiumMin)}</td>
          <td class="text-right mono"><b>${minutesToDisplay(b.workedMin)}</b></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  `;
}

// ── Individual Employee Report ──────────────────────
export function printEmployeeTimesheet(emp: EmployeeTimesheetData, periodLabel: string) {
  printHtml(`Ponto - ${emp.name}`, `
    <style>
      .absent-row td { background: #fecaca !important; color: #7f1d1d !important; font-weight: 700; }
      .overtime-row td { background: #fde68a !important; color: #78350f !important; font-weight: 700; }
      .holiday-row td { background: #bfdbfe !important; color: #1e3a8a !important; font-weight: 700; }
      tbody tr:nth-child(even).absent-row td,
      tbody tr:nth-child(even).overtime-row td,
      tbody tr:nth-child(even).holiday-row td { background-image: linear-gradient(rgba(0,0,0,0.03), rgba(0,0,0,0.03)); }
    </style>
    ${employeeReportInnerHtml(emp, periodLabel)}
  `);
}

// ── Save Individual Employee Report as PDF ──────────
export function saveEmployeeTimesheetPdf(emp: EmployeeTimesheetData, periodLabel: string) {
  const html = `
    <style>
      .absent-row td { background: #fecaca !important; color: #7f1d1d !important; font-weight: 700; }
      .overtime-row td { background: #fde68a !important; color: #78350f !important; font-weight: 700; }
      .holiday-row td { background: #bfdbfe !important; color: #1e3a8a !important; font-weight: 700; }
    </style>
    ${employeeReportInnerHtml(emp, periodLabel)}
  `;
  const title = `Ponto - ${emp.name}`;
  const win = openPrintWindow(title);
  writePrintWindow(win, title, html);
}

// ── Print All Individual Reports (one per page) ──────
export function printAllIndividualTimesheets(employees: EmployeeTimesheetData[], periodLabel: string) {
  const pages = employees.map((emp, idx) => `
    ${idx > 0 ? '<div style="page-break-before:always"></div>' : ''}
    ${employeeReportInnerHtml(emp, periodLabel)}
  `);

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
  const all = employees.map(emp => ({ name: emp.name, ...hoursWorkedDetail(emp) }));

  const rows = all.map(b => `
    <tr>
      <td class="emp-name">${escapeHtml(b.name)}</td>
      <td class="text-right mono"><b>${minutesToDisplay(b.workedMin)}</b></td>
      <td class="text-right mono">${b.normalMin > 0 ? minutesToDisplay(b.normalMin) : '—'}</td>
      <td class="text-right mono">${b.premiumMin > 0 ? `<b style="color:#b45309">${minutesToDisplay(b.premiumMin)}</b>` : '—'}</td>
      <td class="text-center">${b.daysWorked}</td>
      <td class="text-center">${b.absences > 0 ? `<b style="color:#dc2626">${b.absences}</b>` : '—'}</td>
      <td class="text-center">${b.incompleteDays > 0 ? `<b style="color:#b45309">${b.incompleteDays}</b>` : '—'}</td>
    </tr>
  `).join('');

  const totWorked = all.reduce((s, b) => s + b.workedMin, 0);
  const totNormal = all.reduce((s, b) => s + b.normalMin, 0);
  const totPremium = all.reduce((s, b) => s + b.premiumMin, 0);
  const totDaysWorked = all.reduce((s, b) => s + b.daysWorked, 0);
  const totAbsences = all.reduce((s, b) => s + b.absences, 0);
  const totIncomplete = all.reduce((s, b) => s + b.incompleteDays, 0);

  const html = `
    <h1>📊 Relatório Consolidado de Horas</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · ${employees.length} funcionários · Horas trabalhadas · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

    <div style="display:flex;gap:6px;margin:6px 0;flex-wrap:wrap">
      <div class="summary-card">
        <div class="sc-label">Total Trabalhado</div>
        <div class="sc-value">${minutesToDisplay(totWorked)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Horas Normais (1×)</div>
        <div class="sc-value">${minutesToDisplay(totNormal)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Horas 1,5×</div>
        <div class="sc-value" style="color:#b45309">${minutesToDisplay(totPremium)}</div>
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
        <th class="text-right">Trabalhado</th>
        <th class="text-right">Normais (1×)</th>
        <th class="text-right">1,5×</th>
        <th class="text-center">Dias trab.</th>
        <th class="text-center">Faltas</th>
        <th class="text-center">Incompl.</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="total-row" style="font-size:12px">
          <td><b>TOTAL</b></td>
          <td class="text-right mono"><b>${minutesToDisplay(totWorked)}</b></td>
          <td class="text-right mono">${minutesToDisplay(totNormal)}</td>
          <td class="text-right mono" style="color:#b45309">${minutesToDisplay(totPremium)}</td>
          <td class="text-center"><b>${totDaysWorked}</b></td>
          <td class="text-center" style="color:#dc2626"><b>${totAbsences}</b></td>
          <td class="text-center" style="color:#b45309"><b>${totIncomplete || '—'}</b></td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:16px;font-size:10px;color:#222;line-height:1.5">
      <b>Como ler:</b>
      <b>Trabalhado</b> = soma das horas batidas (após descontar 1h de almoço em dia longo) ·
      <b>Normais (1×)</b> = horas em dia útil até as 18:00 ·
      <b>1,5×</b> = sábado, domingo, feriado ou após as 18:00 (não acumula) ·
      <b>Dias trab.</b> = dias com alguma hora batida ·
      <b>Faltas</b> = dias marcados como ausência ·
      <b>Incompl.</b> = dias com nº ímpar de batidas (RH conferir).
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

/**
 * Folha por HORA TRABALHADA aplicada ao Relatório Geral de Ponto (modelo único
 * do RH, decisão 2026-06). Reaproveita a função canônica da folha
 * (`calculateHourlyPayroll`) pra o cálculo ficar IDÊNTICO ao da folha: cada dia
 * vira minutos normais (1,0×) e 1,5× (sáb/dom/feriado/após 18h, sem acumular),
 * já com 1h de almoço descontada em dia longo. Valor = VH × horas (VH = salário
 * ÷ 220, vindo em `emp.hourlySalary`). NÃO desconta adiantamento — isso é da
 * folha; aqui mostramos o bruto por horas trabalhadas.
 */
function calcHoursWorkedPay(emp: EmployeeTimesheetData) {
  const vh = emp.hourlySalary || 0;
  const days = emp.days.map(d => ({
    date: d.date,
    dayOfWeek: d.dayOfWeek,
    isHoliday: d.isHoliday,
    punches: Array.isArray(d.punches) ? d.punches : [],
  }));
  // Passa salário = VH × 220 porque calculateHourlyPayroll divide por 220 de
  // volta → hourly_rate = VH exato. advances = 0 (não é escopo do ponto).
  const r = calculateHourlyPayroll(vh * 220, days, 0);
  const absences = emp.days.filter(d => d.isAbsent).length;
  return {
    vh,
    normalMin: r.normal_minutes,
    premiumMin: r.premium_minutes,
    workedMin: r.worked_minutes,
    total: r.gross_value,
    incompleteDays: r.incomplete_days,
    absences,
    hasSalary: vh > 0,
  };
}

// ── General All-Employees Report ──────────────────────
export function printAllEmployeesTimesheet(employees: EmployeeTimesheetData[], periodLabel: string) {
  const all = employees.map(emp => ({ name: emp.name, ...calcHoursWorkedPay(emp) }));

  const formatMoney = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const rows = all.map(b => `
    <tr>
      <td class="emp-name">${escapeHtml(b.name)}</td>
      <td class="text-right mono"><b>${minutesToDisplay(b.workedMin)}</b></td>
      <td class="text-right mono">${b.normalMin > 0 ? minutesToDisplay(b.normalMin) : '—'}</td>
      <td class="text-right mono">${b.premiumMin > 0 ? `<b style="color:#b45309">${minutesToDisplay(b.premiumMin)}</b>` : '—'}</td>
      <td class="text-center">${b.absences > 0 ? `<b style="color:#dc2626">${b.absences}</b>` : '—'}</td>
      <td class="text-center">${b.incompleteDays > 0 ? `<b style="color:#b45309">${b.incompleteDays}</b>` : '—'}</td>
      <td class="text-right mono">${b.hasSalary ? formatMoney(b.vh) : '<span style="color:#dc2626">N/D</span>'}</td>
      <td class="text-right mono" style="color:${b.hasSalary ? '#16a34a' : '#999'};font-weight:700">${b.hasSalary ? formatMoney(b.total) : 'N/D (sem salário)'}</td>
    </tr>
  `).join('');

  const totWorked = all.reduce((s, b) => s + b.workedMin, 0);
  const totNormal = all.reduce((s, b) => s + b.normalMin, 0);
  const totPremium = all.reduce((s, b) => s + b.premiumMin, 0);
  const totAbsences = all.reduce((s, b) => s + b.absences, 0);
  const totIncomplete = all.reduce((s, b) => s + b.incompleteDays, 0);
  const totPay = all.reduce((s, b) => s + (b.hasSalary ? b.total : 0), 0);

  const html = `
    <h1>📊 Relatório Geral de Ponto</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · ${employees.length} funcionários · Pagamento por horas trabalhadas · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

    <div style="display:flex;gap:6px;margin:4px 0;flex-wrap:wrap">
      <div class="summary-card">
        <div class="sc-label">Total Trabalhado</div>
        <div class="sc-value">${minutesToDisplay(totWorked)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Horas Normais (1×)</div>
        <div class="sc-value">${minutesToDisplay(totNormal)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Horas 1,5×</div>
        <div class="sc-value" style="color:#b45309">${minutesToDisplay(totPremium)}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Faltas</div>
        <div class="sc-value" style="color:#dc2626">${totAbsences}</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">Total a Pagar</div>
        <div class="sc-value" style="color:#16a34a">${formatMoney(totPay)}</div>
      </div>
    </div>

    <h2>Detalhamento por Funcionário</h2>
    <table>
      <thead><tr>
        <th>Funcionário</th>
        <th class="text-right">Trab.</th>
        <th class="text-right">Normais (1×)</th>
        <th class="text-right">1,5×</th>
        <th class="text-center">Faltas</th>
        <th class="text-center">Incompl.</th>
        <th class="text-right">Valor/h</th>
        <th class="text-right">Total a Pagar</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="total-row" style="font-size:12px">
          <td><b>TOTAL</b></td>
          <td class="text-right mono"><b>${minutesToDisplay(totWorked)}</b></td>
          <td class="text-right mono">${minutesToDisplay(totNormal)}</td>
          <td class="text-right mono" style="color:#b45309">${minutesToDisplay(totPremium)}</td>
          <td class="text-center" style="color:#dc2626"><b>${totAbsences}</b></td>
          <td class="text-center" style="color:#b45309"><b>${totIncomplete || '—'}</b></td>
          <td class="text-right mono">—</td>
          <td class="text-right mono" style="color:#16a34a;font-weight:700">${formatMoney(totPay)}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:6px;font-size:11px;color:#b45309;font-weight:800;border:1.5px solid #b45309;padding:5px 8px;border-radius:4px">
      ⚠ ESTIMATIVA por horas trabalhadas — NÃO é a folha oficial. A folha paga por SALÁRIO CHEIO − DESCONTOS (faltas/atrasos); o valor a pagar oficial está na aba Folha.
    </div>
    <div style="margin-top:8px;font-size:10px;color:#222;font-weight:700">
      <b>Legenda:</b> Pagamento por HORAS TRABALHADAS · Valor/h = salário ÷ 220 ·
      Normais (1×) = horas em dia útil até as 18:00 · 1,5× = sábado, domingo, feriado ou após as 18:00 (não acumula) ·
      Total a Pagar = Normais × Valor/h + 1,5× × Valor/h × 1,5 (bruto; adiantamento é descontado na folha) ·
      Faltas = dias marcados como ausência (informativo — não reduz o pagamento) ·
      Incompl. = dias com nº ímpar de batidas (RH conferir; foram contabilizados pelo intervalo da 1ª à última)
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
  const b = hoursWorkedDetail(emp);

  // chunk into weeks of 7
  const weeks: string[][] = [];
  for (let i = 0; i < allDates.length; i += 7) {
    weeks.push(allDates.slice(i, i + 7));
  }

  const dayMap = new Map(b.days.map(d => [d.date, d]));

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
      const bgColor = day.isAbsent ? '#fecaca'
        : day.premiumMin > 0 ? '#fde68a'
        : day.isHoliday ? '#bfdbfe'
        : isWeekend ? '#e5e7eb' : '';
      const punchesStr = day.punches.length > 0
        ? day.punches.map(p => `<div style="font-family:'Courier New',monospace;font-size:14px;font-weight:800;color:#000">${p}</div>`).join('')
        : '<span style="color:#000;font-weight:700;font-size:13px">—</span>';
      const workedStr = day.dayWorkedMin > 0
        ? `<div style="font-size:12px;color:#000;font-weight:700;margin-top:3px;font-family:'Courier New',monospace;border-top:1.5px solid #000;padding-top:3px">Trab: ${minutesToDisplay(day.dayWorkedMin)}</div>`
        : '';
      const premiumStr = day.premiumMin > 0
        ? `<div style="font-size:12px;color:#7c2d12;font-weight:800;font-family:'Courier New',monospace">1,5×: ${minutesToDisplay(day.premiumMin)}</div>`
        : '';
      const incompleteStr = day.incomplete
        ? `<div style="font-size:10px;color:#b45309;font-weight:800;font-family:'Courier New',monospace">⚠ incompleto</div>`
        : '';
      const statusLabel = day.isAbsent ? '<div style="font-size:11px;color:#7f1d1d;font-weight:800">FALTA</div>'
        : day.isHoliday ? '<div style="font-size:11px;color:#1e3a8a;font-weight:800">FERIADO</div>'
        : '';
      return `<td style="text-align:center;vertical-align:top;padding:5px 4px;${bgColor ? `background:${bgColor};` : ''}">${statusLabel}${punchesStr}${workedStr}${premiumStr}${incompleteStr}</td>`;
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
      <div class="summary-card"><div class="sc-label">Trabalhado</div><div class="sc-value">${minutesToDisplay(b.workedMin)}</div></div>
      <div class="summary-card"><div class="sc-label">Normais (1×)</div><div class="sc-value">${minutesToDisplay(b.normalMin)}</div></div>
      <div class="summary-card"><div class="sc-label">Horas 1,5×</div><div class="sc-value" style="color:#7c2d12">${minutesToDisplay(b.premiumMin)}</div></div>
      <div class="summary-card"><div class="sc-label">Faltas</div><div class="sc-value" style="color:#7f1d1d">${b.absences}</div></div>
    </div>
    ${sections}
    <div style="margin-top:5px;font-size:11px;color:#000;font-weight:700">
      <b>Legenda:</b> 🟡 1,5× · 🔴 Falta · 🔵 Feriado · Cinza = fim de semana
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
  const empMap = new Map<string, Map<string, ReturnType<typeof hoursWorkedDetail>['days'][number]>>();
  allData.forEach(emp => {
    const dateMap = new Map<string, ReturnType<typeof hoursWorkedDetail>['days'][number]>();
    hoursWorkedDetail(emp).days.forEach(d => dateMap.set(d.date, d));
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
        const bgColor = day.isAbsent ? '#fef2f2'
          : day.premiumMin > 0 ? '#fffbeb'
          : day.isHoliday ? '#eff6ff'
          : isWeekend ? '#f8f8f8' : '';
        const punchesStr = day.punches.length > 0
          ? day.punches.map(p => `<span style="font-family:'Courier New',monospace;font-size:10px">${p}</span>`).join('<br/>')
          : '<span style="color:#ccc;font-size:10px">—</span>';
        const workedStr = day.dayWorkedMin > 0
          ? `<div style="font-size:9px;color:#555;margin-top:2px;font-family:'Courier New',monospace">${minutesToDisplay(day.dayWorkedMin)}</div>`
          : '';
        const premiumStr = day.premiumMin > 0
          ? `<div style="font-size:9px;color:#b45309;font-weight:700;font-family:'Courier New',monospace">1,5×: ${minutesToDisplay(day.premiumMin)}</div>`
          : '';
        return `<td style="text-align:center;vertical-align:top;padding:3px 4px;${bgColor ? `background:${bgColor};` : ''}">${punchesStr}${workedStr}${premiumStr}</td>`;
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
      <b>Legenda:</b> 🟡 1,5× · 🔴 Falta · 🔵 Feriado · Cinza = fim de semana
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

// ── Avaliação de Aderência à Jornada (esperado × batido) ──────────────
// Relatório SEPARADO da folha por horas. Usa a JORNADA ESPERADA cadastrada do
// funcionário como referência pra mostrar, dia a dia:
//   · Faltas/atrasos  → desconto REAL = horas faltantes (esperado − trabalhado) × valor-hora
//   · Horas extras    → horas ACIMA do esperado no dia × taxa de HE configurada
//                       (overtimeHourlyRate, ou valor-hora × multiplicador; default 1,5×)
//   · Líquido         → Valor HE − Desconto
// Pedido do usuário (2026-06): avaliação funcionário a funcionário com horários não
// batidos + quanto foi descontado, e dias/valor de hora extra; + resumo de todos.
/**
 * Avaliação de Jornada (esperado × batido) usando EXATAMENTE o motor da folha
 * (salário − descontos): mesmo `splitDayMinutes`, mesma jornada esperada da escala
 * (`emp.expectedDayMin`, ex.: 540 = 9h) e mesmas regras de desconto/HE. Assim a
 * Avaliação reconcilia com a Folha centavo a centavo.
 *   - FALTA (dia útil sem trabalho)               → −1 dia = salário ÷ 30 (valor-dia).
 *   - ATRASO / saída cedo (trabalhou < esperado)  → −(esperado − trabalhado) × valor-hora.
 *   - HE (após 18h / fim de semana / feriado)     → +horas × valor-hora × 1,5.
 *   - Batida ÍMPAR (inconsistente)                → fica PENDENTE: não desconta nem paga.
 *
 * Antes (bug A4): HE vinha de `d.overtimeMinutes` (sempre 0 nos relatórios), a falta
 * era cobrada como `déficit × valor-hora` (≠ folha) e a batida ímpar virava falta de
 * dia inteiro. O esperado também vinha do resumo (528) em vez da escala (540).
 */
export function evaluationDetail(emp: EmployeeTimesheetData) {
  const vh = emp.hourlySalary || 0;                                 // valor-hora = salário ÷ 220
  const valorDia = vh * (SALARY_HOUR_DIVISOR / SALARY_DAY_DIVISOR);  // = salário ÷ 30
  const schedExpected = emp.expectedDayMin && emp.expectedDayMin > 0 ? emp.expectedDayMin : null;

  const faltaDays: { date: string; dayOfWeek: number; punches: string[]; isAbsent: boolean; expected: number; worked: number; deficit: number; desconto: number }[] = [];
  const extraDays: { date: string; dayOfWeek: number; punches: string[]; expected: number; worked: number; extra: number; valor: number }[] = [];
  let pendingDays = 0;

  for (const d of emp.days) {
    const punches = Array.isArray(d.punches) ? d.punches : [];
    const sp = punches.length >= 2
      ? splitDayMinutes(punches, d.dayOfWeek, d.isHoliday)
      : { normal: 0, premium: 0, incomplete: punches.length === 1 };
    if (sp.incomplete) { pendingDays++; continue; }                 // ímpar → pendente

    const isWorkday = (d.expectedMinutes || 0) > 0;                 // dia de escala (esperado>0)
    const expected = schedExpected ?? (d.expectedMinutes || 0);     // folha usa a escala (540)

    if (isWorkday) {
      if (sp.normal === 0 && sp.premium === 0) {
        // FALTA: dia útil sem trabalho → desconta o dia inteiro (valor-dia)
        faltaDays.push({ date: d.date, dayOfWeek: d.dayOfWeek, punches, isAbsent: true, expected, worked: 0, deficit: expected, desconto: valorDia });
      } else {
        const deficit = Math.max(0, expected - sp.normal);          // atraso/saída cedo só sobre horas normais
        if (deficit > 0) {
          faltaDays.push({ date: d.date, dayOfWeek: d.dayOfWeek, punches, isAbsent: false, expected, worked: sp.normal, deficit, desconto: (deficit / 60) * vh });
        }
        if (sp.premium > 0) {
          extraDays.push({ date: d.date, dayOfWeek: d.dayOfWeek, punches, expected, worked: sp.normal + sp.premium, extra: sp.premium, valor: (sp.premium / 60) * vh * PREMIUM_MULTIPLIER });
        }
      }
    } else {
      // folga/feriado trabalhado → tudo 1,5×
      const worked = sp.normal + sp.premium;
      if (worked > 0) {
        extraDays.push({ date: d.date, dayOfWeek: d.dayOfWeek, punches, expected: 0, worked, extra: worked, valor: (worked / 60) * vh * PREMIUM_MULTIPLIER });
      }
    }
  }

  const totalDeficitMin = faltaDays.reduce((s, d) => s + d.deficit, 0);
  const totalDescontoVal = faltaDays.reduce((s, d) => s + d.desconto, 0);
  const totalExtraMin = extraDays.reduce((s, d) => s + d.extra, 0);
  const totalExtraVal = extraDays.reduce((s, d) => s + d.valor, 0);

  return {
    vh, valorDia, faltaDays, extraDays, pendingDays,
    totalDeficitMin, totalDescontoVal, totalExtraMin, totalExtraVal,
    liquido: totalExtraVal - totalDescontoVal, hasSalary: vh > 0,
  };
}

const EVAL_STYLE = `
  <style>
    .summary-card { border: 1.5px solid #000; border-radius: 4px; padding: 6px 10px; min-width: 100px; background: #f9fafb; }
    .sc-label { font-size: 9px; text-transform: uppercase; color: #000; letter-spacing: 0.4px; font-weight: 800; }
    .sc-value { font-size: 14px; font-weight: 800; font-family: 'SFMono-Regular', 'Courier New', monospace; color: #000; font-variant-numeric: tabular-nums; }
    .emp-name { font-weight: 700; color: #000; }
    .absent-row td { background: #fee2e2 !important; }
    .overtime-row td { background: #fef3c7 !important; }
    tr { page-break-inside: avoid; }
    tbody tr:nth-child(even) td { background: #f3f4f6; }
    @page { size: A4 portrait; margin: 10mm 8mm; }
  </style>
`;

function evaluationEmployeeInnerHtml(emp: EmployeeTimesheetData, periodLabel: string): string {
  const e = evaluationDetail(emp);
  const formatMoney = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const faltaRows = e.faltaDays.length > 0 ? e.faltaDays.map(d => `
    <tr class="absent-row">
      <td class="mono">${new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td>${DAYS_PT[d.dayOfWeek]}</td>
      <td class="mono">${d.isAbsent && d.punches.length === 0 ? '— (falta)' : (d.punches.join(' · ') || '—')}</td>
      <td class="text-right mono">${minutesToDisplay(d.expected)}</td>
      <td class="text-right mono">${minutesToDisplay(d.worked)}</td>
      <td class="text-right mono"><b style="color:#dc2626">${minutesToDisplay(d.deficit)}</b></td>
      <td class="text-right mono" style="color:#dc2626">${e.hasSalary ? '-' + formatMoney(d.desconto) : 'N/D'}</td>
    </tr>
  `).join('') : `<tr><td colspan="7" style="text-align:center;color:#16a34a;font-weight:700">Sem faltas/atrasos no período ✓</td></tr>`;

  const extraRows = e.extraDays.length > 0 ? e.extraDays.map(d => `
    <tr class="overtime-row">
      <td class="mono">${new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td>${DAYS_PT[d.dayOfWeek]}</td>
      <td class="mono">${d.punches.join(' · ') || '—'}</td>
      <td class="text-right mono">${minutesToDisplay(d.expected)}</td>
      <td class="text-right mono">${minutesToDisplay(d.worked)}</td>
      <td class="text-right mono"><b style="color:#b45309">${minutesToDisplay(d.extra)}</b></td>
      <td class="text-right mono" style="color:#16a34a">${e.hasSalary ? '+' + formatMoney(d.valor) : 'N/D'}</td>
    </tr>
  `).join('') : `<tr><td colspan="7" style="text-align:center;color:#666">Sem horas extras no período</td></tr>`;

  return `
    <h1>🧭 Avaliação de Jornada — ${escapeHtml(emp.name)}</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · Esperado × Batido · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

    <div style="display:flex;gap:6px;margin:4px 0 8px;flex-wrap:wrap">
      <div class="summary-card"><div class="sc-label">Faltou / Atrasou</div><div class="sc-value" style="color:#dc2626">${minutesToDisplay(e.totalDeficitMin)}</div></div>
      <div class="summary-card"><div class="sc-label">Desconto</div><div class="sc-value" style="color:#dc2626">${e.hasSalary ? '-' + formatMoney(e.totalDescontoVal) : 'N/D'}</div></div>
      <div class="summary-card"><div class="sc-label">Hora Extra</div><div class="sc-value" style="color:#b45309">${minutesToDisplay(e.totalExtraMin)}</div></div>
      <div class="summary-card"><div class="sc-label">Valor HE</div><div class="sc-value" style="color:#16a34a">${e.hasSalary ? '+' + formatMoney(e.totalExtraVal) : 'N/D'}</div></div>
      <div class="summary-card"><div class="sc-label">Líquido (HE − Desc.)</div><div class="sc-value" style="color:${e.liquido >= 0 ? '#16a34a' : '#dc2626'}">${e.hasSalary ? (e.liquido >= 0 ? '+' : '-') + formatMoney(Math.abs(e.liquido)) : 'N/D'}</div></div>
      ${e.pendingDays > 0 ? `<div class="summary-card" style="background:#fef3c7"><div class="sc-label">Pendentes (ímpar)</div><div class="sc-value" style="color:#b45309">${e.pendingDays}</div></div>` : ''}
    </div>
    ${e.pendingDays > 0 ? `<p style="font-size:10px;color:#b45309;margin:0 0 8px">⚠ ${e.pendingDays} dia(s) com nº ímpar de batidas ficaram FORA do cálculo (não descontam nem pagam) — resolver na aba "Pendências de Ponto" antes de fechar.</p>` : ''}

    <h2>Faltas / Atrasos — horários não cumpridos e desconto</h2>
    <table>
      <thead><tr><th>Data</th><th>Dia</th><th>Batidas</th><th class="text-right">Esperado</th><th class="text-right">Trabalhado</th><th class="text-right">Faltou</th><th class="text-right">Desconto</th></tr></thead>
      <tbody>${faltaRows}
        <tr class="total-row"><td colspan="5">TOTAL</td><td class="text-right mono" style="color:#dc2626"><b>${minutesToDisplay(e.totalDeficitMin)}</b></td><td class="text-right mono" style="color:#dc2626"><b>${e.hasSalary ? '-' + formatMoney(e.totalDescontoVal) : 'N/D'}</b></td></tr>
      </tbody>
    </table>

    <h2>Horas Extras — dias acima da jornada e valor</h2>
    <table>
      <thead><tr><th>Data</th><th>Dia</th><th>Batidas</th><th class="text-right">Esperado</th><th class="text-right">Trabalhado</th><th class="text-right">Extra</th><th class="text-right">Valor</th></tr></thead>
      <tbody>${extraRows}
        <tr class="total-row"><td colspan="5">TOTAL</td><td class="text-right mono" style="color:#b45309"><b>${minutesToDisplay(e.totalExtraMin)}</b></td><td class="text-right mono" style="color:#16a34a"><b>${e.hasSalary ? '+' + formatMoney(e.totalExtraVal) : 'N/D'}</b></td></tr>
      </tbody>
    </table>
  `;
}

// Detalhado: uma página por funcionário (faltas + horas extras + líquido).
export function printEmployeeEvaluationDetailed(employees: EmployeeTimesheetData[], periodLabel: string) {
  const pages = employees.map((emp, idx) => `
    ${idx > 0 ? '<div style="page-break-before:always"></div>' : ''}
    ${evaluationEmployeeInnerHtml(emp, periodLabel)}
  `).join('');
  printHtml('Avaliação de Jornada — Detalhada', `${EVAL_STYLE}${pages}`);
}

// Resumo: uma linha por funcionário, pra visão geral.
export function printEmployeeEvaluationSummary(employees: EmployeeTimesheetData[], periodLabel: string) {
  const all = employees.map(emp => ({ name: emp.name, ...evaluationDetail(emp) }));
  const formatMoney = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const rows = all.map(e => `
    <tr>
      <td class="emp-name">${escapeHtml(e.name)}</td>
      <td class="text-center">${e.faltaDays.length || '—'}</td>
      <td class="text-right mono">${e.totalDeficitMin > 0 ? `<b style="color:#dc2626">${minutesToDisplay(e.totalDeficitMin)}</b>` : '—'}</td>
      <td class="text-right mono" style="color:#dc2626">${e.hasSalary ? (e.totalDescontoVal > 0 ? '-' + formatMoney(e.totalDescontoVal) : '—') : 'N/D'}</td>
      <td class="text-center">${e.extraDays.length || '—'}</td>
      <td class="text-right mono">${e.totalExtraMin > 0 ? `<b style="color:#b45309">${minutesToDisplay(e.totalExtraMin)}</b>` : '—'}</td>
      <td class="text-right mono" style="color:#16a34a">${e.hasSalary ? (e.totalExtraVal > 0 ? '+' + formatMoney(e.totalExtraVal) : '—') : 'N/D'}</td>
      <td class="text-right mono" style="color:${e.liquido >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${e.hasSalary ? (e.liquido >= 0 ? '+' : '-') + formatMoney(Math.abs(e.liquido)) : 'N/D'}</td>
      <td class="text-center mono">${e.pendingDays > 0 ? `<b style="color:#b45309">${e.pendingDays}</b>` : '—'}</td>
    </tr>
  `).join('');

  const totPend = all.reduce((s, e) => s + e.pendingDays, 0);
  const totDef = all.reduce((s, e) => s + e.totalDeficitMin, 0);
  const totDesc = all.reduce((s, e) => s + (e.hasSalary ? e.totalDescontoVal : 0), 0);
  const totExtra = all.reduce((s, e) => s + e.totalExtraMin, 0);
  const totExtraVal = all.reduce((s, e) => s + (e.hasSalary ? e.totalExtraVal : 0), 0);
  const totLiquido = totExtraVal - totDesc;

  const html = `
    <h1>🧭 Avaliação de Jornada — Resumo Geral</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · ${employees.length} funcionários · Esperado × Batido · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

    <div style="display:flex;gap:6px;margin:4px 0;flex-wrap:wrap">
      <div class="summary-card"><div class="sc-label">Total Faltou</div><div class="sc-value" style="color:#dc2626">${minutesToDisplay(totDef)}</div></div>
      <div class="summary-card"><div class="sc-label">Total Desconto</div><div class="sc-value" style="color:#dc2626">-${formatMoney(totDesc)}</div></div>
      <div class="summary-card"><div class="sc-label">Total Hora Extra</div><div class="sc-value" style="color:#b45309">${minutesToDisplay(totExtra)}</div></div>
      <div class="summary-card"><div class="sc-label">Total Valor HE</div><div class="sc-value" style="color:#16a34a">+${formatMoney(totExtraVal)}</div></div>
      <div class="summary-card"><div class="sc-label">Líquido Geral</div><div class="sc-value" style="color:${totLiquido >= 0 ? '#16a34a' : '#dc2626'}">${totLiquido >= 0 ? '+' : '-'}${formatMoney(Math.abs(totLiquido))}</div></div>
    </div>

    <h2>Por Funcionário</h2>
    <table>
      <thead><tr>
        <th>Funcionário</th>
        <th class="text-center">Dias falta</th>
        <th class="text-right">Faltou</th>
        <th class="text-right">Desconto</th>
        <th class="text-center">Dias HE</th>
        <th class="text-right">Hora Extra</th>
        <th class="text-right">Valor HE</th>
        <th class="text-right">Líquido</th>
        <th class="text-center">Pend.</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="total-row" style="font-size:12px">
          <td><b>TOTAL</b></td>
          <td></td>
          <td class="text-right mono" style="color:#dc2626"><b>${minutesToDisplay(totDef)}</b></td>
          <td class="text-right mono" style="color:#dc2626"><b>-${formatMoney(totDesc)}</b></td>
          <td></td>
          <td class="text-right mono" style="color:#b45309"><b>${minutesToDisplay(totExtra)}</b></td>
          <td class="text-right mono" style="color:#16a34a"><b>+${formatMoney(totExtraVal)}</b></td>
          <td class="text-right mono" style="color:${totLiquido >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${totLiquido >= 0 ? '+' : '-'}${formatMoney(Math.abs(totLiquido))}</td>
          <td class="text-center mono">${totPend > 0 ? `<b style="color:#b45309">${totPend}</b>` : '—'}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:16px;font-size:10px;color:#222;line-height:1.5">
      <b>Como ler:</b> Mesma conta da FOLHA (salário − descontos) aplicada à jornada ·
      <b>Falta</b> (dia útil sem trabalho) = −1 dia (salário ÷ 30) · <b>Atraso/saída cedo</b> = (esperado − trabalhado) × valor-hora (salário ÷ 220) ·
      <b>Hora Extra</b> (após 18h / fim de semana / feriado) = horas × valor-hora × 1,5 ·
      <b>Líquido</b> = Valor HE − Desconto · <b>Pend.</b> = dias com batida ímpar fora do cálculo (resolver em Pendências de Ponto).
    </div>
  `;

  printHtml('Avaliação de Jornada — Resumo', `${EVAL_STYLE}${html}`);
}
