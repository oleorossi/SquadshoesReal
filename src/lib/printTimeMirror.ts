import { printHtml } from './printOrder';

export interface TimeMirrorDay {
  date: string;          // YYYY-MM-DD
  dayOfWeek: number;     // 0=Sun
  punches: string[];     // ['08:00','12:00','13:00','18:00']
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number;
  status: 'normal' | 'overtime' | 'absent' | 'holiday' | 'weekend' | 'incomplete';
  notes?: string;
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

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Gera o "espelho de ponto" mensal — relatório individual por funcionário,
 * com batidas dia a dia, totais e área de assinatura. Conforme Portaria
 * 671/2021 (anexo II) o relatório precisa de:
 *   - Identificação do empregador e empregado
 *   - Período de apuração
 *   - Marcações por dia (todas as batidas)
 *   - Totais: trabalhadas, esperadas, HE, faltas, banco de horas
 *   - Espaço para assinatura do empregado e empregador
 */
export function printTimeMirror(params: {
  employee: TimeMirrorEmployee;
  company: TimeMirrorCompany;
  period: string;          // YYYY-MM
  days: TimeMirrorDay[];
  bankHoursBalance?: number; // saldo do banco em minutos
  observations?: string;
}): void {
  const { employee, company, period, days, bankHoursBalance, observations } = params;
  const totalWorked = days.reduce((s, d) => s + d.workedMinutes, 0);
  const totalExpected = days.reduce((s, d) => s + d.expectedMinutes, 0);
  const totalOT = days.reduce((s, d) => s + d.overtimeMinutes, 0);
  const totalAbsent = days.filter(d => d.status === 'absent').length;
  const periodLabel = (() => {
    const [y, m] = period.split('-');
    return `${m.padStart(2, '0')}/${y}`;
  })();

  const rows = days.map(d => {
    const dow = DOW_LABELS[d.dayOfWeek];
    const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
    const isHoliday = d.status === 'holiday';
    const isAbsent = d.status === 'absent';
    const bgColor = isHoliday ? '#fff3cd' : isWeekend ? '#f5f5f0' : '#ffffff';
    const punchCells = [0, 1, 2, 3, 4, 5].map(i => {
      const p = d.punches[i] || '';
      return `<td style="border:1px solid #999;padding:4px 6px;text-align:center;font-family:monospace;font-size:11px;">${p}</td>`;
    }).join('');
    const note = isHoliday ? 'FERIADO' : isAbsent ? 'FALTA' : isWeekend && d.workedMinutes === 0 ? 'DSR' : (d.notes || '');
    return `
      <tr style="background:${bgColor};">
        <td style="border:1px solid #999;padding:4px 6px;text-align:center;font-weight:600;">${fmtDate(d.date)}</td>
        <td style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;color:#666;">${dow}</td>
        ${punchCells}
        <td style="border:1px solid #999;padding:4px 6px;text-align:center;font-family:monospace;">${fmtMin(d.workedMinutes)}</td>
        <td style="border:1px solid #999;padding:4px 6px;text-align:center;font-family:monospace;color:#0369a1;font-weight:600;">${d.overtimeMinutes > 0 ? fmtMin(d.overtimeMinutes) : ''}</td>
        <td style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;color:#666;font-weight:600;">${note}</td>
      </tr>
    `;
  }).join('');

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<title>Espelho de Ponto — ${employee.name} — ${periodLabel}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; font-size: 11px; }
  .header { border:2px solid #111; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; }
  .header h1 { margin:0; font-size:14px; font-weight:900; text-transform:uppercase; }
  .header .small { font-size:10px; color:#444; }
  table { border-collapse:collapse; width:100%; margin-bottom:6px; }
  th { background:#e0e0c8; border:1px solid #999; padding:4px 6px; font-size:10px; text-transform:uppercase; }
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:0; border:1px solid #999; padding:6px 10px; margin-bottom:6px; font-size:10px; }
  .info-grid div { padding:2px 0; }
  .info-grid strong { display:inline-block; min-width:90px; color:#444; }
  .totals { display:grid; grid-template-columns:repeat(5, 1fr); gap:0; border:2px solid #111; padding:6px 10px; margin-top:8px; font-size:11px; }
  .totals .cell { text-align:center; }
  .totals .label { font-size:9px; text-transform:uppercase; color:#666; }
  .totals .value { font-size:14px; font-weight:900; font-family:monospace; }
  .signatures { margin-top:30px; display:grid; grid-template-columns:1fr 1fr; gap:40px; font-size:10px; }
  .sig { border-top:1px solid #111; padding-top:4px; text-align:center; }
  .obs { margin-top:12px; padding:6px 10px; border:1px dashed #999; font-size:10px; min-height:30px; }
  .footer { margin-top:8px; font-size:8px; color:#888; text-align:center; }
</style>
</head><body>

<div class="header">
  <div>
    <h1>${company.name}</h1>
    <div class="small">${company.cnpj ? 'CNPJ: ' + company.cnpj : ''}${company.cei ? ' • CEI: ' + company.cei : ''}</div>
    <div class="small">${company.address || ''}</div>
  </div>
  <div style="text-align:right;">
    <h1>Espelho de Ponto</h1>
    <div class="small">Período: <strong>${periodLabel}</strong></div>
    <div class="small">Emitido em ${new Date().toLocaleDateString('pt-BR')}</div>
  </div>
</div>

<div class="info-grid">
  <div><strong>Funcionário:</strong> ${employee.name}</div>
  <div><strong>Matrícula:</strong> ${employee.external_id || '—'}</div>
  <div><strong>Cargo:</strong> ${employee.role || '—'}</div>
  <div><strong>Setor:</strong> ${employee.department || '—'}</div>
  <div><strong>CPF:</strong> ${employee.cpf || '—'}</div>
  <div><strong>PIS:</strong> ${employee.pis || '—'}</div>
  <div><strong>Admissão:</strong> ${employee.admission_date ? fmtDate(employee.admission_date) : '—'}</div>
  <div></div>
</div>

<table>
  <thead>
    <tr>
      <th rowspan="2">Data</th><th rowspan="2">Dia</th>
      <th colspan="6">Marcações</th>
      <th rowspan="2">Trab.</th><th rowspan="2">HE</th><th rowspan="2">Obs.</th>
    </tr>
    <tr>
      <th>1ª</th><th>2ª</th><th>3ª</th><th>4ª</th><th>5ª</th><th>6ª</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div class="totals">
  <div class="cell"><div class="label">Trabalhadas</div><div class="value">${fmtMin(totalWorked)}</div></div>
  <div class="cell"><div class="label">Esperadas</div><div class="value">${fmtMin(totalExpected)}</div></div>
  <div class="cell"><div class="label">Horas extras</div><div class="value" style="color:#0369a1;">${fmtMin(totalOT)}</div></div>
  <div class="cell"><div class="label">Faltas</div><div class="value" style="color:#c00;">${totalAbsent}</div></div>
  <div class="cell"><div class="label">Banco de horas</div><div class="value">${bankHoursBalance !== undefined ? fmtMin(bankHoursBalance) : '—'}</div></div>
</div>

${observations ? `<div class="obs"><strong>Observações:</strong> ${observations}</div>` : '<div class="obs">&nbsp;</div>'}

<div class="signatures">
  <div class="sig">Assinatura do Empregado</div>
  <div class="sig">Assinatura do Empregador</div>
</div>

<div class="footer">
  Documento gerado conforme Portaria MTP nº 671/2021. Confira as marcações
  e assine ao final. Em caso de divergência, comunicar ao RH em até 5 dias úteis.
</div>

</body></html>`;

  printHtml(`Espelho de Ponto — ${employee.name}`, html);
}
