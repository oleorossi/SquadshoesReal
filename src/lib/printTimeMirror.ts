import { printHtml } from './printOrder';

export interface TimeMirrorDay {
  date: string;          // YYYY-MM-DD
  dayOfWeek: number;     // 0=Sun
  punches: string[];     // ['08:00','12:00','13:00','18:00']
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number;
  // Mesma união de status do dia em useTimesheet (inclui irregular/inconsistent,
  // usados nas cores do calendário abaixo).
  status: 'normal' | 'overtime' | 'absent' | 'holiday' | 'weekend' | 'incomplete' | 'irregular' | 'inconsistent';
  notes?: string;
  /** HE pagável do dia (já com piso/versão da folha). Se omitido, estima bruto do dia. */
  payableOvertimeMinutes?: number;
  /** Bucket de taxa: normal vs domingo/feriado. */
  overtimeBucket?: 'normal' | 'holiday';
}

export interface TimeMirrorEmployee {
  name: string;
  external_id?: string;
  role?: string;
  department?: string;
  cpf?: string;
  pis?: string;
  admission_date?: string;
}

export interface TimeMirrorCompany {
  name: string;
  cnpj?: string;
  cei?: string;
  address?: string;
}

const DOW_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

function fmtMin(min: number): string {
  if (min === 0) return '00:00';
  const sign = min < 0 ? '-' : '';
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatMoney(v: number): string {
  return `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Gera o "Calendário Individual" — relatório híbrido que mescla:
 *  - Visualização em CALENDÁRIO (grid semanal com batidas dia a dia)
 *  - Dados LEGAIS exigidos pela Portaria MTP nº 671/2021 (anexo II)
 *
 * Valor HE R$: taxas do quadro (`heNormalRate` / `heSundayHolidayRate`) e, quando
 * disponível, minutos/R$ já calculados pela folha — NUNCA salário÷220×1,5.
 */
export function printTimeMirror(params: {
  employee: TimeMirrorEmployee;
  company: TimeMirrorCompany;
  period: string;          // YYYY-MM
  days: TimeMirrorDay[];
  bankHoursBalance?: number;
  observations?: string;
  /** @deprecated Preferir heNormalRate / heValueOverride. */
  monthlySalary?: number;
  heNormalRate?: number;
  heSundayHolidayRate?: number;
  heValueOverride?: number;
  heMinutesOverride?: number;
  ruleVersionLabel?: string;
}): void {
  const {
    employee, company, period, days, observations,
    heNormalRate, heSundayHolidayRate, heValueOverride, heMinutesOverride, ruleVersionLabel,
  } = params;
  const totalWorked = days.reduce((s, d) => s + d.workedMinutes, 0);
  const totalExpected = days.reduce((s, d) => s + d.expectedMinutes, 0);

  const dayHe = (d: TimeMirrorDay): number => {
    if (typeof d.payableOvertimeMinutes === 'number') return Math.max(0, d.payableOvertimeMinutes);
    if (!['normal', 'overtime', 'holiday', 'weekend'].includes(d.status)) return 0;
    return d.expectedMinutes > 0 ? Math.max(0, d.workedMinutes - d.expectedMinutes) : d.workedMinutes;
  };
  const dayBucket = (d: TimeMirrorDay): 'normal' | 'holiday' => {
    if (d.overtimeBucket === 'holiday' || d.overtimeBucket === 'normal') return d.overtimeBucket;
    return d.status === 'holiday' || d.dayOfWeek === 0 ? 'holiday' : 'normal';
  };

  const totalOT = heMinutesOverride != null
    ? Math.max(0, Number(heMinutesOverride) || 0)
    : days.reduce((s, d) => s + dayHe(d), 0);

  const rateNormal = Number(heNormalRate) || 0;
  const rateHoliday = Number(heSundayHolidayRate) > 0 ? Number(heSundayHolidayRate) : rateNormal;
  let heValue: number;
  if (heValueOverride != null) {
    heValue = Number(heValueOverride) || 0;
  } else if (rateNormal > 0 || rateHoliday > 0) {
    heValue = days.reduce((s, d) => {
      const mins = dayHe(d);
      if (mins <= 0) return s;
      const rate = dayBucket(d) === 'holiday' ? rateHoliday : rateNormal;
      return s + (mins / 60) * rate;
    }, 0);
  } else {
    heValue = 0;
  }
  const hasHeMoney = heValueOverride != null || rateNormal > 0 || rateHoliday > 0;

  const dayAtraso = (d: TimeMirrorDay): number =>
    d.expectedMinutes > 0 && d.workedMinutes > 0 ? Math.max(0, d.expectedMinutes - d.workedMinutes) : 0;
  const isFalta = (d: TimeMirrorDay): boolean => d.status === 'absent' && d.workedMinutes === 0;
  const totalAbsent = days.filter(isFalta).length;
  const totalAtraso = days.reduce((s, d) => s + dayAtraso(d), 0);
  const periodLabel = (() => {
    const [y, m] = period.split('-');
    return `${m.padStart(2, '0')}/${y}`;
  })();

  const dayMap = new Map(days.map(d => [d.date, d]));
  const allDates = days.map(d => d.date).sort();
  const weeks: string[][] = [];
  for (let i = 0; i < allDates.length; i += 7) {
    weeks.push(allDates.slice(i, i + 7));
  }

  const calendarSections = weeks.map((weekDates, wi) => {
    const headerCells = weekDates.map(d => {
      const dt = new Date(d + 'T12:00:00');
      const dow = DOW_LABELS[dt.getDay()];
      const dayNum = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      return `<th style="min-width:100px;font-size:11px;font-weight:700;padding:6px 4px;color:#fff !important;background:${isWeekend ? '#374151' : '#1f2937'} !important;">${dow}<br/>${dayNum}</th>`;
    }).join('');

    const cells = weekDates.map(d => {
      const day = dayMap.get(d);
      if (!day) return '<td style="text-align:center;color:#999;padding:6px;vertical-align:top">—</td>';
      const dt = new Date(d + 'T12:00:00');
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      const bgColor = day.status === 'absent' ? (day.workedMinutes === 0 ? '#fecaca' : '#fef3c7')
        : day.status === 'overtime' ? '#fde68a'
        : day.status === 'holiday' ? '#bfdbfe'
        : day.status === 'incomplete' ? '#fed7aa'
        : day.status === 'irregular' ? '#fbcfe8'
        : day.status === 'inconsistent' ? '#fed7aa'
        : isWeekend ? '#e5e7eb' : '#ffffff';

      const punchesStr = day.punches.length > 0
        ? day.punches.map(p => `<div style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:#000;line-height:1.3">${p}</div>`).join('')
        : '<span style="color:#666;font-size:12px">—</span>';

      const workedStr = day.workedMinutes > 0
        ? `<div style="font-size:11px;color:#000;font-weight:700;margin-top:4px;font-family:monospace;border-top:1px solid #999;padding-top:3px">Trab: ${fmtMin(day.workedMinutes)}</div>`
        : '';
      const expectedStr = day.expectedMinutes > 0
        ? `<div style="font-size:10px;color:#374151;font-weight:600;font-family:monospace">Esp: ${fmtMin(day.expectedMinutes)}</div>`
        : '';
      const heMin = dayHe(day);
      const overtimeStr = heMin > 0
        ? `<div style="font-size:11px;color:#15803d;font-weight:800;font-family:monospace;margin-top:2px;border-top:1px dashed #86efac;padding-top:2px">+${fmtMin(heMin)} HE</div>`
        : '';
      const atrasoMin = dayAtraso(day);
      const atrasoStr = atrasoMin > 0
        ? `<div style="font-size:11px;color:#b45309;font-weight:800;font-family:monospace;margin-top:2px;border-top:1px dashed #fcd34d;padding-top:2px">−${fmtMin(atrasoMin)} atraso</div>`
        : '';
      const statusLabel = isFalta(day) ? '<div style="font-size:10px;color:#7f1d1d;font-weight:800;margin-bottom:3px">FALTA</div>'
        : day.status === 'incomplete' ? '<div style="font-size:10px;color:#9a3412;font-weight:800;margin-bottom:3px">INCOMPLETO</div>'
        : day.status === 'holiday' ? '<div style="font-size:10px;color:#1e3a8a;font-weight:800;margin-bottom:3px">FERIADO</div>'
        : '';

      return `<td style="text-align:center;vertical-align:top;padding:5px 4px;background:${bgColor} !important;border:1px solid #999;">${statusLabel}${punchesStr}${workedStr}${expectedStr}${overtimeStr}${atrasoStr}</td>`;
    }).join('');

    const emptyCells = '<td style="border:1px solid #ddd;background:#fafafa;"></td>'.repeat(7 - weekDates.length);
    const emptyHeaders = '<th style="background:#9ca3af !important;"></th>'.repeat(7 - weekDates.length);
    const firstDate = weekDates[0].split('-').reverse().join('/');
    const lastDate = weekDates[weekDates.length - 1].split('-').reverse().join('/');

    return `
      <div class="week-block">
        <div class="week-title">Semana ${wi + 1} — ${firstDate} a ${lastDate}</div>
        <table class="cal-table">
          <thead><tr>${headerCells}${emptyHeaders}</tr></thead>
          <tbody><tr>${cells}${emptyCells}</tr></tbody>
        </table>
      </div>
    `;
  }).join('');

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<title>Calendário Individual — ${escapeHtml(employee.name)} — ${periodLabel}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .header { border:2px solid #111; padding:6px 10px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; }
  .header h1 { margin:0; font-size:14px; font-weight:900; text-transform:uppercase; }
  .header .small { font-size:9px; color:#444; }
  .info-grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:0 12px; border:1px solid #999; padding:5px 10px; margin-bottom:6px; font-size:10px; }
  .info-grid div { padding:2px 0; }
  .info-grid strong { display:inline-block; min-width:75px; color:#444; }
  .week-block { margin-bottom:6px; page-break-inside:avoid; }
  .week-title { font-size:11px; font-weight:800; color:#000; padding:3px 6px; background:#f3f4f6; border-left:3px solid #000; margin-bottom:2px; }
  .cal-table { width:100%; border-collapse:collapse; table-layout:fixed; }
  .cal-table th { border:1px solid #999; }
  .legend { font-size:9px; color:#444; margin:6px 0 8px; padding:4px 8px; border-top:1px solid #ccc; border-bottom:1px solid #ccc; }
  .legend .item { display:inline-block; margin-right:14px; }
  .legend .swatch { display:inline-block; width:10px; height:10px; vertical-align:middle; margin-right:3px; border:1px solid #999; }
  .totals { display:grid; grid-template-columns:repeat(6, 1fr); border:2px solid #111; padding:6px 10px; margin-top:6px; font-size:11px; page-break-inside:avoid; }
  .totals .cell { text-align:center; }
  .totals .label { font-size:9px; text-transform:uppercase; color:#666; font-weight:700; letter-spacing:0.3px; }
  .totals .value { font-size:16px; font-weight:900; font-family:monospace; }
  .signatures { margin-top:24px; display:grid; grid-template-columns:1fr 1fr; gap:60px; font-size:10px; page-break-inside:avoid; }
  .sig { border-top:1px solid #111; padding-top:5px; text-align:center; font-weight:600; }
  .obs { margin-top:8px; padding:5px 8px; border:1px dashed #999; font-size:10px; min-height:24px; }
  .footer { margin-top:6px; font-size:8px; color:#888; text-align:center; }
</style>
</head><body>

<div class="header">
  <div>
    <h1>${escapeHtml(company.name)}</h1>
    <div class="small">${company.cnpj ? 'CNPJ: ' + escapeHtml(company.cnpj) : ''}${company.cei ? ' • CEI: ' + escapeHtml(company.cei) : ''}</div>
    <div class="small">${escapeHtml(company.address || '')}</div>
  </div>
  <div style="text-align:right;">
    <h1>Calendário Individual</h1>
    <div class="small">Período: <strong>${periodLabel}</strong> · ${days.length} dias</div>
    <div class="small">Emitido em ${new Date().toLocaleString('pt-BR')}</div>
    ${ruleVersionLabel ? `<div class="small">Regra: ${escapeHtml(ruleVersionLabel)}</div>` : ''}
  </div>
</div>

<div class="info-grid">
  <div><strong>Funcionário:</strong> ${escapeHtml(employee.name)}</div>
  <div><strong>Matrícula:</strong> ${escapeHtml(employee.external_id || '—')}</div>
  <div><strong>Cargo:</strong> ${escapeHtml(employee.role || '—')}</div>
  <div><strong>Setor:</strong> ${escapeHtml(employee.department || '—')}</div>
  <div><strong>CPF:</strong> ${escapeHtml(employee.cpf || '—')}</div>
  <div><strong>PIS:</strong> ${escapeHtml(employee.pis || '—')}</div>
  <div><strong>Admissão:</strong> ${employee.admission_date ? fmtDate(employee.admission_date) : '—'}</div>
  <div></div>
</div>

${calendarSections}

<div class="legend">
  <strong>Legenda:</strong>
  <span class="item"><span class="swatch" style="background:#fecaca"></span>Falta</span>
  <span class="item"><span class="swatch" style="background:#fde68a"></span>HE</span>
  <span class="item"><span style="color:#15803d;font-weight:800">+HH:MM HE</span> = hora extra (taxas do quadro)</span>
  <span class="item"><span style="color:#b45309;font-weight:800">−HH:MM atraso</span> = déficit do dia</span>
  <span class="item"><span class="swatch" style="background:#fef3c7"></span>Atraso (parcial)</span>
  <span class="item"><span class="swatch" style="background:#bfdbfe"></span>Feriado</span>
  <span class="item"><span class="swatch" style="background:#fed7aa"></span>Incompleto</span>
  <span class="item"><span class="swatch" style="background:#e5e7eb"></span>Fim de semana</span>
</div>

<div class="totals">
  <div class="cell"><div class="label">Trabalhadas</div><div class="value">${fmtMin(totalWorked)}</div></div>
  <div class="cell"><div class="label">Esperadas</div><div class="value">${fmtMin(totalExpected)}</div></div>
  <div class="cell"><div class="label">Hora Extra</div><div class="value" style="color:#15803d;">${totalOT > 0 ? '+' + fmtMin(totalOT) : '—'}</div></div>
  <div class="cell"><div class="label">Valor HE</div><div class="value" style="color:#15803d;font-size:14px;">${hasHeMoney && heValue > 0 ? formatMoney(heValue) : (hasHeMoney ? formatMoney(0) : '—')}</div></div>
  <div class="cell"><div class="label">Atraso</div><div class="value" style="color:#b45309;">${totalAtraso > 0 ? '−' + fmtMin(totalAtraso) : '—'}</div></div>
  <div class="cell"><div class="label">Faltas</div><div class="value" style="color:#c00;">${totalAbsent}</div></div>
</div>

${observations ? `<div class="obs"><strong>Observações:</strong> ${escapeHtml(observations)}</div>` : ''}

<div class="signatures">
  <div class="sig">Assinatura do Empregado</div>
  <div class="sig">Assinatura do Empregador</div>
</div>

<div class="footer">
  Documento gerado conforme Portaria MTP nº 671/2021. Valor HE pelas taxas cadastradas no quadro.
  Confira as marcações e assine ao final. Em caso de divergência, comunicar ao RH em até 5 dias úteis.
</div>

</body></html>`;

  printHtml(`Calendário Individual — ${employee.name}`, html);
}
