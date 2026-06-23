// Impressão (→ PDF via "Salvar como PDF") do Relatório de Atrasos.
// Abre uma janela própria com HTML/CSS hardcoded (igual aos demais prints do app —
// papel A4 precisa de tons garantidos, fora do design-token system).
//
// Duas saídas:
//   • printEmployeeAtraso  — 1 funcionário: calendário + dias com batidas + R$/dia
//   • printAtrasoSummary   — resumo do período: todos os funcionários com atraso
//
// O atraso/desconto vem do MESMO motor da folha (computePeriodFolha), então o PDF
// bate exatamente com a tela e com a coluna ATRASOS da Folha do Mês.
import { SALARY_HOUR_DIVISOR, expectedDayMinutes } from './salaryPayroll';

export interface AtrasoPrintRow {
  name: string;
  days: { date: string; minutes: number }[];
  totalMin: number;
  punchesByDate: Map<string, string[]>;
  schedule: any;
  salary: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDia = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const hhmm = (t: string) => String(t || '').slice(0, 5);
const dowShort = (iso: string) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(iso + 'T12:00:00').getUTCDay()];
const fmtMin = (mins: number) => {
  const m = Math.round(mins);
  const h = Math.floor(m / 60), mm = m % 60;
  if (h === 0) return `${mm}min`;
  return mm === 0 ? `${h}h` : `${h}h${pad(mm)}`;
};
const fmtBRL = (v: number) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const MES_LABEL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
function monthsBetween(from: string, to: string): { y: number; m: number }[] {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out: { y: number; m: number }[] = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) { out.push({ y, m }); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

const CSS = `
  *{box-sizing:border-box} body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;font-size:11px}
  .wrap{padding:14mm 12mm}
  h1{font-size:20px;font-weight:800;margin:0 0 2px;letter-spacing:-.01em}
  .eyebrow{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#888}
  .sub{font-size:10px;color:#555;margin:2px 0 12px}
  .sub strong{color:#1a1a1a}
  .kpis{display:flex;gap:8px;margin:10px 0 14px}
  .kpi{flex:1;border:1px solid #e3e3e3;border-radius:6px;padding:7px 9px}
  .kpi .l{font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888}
  .kpi .v{font-size:17px;font-weight:800;margin-top:2px}
  .kpi.amber .v{color:#b45309}
  .month{margin:0 0 10px;break-inside:avoid}
  .month .mlabel{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#666;margin:0 0 4px}
  .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
  .cal .h{text-align:center;font-size:8px;font-weight:700;text-transform:uppercase;color:#999;padding:2px 0}
  .cal .cell{border:1px solid #e3e3e3;border-radius:4px;min-height:40px;padding:3px 4px}
  .cal .cell .d{font-size:9px;font-weight:700;color:#777;line-height:1}
  .cal .cell .pe{font-size:8px;color:#999;font-family:'SF Mono',monospace;margin-top:3px}
  .cal .late{background:#fff7ed;border-color:#f59e0b}
  .cal .late .d{color:#b45309}
  .cal .late .min{display:block;font-size:10px;font-weight:800;color:#b45309;margin-top:3px;line-height:1}
  .cal .late .pe{color:#b45309}
  .cal .outside{opacity:.28}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th{font-size:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#888;text-align:left;border-bottom:1.5px solid #1a1a1a;padding:5px 6px}
  th.r,td.r{text-align:right}
  td{border-bottom:1px solid #ececec;padding:5px 6px;vertical-align:top}
  td .dt{font-weight:700}
  td .dow{color:#999;font-weight:400;font-size:9px}
  td .punches{font-family:'SF Mono',monospace;color:#666;font-size:9px;margin-top:1px}
  td.amber{color:#b45309;font-weight:700;text-align:right;white-space:nowrap}
  td.amber .rs{display:block;color:#888;font-weight:400;font-size:9px}
  tfoot td{border-top:1.5px solid #1a1a1a;font-weight:800}
  .foot{margin-top:14px;font-size:9px;color:#aaa;border-top:1px solid #eee;padding-top:6px}
  @page{size:A4 portrait;margin:0}
`;

function openPrint(title: string, inner: string) {
  const w = window.open('', '_blank');
  if (!w) { alert('Permita pop-ups neste site para gerar o PDF.'); return; }
  const now = new Date();
  const stamp = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  w.document.write(
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head>` +
    `<body><div class="wrap">${inner}<div class="foot">Squad Shoes · Relatório de Atrasos · gerado em ${stamp} · fonte: registro do relógio de ponto</div></div>` +
    `<script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`,
  );
  w.document.close();
}

/** Calendário (um por mês) marcando os dias de atraso, com a entrada batida. */
function calendarHTML(row: AtrasoPrintRow, from: string, to: string): string {
  const lateMap = new Map(row.days.map((d) => [d.date, d.minutes]));
  return monthsBetween(from, to).map(({ y, m }) => {
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells: string[] = [];
    for (let i = 0; i < lead; i++) cells.push('<div></div>');
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${y}-${pad(m)}-${pad(day)}`;
      const inPeriod = date >= from && date <= to;
      const punches = row.punchesByDate.get(date) || [];
      const lateMin = lateMap.get(date);
      const cls = ['cell', !inPeriod ? 'outside' : '', lateMin != null ? 'late' : ''].filter(Boolean).join(' ');
      const body = lateMin != null
        ? `<span class="min">${fmtMin(lateMin)}</span>${punches[0] ? `<span class="pe">↦ ${hhmm(punches[0])}</span>` : ''}`
        : (punches[0] ? `<span class="pe">${hhmm(punches[0])}</span>` : '');
      cells.push(`<div class="${cls}"><span class="d">${day}</span>${body}</div>`);
    }
    const head = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((h) => `<div class="h">${h}</div>`).join('');
    return `<div class="month"><div class="mlabel">${MES_LABEL[m - 1]} ${y}</div><div class="cal">${head}${cells.join('')}</div></div>`;
  }).join('');
}

/** PDF de UM funcionário: calendário + tabela dia-a-dia (batidas + R$). */
export function printEmployeeAtraso(row: AtrasoPrintRow, from: string, to: string) {
  const valorHora = (Number(row.salary) || 0) / SALARY_HOUR_DIVISOR;
  const totalRS = (row.totalMin / 60) * valorHora;
  const expMin = expectedDayMinutes(row.schedule);
  const expWindow = row.schedule
    ? `${hhmm(row.schedule.entry_time)}–${hhmm(row.schedule.exit_time)}${row.schedule.lunch_start ? ` · almoço ${hhmm(row.schedule.lunch_start)}–${hhmm(row.schedule.lunch_end)}` : ''}`
    : '—';
  const tableRows = row.days.map((d) => {
    const punches = row.punchesByDate.get(d.date) || [];
    const rs = (d.minutes / 60) * valorHora;
    return `<tr><td><span class="dt">${fmtDia(d.date)}</span> <span class="dow">${dowShort(d.date)}</span>` +
      `<div class="punches">${punches.length ? punches.map(hhmm).join('  ·  ') : 'sem batidas'}</div></td>` +
      `<td class="amber">${fmtMin(d.minutes)}<span class="rs">${fmtBRL(rs)}</span></td></tr>`;
  }).join('');
  const inner =
    `<div class="eyebrow">Atrasos · ${fmtDia(from)}–${fmtDia(to)}</div>` +
    `<h1>${esc(row.name)}</h1>` +
    `<div class="sub">Jornada esperada: <strong>${expWindow}</strong> (${fmtMin(expMin)}/dia). Horários do relógio de ponto.</div>` +
    `<div class="kpis"><div class="kpi"><div class="l">Dias com atraso</div><div class="v">${row.days.length}</div></div>` +
    `<div class="kpi amber"><div class="l">Total atrasado</div><div class="v">${fmtMin(row.totalMin)}</div></div>` +
    `<div class="kpi amber"><div class="l">Desconto</div><div class="v">${fmtBRL(totalRS)}</div></div></div>` +
    calendarHTML(row, from, to) +
    `<table><thead><tr><th>Dia · batidas do relógio</th><th class="r">Déficit · desconto</th></tr></thead>` +
    `<tbody>${tableRows}</tbody>` +
    `<tfoot><tr><td>Total · ${row.days.length} dia${row.days.length === 1 ? '' : 's'}</td><td class="amber">${fmtMin(row.totalMin)}<span class="rs">${fmtBRL(totalRS)}</span></td></tr></tfoot></table>`;
  openPrint(`Atrasos — ${row.name}`, inner);
}

/** PDF resumo: todos os funcionários com atraso no período. */
export function printAtrasoSummary(rows: AtrasoPrintRow[], from: string, to: string) {
  const totDias = rows.reduce((s, r) => s + r.days.length, 0);
  const totMin = rows.reduce((s, r) => s + r.totalMin, 0);
  const totRS = rows.reduce((s, r) => s + (r.totalMin / 60) * ((Number(r.salary) || 0) / SALARY_HOUR_DIVISOR), 0);
  const body = rows.map((r) => {
    const rs = (r.totalMin / 60) * ((Number(r.salary) || 0) / SALARY_HOUR_DIVISOR);
    const chips = r.days.map((d) => `${fmtDia(d.date).slice(0, 5)} ${fmtMin(d.minutes)}`).join('   ·   ');
    return `<tr><td><span class="dt">${esc(r.name)}</span><div class="punches">${chips}</div></td>` +
      `<td class="r">${r.days.length}</td>` +
      `<td class="amber">${fmtMin(r.totalMin)}<span class="rs">${fmtBRL(rs)}</span></td></tr>`;
  }).join('');
  const inner =
    `<div class="eyebrow">Relatório de Atrasos</div>` +
    `<h1>Resumo por funcionário</h1>` +
    `<div class="sub">Período <strong>${fmtDia(from)}–${fmtDia(to)}</strong>. Atraso/desconto idênticos à Folha do Mês (salário ÷ 220, sem compensação entre dias).</div>` +
    `<div class="kpis"><div class="kpi"><div class="l">Funcionários com atraso</div><div class="v">${rows.length}</div></div>` +
    `<div class="kpi"><div class="l">Dias com atraso</div><div class="v">${totDias}</div></div>` +
    `<div class="kpi amber"><div class="l">Tempo total atrasado</div><div class="v">${fmtMin(totMin)}</div></div></div>` +
    `<table><thead><tr><th>Funcionário · dias</th><th class="r">Dias</th><th class="r">Atraso · desconto</th></tr></thead>` +
    `<tbody>${body}</tbody>` +
    `<tfoot><tr><td>Total</td><td class="r">${totDias}</td><td class="amber">${fmtMin(totMin)}<span class="rs">${fmtBRL(totRS)}</span></td></tr></tfoot></table>`;
  openPrint('Relatório de Atrasos', inner);
}
