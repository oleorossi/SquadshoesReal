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
  // PAGAMENTO alinhado à FOLHA (HE líquida do período, descontos). As horas acima
  // (normalMin/premiumMin) seguem cruas pro display; o pagamento vem da folha.
  const ev = evaluationDetail(emp);
  return {
    vh, days, normalMin, premiumMin, workedMin: normalMin + premiumMin,
    absences, incompleteDays, daysWorked,
    normalValue, premiumValue, total: normalValue + premiumValue,
    // folha:
    folhaHeMin: ev.heMin, folhaHeValue: ev.heValue, folhaAtrasoMin: ev.atrasoMin, folhaAtraso: ev.atrasoDesconto,
    folhaFaltaCount: ev.faltaCount, folhaFalta: ev.faltaDesconto, folhaLiquido: ev.liquido, folhaTotalDesc: ev.totalDesconto,
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
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · Horas trabalhadas + pagamento (folha) · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

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
    <h2>Pagamento (folha)</h2>
    <div class="info-grid">
      <div><span class="label">Valor/hora:</span> ${formatMoney(b.vh)}</div>
      <div><span class="label">Hora extra líq.:</span> ${b.folhaHeMin > 0 ? minutesToDisplay(b.folhaHeMin) + ' = ' : ''}<b style="color:#16a34a">${b.folhaHeValue > 0 ? '+' + formatMoney(b.folhaHeValue) : '—'}</b></div>
      <div><span class="label">Atraso:</span> ${b.folhaAtrasoMin > 0 ? minutesToDisplay(b.folhaAtrasoMin) + ' = ' : ''}<b style="color:#dc2626">${b.folhaAtraso > 0 ? '-' + formatMoney(b.folhaAtraso) : '—'}</b></div>
      <div><span class="label">Faltas:</span> <b style="color:#dc2626">${b.folhaFaltaCount > 0 ? b.folhaFaltaCount + ' = -' + formatMoney(b.folhaFalta) : '—'}</b></div>
      <div><span class="label">Líquido (HE − Desc.):</span> <b style="color:${b.folhaLiquido >= 0 ? '#16a34a' : '#dc2626'};font-size:14px">${(b.folhaLiquido >= 0 ? '+' : '-') + formatMoney(Math.abs(b.folhaLiquido))}</b></div>
    </div>
    <p style="font-size:10px;color:#222;margin-top:4px">Pagamento pela mesma conta da Folha (salário − descontos, hora extra e atraso POR DIA — sem compensar entre dias). Hora extra/atraso/falta acima são o ajuste; o total a receber está na aba <b>Folha</b>.</p>
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
  const ev = evaluationDetail(emp);   // PAGAMENTO pela folha (HE líquida, descontos)
  return {
    vh,
    normalMin: r.normal_minutes,
    premiumMin: r.premium_minutes,
    workedMin: r.worked_minutes,
    total: r.gross_value,
    incompleteDays: r.incomplete_days,
    absences,
    folhaHeMin: ev.heMin, folhaHeValue: ev.heValue, folhaAtraso: ev.atrasoDesconto,
    folhaFaltaCount: ev.faltaCount, folhaFalta: ev.faltaDesconto, folhaLiquido: ev.liquido,
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
      <td class="text-right mono" style="color:${b.hasSalary ? (b.folhaLiquido >= 0 ? '#16a34a' : '#dc2626') : '#999'};font-weight:700">${b.hasSalary ? (b.folhaLiquido >= 0 ? '+' : '-') + formatMoney(Math.abs(b.folhaLiquido)) : 'N/D (sem salário)'}</td>
    </tr>
  `).join('');

  const totWorked = all.reduce((s, b) => s + b.workedMin, 0);
  const totNormal = all.reduce((s, b) => s + b.normalMin, 0);
  const totPremium = all.reduce((s, b) => s + b.premiumMin, 0);
  const totAbsences = all.reduce((s, b) => s + b.absences, 0);
  const totIncomplete = all.reduce((s, b) => s + b.incompleteDays, 0);
  const totPay = all.reduce((s, b) => s + (b.hasSalary ? b.folhaLiquido : 0), 0);

  const html = `
    <h1>📊 Relatório Geral de Ponto</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · ${employees.length} funcionários · Horas trabalhadas + pagamento (folha) · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

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
        <div class="sc-label">Líquido folha (HE−Desc.)</div>
        <div class="sc-value" style="color:${totPay >= 0 ? '#16a34a' : '#dc2626'}">${(totPay >= 0 ? '+' : '-') + formatMoney(Math.abs(totPay))}</div>
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
        <th class="text-right">Líquido (HE−Desc.)</th>
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
          <td class="text-right mono" style="color:${totPay >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${(totPay >= 0 ? '+' : '-') + formatMoney(Math.abs(totPay))}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:6px;font-size:11px;color:#222;border:1px solid #ccc;padding:5px 8px;border-radius:4px">
      <b>Pagamento pela mesma conta da Folha</b> (salário − descontos, hora extra e atraso POR DIA — sem compensar entre dias). A coluna "Líquido (HE−Desc.)" é o ajuste de hora extra menos faltas/atrasos; o valor TOTAL a receber (salário do período − descontos + HE) está na aba <b>Folha</b>. Espelho/Banco seguem o regime legal CLT.
    </div>
    <div style="margin-top:8px;font-size:10px;color:#222">
      <b>Legenda:</b> Colunas de HORAS (Trab./Normais/1,5×) = quanto cada um bateu (Valor/h = salário ÷ 220) ·
      Normais (1×) = horas em dia útil até as 18:00 · 1,5× = sábado, domingo, feriado ou após as 18:00 ·
      <b>Líquido (HE−Desc.)</b> = conta da FOLHA: hora extra POR DIA (excedente de cada dia; fds/feriado = tudo HE) menos faltas (salário÷30) e atrasos por dia (× valor-hora) ·
      Incompl. = dias com nº ímpar de batidas (RH conferir).
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
 *   - FALTA (dia útil sem trabalho)               → −1 dia = salário ÷ 30 (valor-dia), à parte.
 *   - LÍQUIDO do período: tudo trabalhado (dias presentes + fds/feriado) vs esperado dos
 *     dias presentes. Sobrou → HE × valor-hora × 1,5. Faltou → atraso × valor-hora.
 *     Hora extra SÓ no excedente; fds/após-18h ABATEM o déficit antes de virar HE.
 *   - Batida ÍMPAR (inconsistente)                → fica PENDENTE: não desconta nem paga.
 *
 * Antes (bug A4): HE vinha de `d.overtimeMinutes` (sempre 0 nos relatórios), a falta
 * era cobrada como `déficit × valor-hora` (≠ folha) e a batida ímpar virava falta de
 * dia inteiro. O esperado também vinha do resumo (528) em vez da escala (540).
 */
export type EvalDayKind = 'ok' | 'curto' | 'falta' | 'fds' | 'pendente';
export function evaluationDetail(emp: EmployeeTimesheetData) {
  const vh = emp.hourlySalary || 0;                                 // valor-hora = salário ÷ 220
  const valorDia = vh * (SALARY_HOUR_DIVISOR / SALARY_DAY_DIVISOR);  // = salário ÷ 30
  const schedExpected = emp.expectedDayMin && emp.expectedDayMin > 0 ? emp.expectedDayMin : null;

  // Dia a dia: monta a linha de exibição (saldo do dia) E acumula HE/atraso BRUTO por-dia
  // (excedente/déficit de CADA dia, SEM compensação entre dias) — MESMA conta do motor da
  // folha (2026-06-19). Falta entra à parte (valor-dia); fds/feriado trabalhado = tudo HE.
  const dayRows: { date: string; dayOfWeek: number; punches: string[]; expected: number; worked: number; saldo: number; kind: EvalDayKind }[] = [];
  let faltaCount = 0, expectedPresentMin = 0, workedTotalMin = 0, pendingDays = 0;
  let heMin = 0, atrasoMin = 0;

  for (const d of emp.days) {
    const punches = Array.isArray(d.punches) ? d.punches : [];
    const sp = punches.length >= 2
      ? splitDayMinutes(punches, d.dayOfWeek, d.isHoliday)
      : { normal: 0, premium: 0, incomplete: punches.length === 1 };
    const isWorkday = (d.expectedMinutes || 0) > 0;                 // dia de escala (esperado>0)
    const expected = isWorkday ? (schedExpected ?? (d.expectedMinutes || 0)) : 0;  // escala (540)

    if (sp.incomplete) { pendingDays++; dayRows.push({ date: d.date, dayOfWeek: d.dayOfWeek, punches, expected, worked: 0, saldo: 0, kind: 'pendente' }); continue; }
    const worked = sp.normal + sp.premium;

    if (isWorkday) {
      if (worked === 0) { faltaCount++; dayRows.push({ date: d.date, dayOfWeek: d.dayOfWeek, punches, expected, worked: 0, saldo: 0, kind: 'falta' }); continue; }
      expectedPresentMin += expected; workedTotalMin += worked;
      // BRUTO por-dia: excedente do dia → HE, déficit do dia → atraso (sem compensar entre dias).
      const dayBal = worked - expected;
      if (dayBal > 0) heMin += dayBal; else if (dayBal < 0) atrasoMin += -dayBal;
      dayRows.push({ date: d.date, dayOfWeek: d.dayOfWeek, punches, expected, worked, saldo: worked - expected, kind: worked >= expected ? 'ok' : 'curto' });
    } else if (worked > 0) {
      workedTotalMin += worked; heMin += worked;                    // fds/feriado = tudo hora extra
      dayRows.push({ date: d.date, dayOfWeek: d.dayOfWeek, punches, expected: 0, worked, saldo: worked, kind: 'fds' });
    }
  }

  const faltaDesconto = faltaCount * valorDia;
  const atrasoDesconto = (atrasoMin / 60) * vh;
  const heValue = (heMin / 60) * vh * PREMIUM_MULTIPLIER;
  const totalDesconto = faltaDesconto + atrasoDesconto;

  return {
    vh, valorDia, dayRows, pendingDays,
    faltaCount, faltaDesconto, atrasoMin, atrasoDesconto, heMin, heValue,
    totalDesconto, liquido: heValue - totalDesconto, hasSalary: vh > 0,
    workedTotalMin, expectedPresentMin,
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
    h2 { font-size: 13px; margin: 14px 0 4px; border-bottom: 1.5px solid #000; padding-bottom: 2px; }
    .note { font-size: 9px; color: #444; margin: 2px 0 6px; line-height: 1.35; }
    /* Folha (holerite) */
    .pay { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
    .pay td { border: 1px solid #000; padding: 5px 10px; font-size: 12px; }
    .pay .lbl { font-weight: 700; }
    .pay .amt { text-align: right; font-family: 'SFMono-Regular','Courier New',monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pay .pos { color: #166534; }
    .pay .neg { color: #b91c1c; }
    .pay .net td { background: #eef2ff !important; font-size: 14px; font-weight: 800; }
    /* Assinaturas */
    .sig { display: flex; gap: 48px; margin-top: 30px; }
    .sig div { flex: 1; border-top: 1.5px solid #000; padding-top: 4px; text-align: center; font-size: 10px; color: #000; }
    @page { size: A4 portrait; margin: 10mm 8mm; }
  </style>
`;

function evaluationEmployeeInnerHtml(emp: EmployeeTimesheetData, periodLabel: string, advance = 0): string {
  const e = evaluationDetail(emp);
  const formatMoney = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR');

  const base = e.vh * SALARY_HOUR_DIVISOR;             // salário do mês (220h) — referência da folha
  const liquido = base + e.heValue - e.totalDesconto;  // base + HE − (faltas + atraso)
  const saldoMin = e.workedTotalMin - e.expectedPresentMin;
  const kindColor: Record<string, string> = { ok: '#16a34a', curto: '#dc2626', falta: '#dc2626', fds: '#2563eb', pendente: '#b45309' };

  // ── Folha (holerite): base − descontos + HE = líquido ──
  const payBlock = e.hasSalary ? `
    <h2>Folha salarial — ${escapeHtml(periodLabel)}</h2>
    <table class="pay">
      <tr><td class="lbl">Salário base (mês · 220h)</td><td class="amt">${formatMoney(base)}</td></tr>
      <tr><td class="lbl neg">(−) Faltas — ${e.faltaCount} dia(s) × valor-dia</td><td class="amt neg">${e.faltaDesconto > 0 ? '− ' + formatMoney(e.faltaDesconto) : '—'}</td></tr>
      <tr><td class="lbl neg">(−) Atrasos (líq.) — ${e.atrasoMin > 0 ? minutesToDisplay(e.atrasoMin) : '0:00'}</td><td class="amt neg">${e.atrasoDesconto > 0 ? '− ' + formatMoney(e.atrasoDesconto) : '—'}</td></tr>
      <tr><td class="lbl pos">(+) Hora extra (líq. ×1,5) — ${e.heMin > 0 ? minutesToDisplay(e.heMin) : '0:00'}</td><td class="amt pos">${e.heValue > 0 ? '+ ' + formatMoney(e.heValue) : '—'}</td></tr>
      ${advance > 0 ? `<tr><td class="lbl neg">(−) Adiantamentos (vales do mês)</td><td class="amt neg">− ${formatMoney(advance)}</td></tr>` : ''}
      <tr class="net"><td>= Líquido a pagar</td><td class="amt">${formatMoney(liquido - advance)}</td></tr>
    </table>
    <p class="note">Valor-dia = salário ÷ 30 = ${formatMoney(e.valorDia)} · Valor-hora = salário ÷ 220 = ${formatMoney(e.vh)} · Hora extra a 1,5×.
      Valores <b>líquidos do período</b> (mesma conta da Folha): fim de semana / após-18h abatem o déficit antes de virar HE; falta = −1 dia.</p>
  ` : `<p class="note">⚠ Salário não cadastrado para este funcionário — folha não calculada (apenas a jornada abaixo).</p>`;

  // ── Faltas e dias fora do horário (abaixo do esperado) ──
  const probRows = e.dayRows.filter(d => d.kind === 'falta' || d.kind === 'curto');
  const probTable = probRows.length ? `
    <h2>Faltas e dias fora do horário (${probRows.length})</h2>
    <table>
      <thead><tr><th>Data</th><th>Dia</th><th>Situação</th><th class="text-right">Esperado</th><th class="text-right">Trabalhado</th><th class="text-right">Déficit / Desconto</th></tr></thead>
      <tbody>${probRows.map(d => `
        <tr class="${d.kind === 'falta' ? 'absent-row' : ''}">
          <td class="mono">${fmtDate(d.date)}</td>
          <td>${DAYS_PT[d.dayOfWeek]}</td>
          <td>${d.kind === 'falta' ? 'Falta' : 'Saiu antes / curto'}</td>
          <td class="text-right mono">${minutesToDisplay(d.expected)}</td>
          <td class="text-right mono">${d.kind === 'falta' ? '—' : minutesToDisplay(d.worked)}</td>
          <td class="text-right mono" style="color:#dc2626"><b>${d.kind === 'falta' ? minutesToDisplay(d.expected) + (e.hasSalary ? ' · −' + formatMoney(e.valorDia) : '') : minutesToDisplay(d.expected - d.worked)}</b></td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="note">Cada falta desconta 1 dia (salário ÷ 30). Cada dia “curto” desconta seu atraso e cada dia “longo”/fds paga hora extra — <b>por dia, sem compensação entre dias</b> — atraso total ${e.atrasoDesconto > 0 ? '<b>−' + formatMoney(e.atrasoDesconto) + '</b>' : '<b>nenhum</b>'}, já na folha acima.</p>
  ` : `<h2>Faltas e dias fora do horário</h2><p class="note">Nenhuma falta ou dia abaixo do esperado no período. 👍</p>`;

  // ── Horas extras (dias com saldo positivo) ──
  const heRows = e.dayRows.filter(d => d.saldo > 0);
  const heTable = heRows.length ? `
    <h2>Dias com hora extra / excedente (${heRows.length})</h2>
    <table>
      <thead><tr><th>Data</th><th>Dia</th><th>Batidas</th><th class="text-right">Esperado</th><th class="text-right">Trabalhado</th><th class="text-right">Excedente</th></tr></thead>
      <tbody>${heRows.map(d => `
        <tr class="overtime-row">
          <td class="mono">${fmtDate(d.date)}</td>
          <td>${DAYS_PT[d.dayOfWeek]}${d.kind === 'fds' ? ' · fds/feriado' : ''}</td>
          <td class="mono">${d.punches.join(' · ') || '—'}</td>
          <td class="text-right mono">${d.expected > 0 ? minutesToDisplay(d.expected) : '—'}</td>
          <td class="text-right mono">${minutesToDisplay(d.worked)}</td>
          <td class="text-right mono" style="color:#16a34a"><b>+${minutesToDisplay(d.saldo)}</b></td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="note">Excedente bruto por dia. A hora extra <b>paga</b> é o excedente <b>líquido</b> do período: ${e.heMin > 0 ? '<b>' + minutesToDisplay(e.heMin) + ' ×1,5 = +' + formatMoney(e.heValue) + '</b>' : '<b>zero</b> — não bateu a meta de horas do período'}, já na folha acima.</p>
  ` : `<h2>Dias com hora extra / excedente</h2><p class="note">Nenhum dia com excedente no período.</p>`;

  // ── Jornada dia a dia completa ──
  const dayTable = e.dayRows.length > 0 ? e.dayRows.map(d => `
    <tr${d.kind === 'falta' ? ' class="absent-row"' : (d.kind === 'fds' ? ' class="overtime-row"' : '')}>
      <td class="mono">${fmtDate(d.date)}</td>
      <td>${DAYS_PT[d.dayOfWeek]}</td>
      <td class="mono">${d.kind === 'falta' ? '— (falta)' : (d.punches.join(' · ') || '—')}</td>
      <td class="text-right mono">${d.expected > 0 ? minutesToDisplay(d.expected) : '—'}</td>
      <td class="text-right mono">${d.kind === 'pendente' ? 'ímpar' : minutesToDisplay(d.worked)}</td>
      <td class="text-right mono"><b style="color:${kindColor[d.kind]}">${d.kind === 'falta' || d.kind === 'pendente' ? '—' : (d.saldo >= 0 ? '+' : '') + minutesToDisplay(d.saldo)}</b></td>
    </tr>
  `).join('') : `<tr><td colspan="6" style="text-align:center;color:#666">Sem dias no período</td></tr>`;

  return `
    <h1>📋 Demonstrativo Individual — ${escapeHtml(emp.name)}</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

    ${payBlock}

    <div style="display:flex;gap:6px;margin:4px 0 8px;flex-wrap:wrap">
      <div class="summary-card"><div class="sc-label">Trabalhadas</div><div class="sc-value">${minutesToDisplay(e.workedTotalMin)}</div></div>
      <div class="summary-card"><div class="sc-label">Esperadas</div><div class="sc-value">${minutesToDisplay(e.expectedPresentMin)}</div></div>
      <div class="summary-card"><div class="sc-label">Saldo líq.</div><div class="sc-value" style="color:${saldoMin >= 0 ? '#16a34a' : '#dc2626'}">${saldoMin >= 0 ? '+' : ''}${minutesToDisplay(saldoMin)}</div></div>
      <div class="summary-card"><div class="sc-label">Faltas</div><div class="sc-value" style="color:#dc2626">${e.faltaCount || 0}</div></div>
      ${e.pendingDays > 0 ? `<div class="summary-card" style="background:#fef3c7"><div class="sc-label">Pendentes (ímpar)</div><div class="sc-value" style="color:#b45309">${e.pendingDays}</div></div>` : ''}
    </div>

    ${probTable}
    ${heTable}

    <h2>Jornada dia a dia — saldo = trabalhado − esperado</h2>
    <table>
      <thead><tr><th>Data</th><th>Dia</th><th>Batidas</th><th class="text-right">Esperado</th><th class="text-right">Trabalhado</th><th class="text-right">Saldo</th></tr></thead>
      <tbody>${dayTable}
        <tr class="total-row">
          <td colspan="3">TOTAL DO PERÍODO (dias presentes)</td>
          <td class="text-right mono"><b>${minutesToDisplay(e.expectedPresentMin)}</b></td>
          <td class="text-right mono"><b>${minutesToDisplay(e.workedTotalMin)}</b></td>
          <td class="text-right mono" style="color:${saldoMin >= 0 ? '#16a34a' : '#dc2626'}"><b>${saldoMin > 0 ? '+' + minutesToDisplay(saldoMin) + ' HE' : (saldoMin < 0 ? minutesToDisplay(saldoMin) : '0:00')}</b></td>
        </tr>
      </tbody>
    </table>

    <div class="sig">
      <div>${escapeHtml(emp.name)}<br>Assinatura do funcionário</div>
      <div>Responsável — RH</div>
    </div>
  `;
}

// Detalhado: uma página por funcionário (faltas + horas extras + líquido).
export function printEmployeeEvaluationDetailed(employees: EmployeeTimesheetData[], periodLabel: string, advances: number[] = []) {
  const pages = employees.map((emp, idx) => `
    ${idx > 0 ? '<div style="page-break-before:always"></div>' : ''}
    ${evaluationEmployeeInnerHtml(emp, periodLabel, advances[idx] || 0)}
  `).join('');
  printHtml('Demonstrativo Individual', `${EVAL_STYLE}${pages}`);
}

// Resumo: uma linha por funcionário, pra visão geral.
export function printEmployeeEvaluationSummary(employees: EmployeeTimesheetData[], periodLabel: string) {
  const all = employees.map(emp => ({ name: emp.name, ...evaluationDetail(emp) }));
  const formatMoney = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const rows = all.map(e => `
    <tr>
      <td class="emp-name">${escapeHtml(e.name)}</td>
      <td class="text-center">${e.faltaCount || '—'}</td>
      <td class="text-right mono">${e.atrasoMin > 0 ? `<b style="color:#dc2626">${minutesToDisplay(e.atrasoMin)}</b>` : '—'}</td>
      <td class="text-right mono" style="color:#dc2626">${e.hasSalary ? (e.totalDesconto > 0 ? '-' + formatMoney(e.totalDesconto) : '—') : 'N/D'}</td>
      <td class="text-right mono">${e.heMin > 0 ? `<b style="color:#16a34a">${minutesToDisplay(e.heMin)}</b>` : '—'}</td>
      <td class="text-right mono" style="color:#16a34a">${e.hasSalary ? (e.heValue > 0 ? '+' + formatMoney(e.heValue) : '—') : 'N/D'}</td>
      <td class="text-right mono" style="color:${e.liquido >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${e.hasSalary ? (e.liquido >= 0 ? '+' : '-') + formatMoney(Math.abs(e.liquido)) : 'N/D'}</td>
      <td class="text-center mono">${e.pendingDays > 0 ? `<b style="color:#b45309">${e.pendingDays}</b>` : '—'}</td>
    </tr>
  `).join('');

  const totPend = all.reduce((s, e) => s + e.pendingDays, 0);
  const totFalta = all.reduce((s, e) => s + e.faltaCount, 0);
  const totAtraso = all.reduce((s, e) => s + e.atrasoMin, 0);
  const totDesc = all.reduce((s, e) => s + (e.hasSalary ? e.totalDesconto : 0), 0);
  const totHe = all.reduce((s, e) => s + e.heMin, 0);
  const totHeVal = all.reduce((s, e) => s + (e.hasSalary ? e.heValue : 0), 0);
  const totLiquido = totHeVal - totDesc;

  const html = `
    <h1>🧭 Avaliação de Jornada — Resumo Geral</h1>
    <p class="subtitle">Período: ${escapeHtml(periodLabel)} · ${employees.length} funcionários · Líquido do período (mesma conta da Folha) · Impresso em ${new Date().toLocaleString('pt-BR')}</p>

    <div style="display:flex;gap:6px;margin:4px 0;flex-wrap:wrap">
      <div class="summary-card"><div class="sc-label">Total Faltas</div><div class="sc-value" style="color:#dc2626">${totFalta}</div></div>
      <div class="summary-card"><div class="sc-label">Total Atraso líq.</div><div class="sc-value" style="color:#dc2626">${minutesToDisplay(totAtraso)}</div></div>
      <div class="summary-card"><div class="sc-label">Total Desconto</div><div class="sc-value" style="color:#dc2626">-${formatMoney(totDesc)}</div></div>
      <div class="summary-card"><div class="sc-label">Total HE líq.</div><div class="sc-value" style="color:#16a34a">${minutesToDisplay(totHe)}</div></div>
      <div class="summary-card"><div class="sc-label">Total Valor HE</div><div class="sc-value" style="color:#16a34a">+${formatMoney(totHeVal)}</div></div>
      <div class="summary-card"><div class="sc-label">Líquido Geral</div><div class="sc-value" style="color:${totLiquido >= 0 ? '#16a34a' : '#dc2626'}">${totLiquido >= 0 ? '+' : '-'}${formatMoney(Math.abs(totLiquido))}</div></div>
    </div>

    <h2>Por Funcionário</h2>
    <table>
      <thead><tr>
        <th>Funcionário</th>
        <th class="text-center">Faltas</th>
        <th class="text-right">Atraso líq.</th>
        <th class="text-right">Desconto</th>
        <th class="text-right">HE líq.</th>
        <th class="text-right">Valor HE</th>
        <th class="text-right">Líquido</th>
        <th class="text-center">Pend.</th>
      </tr></thead>
      <tbody>${rows}
        <tr class="total-row" style="font-size:12px">
          <td><b>TOTAL</b></td>
          <td class="text-center mono"><b>${totFalta || '—'}</b></td>
          <td class="text-right mono" style="color:#dc2626"><b>${minutesToDisplay(totAtraso)}</b></td>
          <td class="text-right mono" style="color:#dc2626"><b>-${formatMoney(totDesc)}</b></td>
          <td class="text-right mono" style="color:#16a34a"><b>${minutesToDisplay(totHe)}</b></td>
          <td class="text-right mono" style="color:#16a34a"><b>+${formatMoney(totHeVal)}</b></td>
          <td class="text-right mono" style="color:${totLiquido >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${totLiquido >= 0 ? '+' : '-'}${formatMoney(Math.abs(totLiquido))}</td>
          <td class="text-center mono">${totPend > 0 ? `<b style="color:#b45309">${totPend}</b>` : '—'}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:16px;font-size:10px;color:#222;line-height:1.5">
      <b>Como ler:</b> Mesma conta da FOLHA (salário − descontos), LÍQUIDA do período ·
      <b>Hora extra</b> só quando o total trabalhado passa do esperado (fim de semana/após-18h abatem o déficit antes) = horas × valor-hora (salário ÷ 220) × 1,5 ·
      <b>Atraso líq.</b> = quanto faltou pra meta do período × valor-hora · <b>Falta</b> = −1 dia (salário ÷ 30) ·
      <b>Líquido</b> = Valor HE − Desconto · <b>Pend.</b> = dias com batida ímpar fora do cálculo.
    </div>
  `;

  printHtml('Avaliação de Jornada — Resumo', `${EVAL_STYLE}${html}`);
}

// ── FOLHA COMPARATIVA: Mês × 1ª × 2ª quinzena, líquido por funcionário (paisagem) ──
// Mesma ideia do relatório de auditoria de maio, mas com o cálculo CORRETO (motor da
// folha — HE líquida do período, base da quinzena proporcional aos dias).
export function printFolhaComparativo(
  rows: { ext?: string; name: string; salary: number; mes: number; q1: number; q2: number; sit: { txt: string; tone: 'green' | 'amber' | 'red' } }[],
  periodLabel: string,
  opts: { lastDay: number; totals: { salarios: number; mes: number; q1: number; q2: number } },
): void {
  const money = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
  const sitColor: Record<string, string> = { green: '#1E7D32', amber: '#B45309', red: '#C0392B' };
  const STYLE = `<style>
    @page { size: A4 landscape; margin: 10mm 10mm; }
    body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #111; margin: 0; }
    h1 { font-size: 17px; margin: 0 0 2px; color: #1F2A44; }
    .sub { font-size: 9px; color: #555; font-style: italic; margin: 0 0 8px; }
    .warn { border: 0.8px solid #B45309; background: #FFFBEB; border-radius: 4px; padding: 7px 10px; font-size: 9.5px; line-height: 1.4; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    .kpi td { border: 0.5px solid #D0D0D0; padding: 5px 8px; font-size: 10px; text-align: center; }
    .kpi .h { background: #1F2A44; color: #fff; font-weight: 700; }
    .kpi .v { background: #E8EDF5; color: #1F2A44; font-weight: 800; font-size: 12px; }
    .cmp { margin-top: 10px; }
    .cmp th { background: #1F2A44; color: #fff; font-size: 9px; font-weight: 700; padding: 5px 7px; text-align: left; }
    .cmp th.r { text-align: right; }
    .cmp td { border: 0.4px solid #D0D0D0; padding: 4px 7px; font-size: 9.5px; }
    .cmp tbody tr:nth-child(even) td { background: #FAFAFA; }
    .r { text-align: right; font-variant-numeric: tabular-nums; }
    .mono { font-family: 'SFMono-Regular','Courier New',monospace; }
    .tot td { background: #E8EDF5; font-weight: 800; border-top: 1px solid #1F2A44; }
    .note { margin-top: 8px; font-size: 8.5px; color: #555; font-style: italic; line-height: 1.4; }
    tr { page-break-inside: avoid; }
  </style>`;

  const kpi = `<table class="kpi"><tr>
    <td class="h">Funcionários</td><td class="h">Salários</td><td class="h">LÍQUIDO Mês</td><td class="h">LÍQUIDO 1ª quinz</td><td class="h">LÍQUIDO 2ª quinz</td>
  </tr><tr>
    <td class="v">${rows.length}</td><td class="v">${money(opts.totals.salarios)}</td><td class="v">${money(opts.totals.mes)}</td><td class="v">${money(opts.totals.q1)}</td><td class="v">${money(opts.totals.q2)}</td>
  </tr></table>`;

  const body = rows.map(r => `
    <tr>
      <td class="mono">${escapeHtml(r.ext || '—')}</td>
      <td>${escapeHtml(r.name)}</td>
      <td class="r mono">${money(r.salary)}</td>
      <td class="r mono"><b>${money(r.mes)}</b></td>
      <td class="r mono">${money(r.q1)}</td>
      <td class="r mono">${money(r.q2)}</td>
      <td style="color:${sitColor[r.sit.tone]};font-size:8.5px">${escapeHtml(r.sit.txt)}</td>
    </tr>`).join('');

  const html = `${STYLE}
    <h1>FOLHA ${escapeHtml(periodLabel)} — Comparativo (Mês × Quinzenas)</h1>
    <p class="sub">Líquido por funcionário · motor da folha (hora extra só no excedente, base da quinzena proporcional aos dias) · Impresso em ${new Date().toLocaleString('pt-BR')}</p>
    <div class="warn"><b>Leia antes de pagar:</b> hora extra conta SÓ no excedente — quem não bateu a meta de horas do período NÃO tem HE; fim de semana / após-18h abatem o déficit; falta = −1 dia. Os valores refletem o ponto <b>como foi importado</b> — confira a coluna <b>Situação</b> e corrija o ponto antes de pagar.</div>
    ${kpi}
    <table class="cmp">
      <thead><tr>
        <th>Matríc.</th><th>Funcionário</th><th class="r">Salário</th>
        <th class="r">Mês (01–${opts.lastDay})</th><th class="r">1ª quinz (01–15)</th><th class="r">2ª quinz (16–${opts.lastDay})</th><th>Situação</th>
      </tr></thead>
      <tbody>${body}
        <tr class="tot">
          <td></td><td>TOTAL (${rows.length})</td>
          <td class="r mono">${money(opts.totals.salarios)}</td>
          <td class="r mono">${money(opts.totals.mes)}</td>
          <td class="r mono">${money(opts.totals.q1)}</td>
          <td class="r mono">${money(opts.totals.q2)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
    <p class="note">Nota: 1ª + 2ª quinzena somam mais que o mês porque a base é proporcional aos dias (1ª = 15/30, 2ª = ${opts.lastDay - 15}/30 ⇒ ${opts.lastDay}/30); o mês cheio paga 30/30 (salário). O detalhe dia a dia de cada funcionário sai no Demonstrativo Individual (selecione o funcionário e imprima).</p>
  `;

  printHtml('Folha — Comparativo', html);
}
