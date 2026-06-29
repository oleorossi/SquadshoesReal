// Impressão UNIFICADA da Folha (2026-06-28): gera UM único documento (uma janela só)
// com os tipos de documento selecionados — Folha · Calendário de tempo · Holerite — para
// o escopo escolhido (todos os funcionários ou apenas um). Evita abrir N popups (que o
// navegador bloqueia depois do 1º) concatenando tudo numa página com quebras de página.
//
// Self-contained de propósito (inline styles + cores hardcoded, igual às demais fichas de
// impressão do projeto) — não depende de tokens/print CSS do app. Reusa os dados já
// calculados em Payroll (runs + comparativo.printData.days), sem refazer fórmula.

export type BundleRun = {
  base_salary: number; total_proventos: number; overtime_amount: number;
  overtime_50_minutes?: number; absent_days?: number; absence_discount?: number;
  deductions_amount?: number; advances_total?: number; total_descontos?: number;
  total_liquido: number; worked_minutes?: number; hourly_rate?: number; period: string;
};
export type BundleDay = {
  date: string; expectedMinutes?: number; workedMinutes?: number;
  overtimeMinutes?: number; status?: string;
};
export type BundleEmployee = {
  id: string; name: string; role?: string; department?: string;
  run: BundleRun; days: BundleDay[];
};

const fmt = (v: number) =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtH = (min: number) => {
  const m = Math.round(Number(min) || 0);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, '0')}`;
};

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Consolidado por setor: 1 linha por setor (proventos/descontos/adiant./líquido)
//    + total geral. Visão gerencial pra fechar a folha por departamento. ────────
function sectorSummarySection(emps: BundleEmployee[], periodTitle: string): string {
  const map = new Map<string, { count: number; prov: number; desc: number; adv: number; liq: number }>();
  for (const e of emps) {
    const dep = (e.department || '').trim() || 'Sem setor';
    const g = map.get(dep) || { count: 0, prov: 0, desc: 0, adv: 0, liq: 0 };
    g.count += 1;
    g.prov += e.run.total_proventos || 0;
    g.desc += (e.run.absence_discount || 0) + (e.run.deductions_amount || 0);
    g.adv += e.run.advances_total || 0;
    g.liq += e.run.total_liquido || 0;
    map.set(dep, g);
  }
  const groups = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  const rows = groups.map(([dep, g]) => `<tr>
    <td style="text-align:left;font-weight:600;">${esc(dep)}</td>
    <td>${g.count}</td>
    <td style="color:#047857;">${fmt(g.prov)}</td>
    <td style="color:#b91c1c;">${g.desc > 0 ? '−' + fmt(g.desc) : '—'}</td>
    <td style="color:#b45309;">${g.adv > 0 ? '−' + fmt(g.adv) : '—'}</td>
    <td style="font-weight:700;">${fmt(g.liq)}</td>
  </tr>`).join('');
  const tot = groups.reduce((a, [, g]) => ({
    count: a.count + g.count, prov: a.prov + g.prov, desc: a.desc + g.desc, adv: a.adv + g.adv, liq: a.liq + g.liq,
  }), { count: 0, prov: 0, desc: 0, adv: 0, liq: 0 });
  return `<section class="doc">
    <h2>Folha por setor · ${esc(periodTitle)}</h2>
    <table class="grid">
      <thead><tr>
        <th style="text-align:left;">Setor</th><th>Func.</th><th>Proventos</th>
        <th>Descontos</th><th>Adiant.</th><th>Líquido</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td style="text-align:left;font-weight:800;">TOTAL (${tot.count})</td><td></td>
        <td style="font-weight:800;color:#047857;">${fmt(tot.prov)}</td>
        <td style="font-weight:800;color:#b91c1c;">${tot.desc > 0 ? '−' + fmt(tot.desc) : '—'}</td>
        <td style="font-weight:800;color:#b45309;">${tot.adv > 0 ? '−' + fmt(tot.adv) : '—'}</td>
        <td style="font-weight:800;">${fmt(tot.liq)}</td>
      </tr></tfoot>
    </table>
  </section>`;
}

// ── Folha: uma tabela com todos os funcionários do escopo ────────────────────
function folhaSection(emps: BundleEmployee[], periodTitle: string): string {
  const rows = emps.map(e => {
    const r = e.run;
    const salario = (r.total_proventos || 0) - (r.overtime_amount || 0);
    const faltas = (r.absent_days || 0) > 0 ? `${r.absent_days}d · −${fmt(r.absence_discount || 0)}` : '—';
    const atrasos = (r.deductions_amount || 0) > 0 ? `−${fmt(r.deductions_amount || 0)}` : '—';
    const he = (r.overtime_amount || 0) > 0 ? `+${fmt(r.overtime_amount || 0)}` : '—';
    return `<tr>
      <td style="text-align:left;font-weight:600;">${esc(e.name)}</td>
      <td>${fmt(salario)}</td>
      <td style="color:${(r.absent_days || 0) > 0 ? '#b91c1c' : '#9ca3af'};">${faltas}</td>
      <td style="color:${(r.deductions_amount || 0) > 0 ? '#b91c1c' : '#9ca3af'};">${atrasos}</td>
      <td style="color:${(r.overtime_amount || 0) > 0 ? '#047857' : '#9ca3af'};">${he}</td>
      <td style="font-weight:700;">${fmt(r.total_liquido)}</td>
    </tr>`;
  }).join('');
  const totLiq = emps.reduce((s, e) => s + (e.run.total_liquido || 0), 0);
  return `<section class="doc">
    <h2>Folha · ${esc(periodTitle)}</h2>
    <table class="grid">
      <thead><tr>
        <th style="text-align:left;">Funcionário</th><th>Salário</th><th>Faltas</th>
        <th>Atrasos</th><th>Hora extra</th><th>Líquido</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td style="text-align:left;font-weight:700;">TOTAL (${emps.length})</td>
        <td colspan="4"></td><td style="font-weight:800;">${fmt(totLiq)}</td>
      </tr></tfoot>
    </table>
  </section>`;
}

// ── Calendário de tempo: grade semanal por funcionário (espelha a view do app) ─
function calendarSection(e: BundleEmployee, periodTitle: string): string {
  const cell = (d: BundleDay) => {
    const exp = d.expectedMinutes || 0, w = d.workedMinutes || 0;
    let bg = '#fff', color = '#111', label = '—';
    if (exp === 0) { bg = '#f3f4f6'; color = '#6b7280'; label = '—'; }
    else if (w === 0) { bg = '#fee2e2'; color = '#b91c1c'; label = 'falta'; }
    else if ((d.overtimeMinutes || 0) > 0 || w > exp) { bg = '#d1fae5'; color = '#047857'; label = '+' + (Math.round((w - exp) / 6) / 10) + 'h'; }
    else if (w < exp) { bg = '#fef3c7'; color = '#b45309'; label = '−' + (Math.round((exp - w) / 6) / 10) + 'h'; }
    else { label = Math.round(w / 60) + 'h'; }
    const dd = `${String(d.date).slice(8, 10)}/${String(d.date).slice(5, 7)}`;
    return `<td style="background:${bg};color:${color};border:1px solid #d1d5db;padding:4px 2px;text-align:center;width:14.28%;">
      <div style="font-size:9px;opacity:.7;">${dd}</div>
      <div style="font-size:11px;font-weight:700;">${label}</div></td>`;
  };
  const days = e.days || [];
  const weeks: BundleDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const grid = weeks.map(wk => `<tr>${wk.map(cell).join('')}${
    Array.from({ length: 7 - wk.length }, () => '<td style="border:1px solid #e5e7eb;"></td>').join('')
  }</tr>`).join('');
  return `<section class="doc">
    <h2>Calendário de tempo · ${esc(periodTitle)}</h2>
    <p class="sub">${esc(e.name)}${e.role ? ' · ' + esc(e.role) : ''}${e.department ? ' · ' + esc(e.department) : ''}</p>
    <table class="cal"><tbody>${grid}</tbody></table>
    <p class="legend"><span style="background:#d1fae5;">&nbsp;&nbsp;</span> hora extra
      &nbsp; <span style="background:#fef3c7;">&nbsp;&nbsp;</span> atraso
      &nbsp; <span style="background:#fee2e2;">&nbsp;&nbsp;</span> falta</p>
  </section>`;
}

// ── Holerite: demonstrativo salário − descontos por funcionário ───────────────
function holeriteSection(e: BundleEmployee, periodTitle: string): string {
  const r = e.run;
  const isFullMonth = /^\d{4}-\d{2}$/.test(r.period);
  const periodBase = (r.total_proventos || 0) - (r.overtime_amount || 0);
  const lines = ([
    { label: isFullMonth ? 'Salário base' : 'Salário do período (proporcional)', value: periodBase, type: 'p' as const, always: true, hi: false },
    { label: `Horas extras 1,5× (${fmtH(r.overtime_50_minutes || 0)})`, value: r.overtime_amount || 0, type: 'p' as const, always: false, hi: false },
    { label: `Faltas (${r.absent_days || 0} dia(s))`, value: r.absence_discount || 0, type: 'd' as const, always: false, hi: (r.absent_days || 0) > 0 },
    { label: 'Atrasos / saídas cedo', value: r.deductions_amount || 0, type: 'd' as const, always: false, hi: false },
    { label: 'Adiantamentos do período', value: r.advances_total || 0, type: 'd' as const, always: false, hi: true },
  ]).filter(l => l.value > 0 || l.always);
  const body = lines.map(l => `<tr${l.hi ? ' style="background:#fef3c7;"' : ''}>
    <td style="text-align:left;${l.hi ? 'color:#b45309;font-weight:600;' : ''}">${esc(l.label)}</td>
    <td>${l.type === 'p' ? fmt(l.value) : ''}</td>
    <td style="color:${l.hi ? '#b45309' : '#b91c1c'};${l.hi ? 'font-weight:600;' : ''}">${l.type === 'd' ? fmt(l.value) : ''}</td>
  </tr>`).join('');
  return `<section class="doc">
    <h2>Holerite · ${esc(periodTitle)}</h2>
    <p class="sub">${esc(e.name)}${e.role ? ' · ' + esc(e.role) : ''}${e.department ? ' · ' + esc(e.department) : ''}
      · trabalhado ${fmtH(r.worked_minutes || 0)} · valor-hora ${fmt(r.hourly_rate || 0)} · salário mensal ${fmt(r.base_salary || 0)}</p>
    <table class="grid">
      <thead><tr><th style="text-align:left;">Descrição</th><th>Provento</th><th>Desconto</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div class="totais">
      <div><span>Bruto</span><strong style="color:#047857;">${fmt(r.total_proventos)}</strong></div>
      <div><span>Descontos</span><strong style="color:#b91c1c;">${fmt(r.total_descontos || 0)}</strong></div>
      <div><span>Líquido a receber</span><strong style="font-size:16px;color:#0f172a;">${fmt(r.total_liquido)}</strong></div>
    </div>
  </section>`;
}

export function printPayrollBundle(params: {
  periodTitle: string;
  docs: { folha: boolean; calendario: boolean; holerite: boolean; setor?: boolean };
  employees: BundleEmployee[];
}): void {
  const { periodTitle, docs, employees } = params;
  if (employees.length === 0) return;

  const sections: string[] = [];
  if (docs.setor) sections.push(sectorSummarySection(employees, periodTitle));
  if (docs.folha) sections.push(folhaSection(employees, periodTitle));
  if (docs.calendario) employees.forEach(e => sections.push(calendarSection(e, periodTitle)));
  if (docs.holerite) employees.forEach(e => sections.push(holeriteSection(e, periodTitle)));
  if (sections.length === 0) return;

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
  <title>Documentos · Folha · ${esc(periodTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Fira Sans', Arial, sans-serif; color: #111; margin: 24px; }
    h2 { font-family: 'Anton', Impact, sans-serif; font-size: 18px; text-transform: uppercase;
         letter-spacing: .5px; margin: 0 0 4px; border-bottom: 2px solid #000; padding-bottom: 4px; }
    .sub { font-size: 12px; color: #374151; margin: 0 0 10px; }
    .doc { page-break-inside: avoid; margin-bottom: 28px; }
    .doc + .doc { page-break-before: always; }
    table.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
    table.grid th, table.grid td { border: 1px solid #d1d5db; padding: 5px 8px; text-align: right; }
    table.grid th { background: #1f2937; color: #fff; text-transform: uppercase; font-size: 10px; letter-spacing: .5px; }
    table.grid tfoot td { background: #f3f4f6; }
    table.cal { width: 100%; border-collapse: collapse; }
    .legend { font-size: 10px; color: #6b7280; margin-top: 6px; }
    .legend span { display: inline-block; border: 1px solid #d1d5db; }
    .totais { display: flex; justify-content: space-between; border-top: 2px solid #000; margin-top: 10px; padding-top: 8px; }
    .totais div { display: flex; flex-direction: column; }
    .totais span { font-size: 10px; color: #6b7280; text-transform: uppercase; }
    .totais strong { font-size: 13px; }
    @media print { body { margin: 0; } @page { margin: 14mm; } }
  </style></head><body>${sections.join('')}
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 150); };</script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) return; // popup bloqueado
  w.document.open();
  w.document.write(html);
  w.document.close();
}
