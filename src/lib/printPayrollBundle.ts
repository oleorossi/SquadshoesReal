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
  status?: 'rascunho' | 'aprovado' | 'pago' | 'cancelado' | string;
  payment_type?: 'mensalista' | 'remoto' | 'diarista' | 'producao';
  he_normal_minutes?: number; he_holiday_minutes?: number;
  he_normal_rate?: number; he_sunday_holiday_rate?: number;
  raw_credit_minutes?: number; raw_delay_minutes?: number; compensated_minutes?: number;
  discarded_tolerance_minutes?: number; rule_version?: string; calculated_at?: string;
  /** Regime POR PAR (produção). Quando true, salário/faltas/atrasos/HE não se
   *  aplicam: o bruto vem de pares × R$/par da Ficha de Montadores, e o
   *  relógio de ponto é só presença. Sem isto o holerite impresso chamava o
   *  bruto de "Salário base" e mostrava valor-hora R$ 0,00. */
  por_par?: boolean;
  dias_produtivos?: number;
  fichas?: number;
  fichas_derivadas?: boolean;
  pares_medio?: number;
  pares_dificil?: number;
  /** Bruto SEPARADO por dificuldade — médio e difícil pagam R$/par diferentes,
   *  então não se rateia o bruto total pelo nº de pares. */
  bruto_medio?: number;
  bruto_dificil?: number;
  taxa_medio?: number;
  taxa_dificil?: number;
  /** Houve mais de um R$/par para a mesma dificuldade no período (reajuste). */
  taxa_variou?: boolean;
};
export type BundleDay = {
  date: string;
  day_of_week?: number;
  punches?: string[];
  expected_minutes?: number;
  worked_minutes?: number;
  excused_minutes?: number;
  raw_balance_minutes?: number;
  raw_credit_minutes?: number;
  raw_delay_minutes?: number;
  compensated_credit_minutes?: number;
  compensated_delay_minutes?: number;
  payable_overtime_minutes?: number;
  payable_delay_minutes?: number;
  discarded_tolerance_minutes?: number;
  status?: string;
};
export type BundleEmployee = {
  id: string; name: string; role?: string; department?: string;
  run: BundleRun; days: BundleDay[];
  /** Batidas BRUTAS importadas do relógio, por dia — usado só pelo Espelho
   *  (registro cru, sem cálculo). Ausente nos demais relatórios. */
  rawDays?: { date: string; punches: string[] }[];
  /** Só no Espelho: id INTERNO do funcionário da folha (ponte via external_id),
   *  pra casar o Espelho com o pacote do MESMO funcionário no modo 'employee'. */
  matchId?: string;
};

/**
 * Folhas canceladas permanecem no histórico, mas são terminais e não podem
 * voltar a compor nenhum documento ou total financeiro.
 */
export const isFinancialPayrollRun = (run: { status?: string | null }): boolean =>
  String(run.status || '').trim().toLowerCase() !== 'cancelado';

export const filterFinancialPayrollEmployees = (employees: BundleEmployee[]): BundleEmployee[] =>
  employees.filter(employee => isFinancialPayrollRun(employee.run));

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

/**
 * Delta de tempo do dia (atraso / hora extra) EM MINUTOS — resolve a imprecisão
 * de exibir "0.1h" (que são 6 min). Mostra "Nmin" abaixo de 1h e "XhYY" a partir
 * de 1h (ex.: 6 → "6min", 24 → "24min", 72 → "1h12", 318 → "5h18"). Fonte única
 * usada na grade da tela (Payroll) e na impressão (calendarSection).
 */
export const fmtDeltaMin = (mins: number): string => {
  const m = Math.abs(Math.round(Number(mins) || 0));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, '0')}`;
};

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
  const nf = (n: number) => (Number(n) || 0).toLocaleString('pt-BR');
  // Por par não tem salário, falta, atraso nem hora extra. Em vez de imprimir
  // quatro colunas mudas com "—", a linha usa o espaço delas pra mostrar o que
  // define o pagamento: dias produtivos e pares × R$/par.
  const linha = (e: BundleEmployee) => {
    const r = e.run;
    if (r.por_par) {
      const det = [`${nf(r.dias_produtivos || 0)} dia(s) produtivo(s)`,
        (r.pares_medio || 0) > 0 ? `${nf(r.pares_medio || 0)} méd × ${fmt(r.taxa_medio || 0)}` : '',
        (r.pares_dificil || 0) > 0 ? `${nf(r.pares_dificil || 0)} dif × ${fmt(r.taxa_dificil || 0)}` : '',
      ].filter(Boolean).join(' · ');
      return `<tr>
        <td style="text-align:left;font-weight:600;">${esc(e.name)}
          <span style="font-size:8px;font-weight:700;color:#555;border:1px solid #999;padding:0 3px;margin-left:4px;">POR PAR</span></td>
        <td>${fmt(r.total_proventos || 0)}</td>
        <td colspan="3" style="font-size:9px;color:#333;">${esc(det)}</td>
        <td style="color:${(r.advances_total || 0) > 0 ? '#b45309' : '#9ca3af'};">${(r.advances_total || 0) > 0 ? '−' + fmt(r.advances_total || 0) : '—'}</td>
        <td style="font-weight:700;">${fmt(r.total_liquido)}</td>
      </tr>`;
    }
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
      <td style="color:${(r.advances_total || 0) > 0 ? '#b45309' : '#9ca3af'};">${(r.advances_total || 0) > 0 ? '−' + fmt(r.advances_total || 0) : '—'}</td>
      <td style="font-weight:700;">${fmt(r.total_liquido)}</td>
    </tr>`;
  };
  const rows = emps.map(linha).join('');
  const totals = emps.reduce((a, e) => {
    const r = e.run;
    a.base += (r.total_proventos || 0) - (r.overtime_amount || 0);
    a.falta += r.absence_discount || 0;
    a.atraso += r.deductions_amount || 0;
    a.he += r.overtime_amount || 0;
    a.adv += r.advances_total || 0;
    a.liq += r.total_liquido || 0;
    return a;
  }, { base: 0, falta: 0, atraso: 0, he: 0, adv: 0, liq: 0 });
  const temPorPar = emps.some(e => e.run.por_par);
  return `<section class="doc">
    <h2>Folha · ${esc(periodTitle)}</h2>
    <table class="grid">
      <thead><tr>
        <th style="text-align:left;">Funcionário</th><th>Salário / Produção</th><th>Faltas</th>
        <th>Atraso líquido</th><th>Hora extra paga</th><th>Adiant.</th><th>Líquido</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td style="text-align:left;font-weight:700;">TOTAL (${emps.length})</td>
        <td style="font-weight:800;">${fmt(totals.base)}</td>
        <td style="font-weight:800;color:#b91c1c;">${totals.falta > 0 ? '−' + fmt(totals.falta) : '—'}</td>
        <td style="font-weight:800;color:#b91c1c;">${totals.atraso > 0 ? '−' + fmt(totals.atraso) : '—'}</td>
        <td style="font-weight:800;color:#047857;">${totals.he > 0 ? '+' + fmt(totals.he) : '—'}</td>
        <td style="font-weight:800;color:#b45309;">${totals.adv > 0 ? '−' + fmt(totals.adv) : '—'}</td>
        <td style="font-weight:800;">${fmt(totals.liq)}</td>
      </tr></tfoot>
    </table>
    ${temPorPar ? `<p class="legend">POR PAR = pago por produção (Ficha de Montadores): sem salário, falta, atraso ou hora extra. O relógio de ponto não entra na conta.</p>` : ''}
  </section>`;
}

// ── Calendário de tempo: grade semanal por funcionário (espelha a view do app) ─
function calendarSection(e: BundleEmployee, periodTitle: string): string {
  const cell = (d: BundleDay) => {
    const exp = d.expected_minutes || 0, w = d.worked_minutes || 0;
    let bg = '#fff', color = '#111', label = '—';
    if (e.run.payment_type && e.run.payment_type !== 'mensalista') {
      label = w > 0 ? 'presença' : '—';
      bg = w > 0 ? '#e0f2fe' : '#f3f4f6'; color = w > 0 ? '#0369a1' : '#6b7280';
    } else if (d.status === 'pending') { bg = '#fef3c7'; color = '#b45309'; label = 'pendente'; }
    else if (d.status === 'excused') { bg = '#e0e7ff'; color = '#4338ca'; label = 'justificada'; }
    else if (d.status === 'absence') { bg = '#fee2e2'; color = '#b91c1c'; label = 'falta'; }
    else if ((d.payable_overtime_minutes || 0) > 0) { bg = '#d1fae5'; color = '#047857'; label = 'HE +' + fmtDeltaMin(d.payable_overtime_minutes || 0); }
    else if ((d.payable_delay_minutes || 0) > 0) { bg = '#fee2e2'; color = '#b91c1c'; label = '−' + fmtDeltaMin(d.payable_delay_minutes || 0); }
    else if ((d.compensated_credit_minutes || 0) > 0 || (d.compensated_delay_minutes || 0) > 0) { bg = '#e0f2fe'; color = '#0369a1'; label = 'compensado'; }
    else if ((d.discarded_tolerance_minutes || 0) > 0) { bg = '#f3f4f6'; color = '#6b7280'; label = 'tolerância'; }
    else if ((d.raw_credit_minutes || 0) > 0) { bg = '#ecfdf5'; color = '#047857'; label = 'crédito +' + fmtDeltaMin(d.raw_credit_minutes || 0); }
    else if ((d.raw_delay_minutes || 0) > 0) { bg = '#fffbeb'; color = '#b45309'; label = 'débito −' + fmtDeltaMin(d.raw_delay_minutes || 0); }
    else if (exp > 0 && w > 0) { label = fmtDeltaMin(w); }
    else { bg = '#f3f4f6'; color = '#6b7280'; label = '—'; }
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
    <p class="legend"><span style="background:#d1fae5;">&nbsp;&nbsp;</span> HE paga
      &nbsp; <span style="background:#e0f2fe;">&nbsp;&nbsp;</span> compensado
      &nbsp; <span style="background:#fee2e2;">&nbsp;&nbsp;</span> atraso líquido / falta
      &nbsp; <span style="background:#fef3c7;">&nbsp;&nbsp;</span> pendência
      </p>
  </section>`;
}

// ── Holerite: demonstrativo salário − descontos por funcionário ───────────────
function holeriteSection(e: BundleEmployee, periodTitle: string): string {
  const r = e.run;
  const isFullMonth = /^\d{4}-\d{2}$/.test(r.period);
  const periodBase = (r.total_proventos || 0) - (r.overtime_amount || 0);
  const nf = (n: number) => (Number(n) || 0).toLocaleString('pt-BR');
  const marca = r.taxa_variou ? ' †' : '';
  const normalHeRaw = ((r.he_normal_minutes || 0) / 60) * (r.he_normal_rate || 0);
  const holidayHeRaw = ((r.he_holiday_minutes || 0) / 60) * (r.he_sunday_holiday_rate || r.he_normal_rate || 0);
  const normalHeValue = Math.round(normalHeRaw * 100) / 100;
  // Fecha centavo a centavo com o total já arredondado pelo motor da folha.
  const holidayHeValue = (r.he_holiday_minutes || 0) > 0
    ? Math.round(((r.overtime_amount || 0) - normalHeValue) * 100) / 100
    : 0;
  const splitHe = normalHeRaw + holidayHeRaw > 0;
  // POR PAR: nada de salário, falta, atraso ou hora extra — nenhum deles entra
  // na conta deste regime. Cada dificuldade usa o SEU bruto, nunca o total
  // rateado (a média de 0,80 e 1,00 não é o R$/par de nenhum dos dois).
  const lines = (r.por_par
    ? [
        {
          label: `Pares médios — ${nf(r.pares_medio || 0)} × ${fmt(r.taxa_medio || 0)}${marca}`,
          value: r.bruto_medio || 0, type: 'p' as const, always: (r.pares_medio || 0) > 0, hi: false,
        },
        {
          label: `Pares difíceis — ${nf(r.pares_dificil || 0)} × ${fmt(r.taxa_dificil || 0)}${marca}`,
          value: r.bruto_dificil || 0, type: 'p' as const, always: false, hi: false,
        },
        { label: 'Adiantamentos do período', value: r.advances_total || 0, type: 'd' as const, always: false, hi: true },
      ]
    : [
        { label: isFullMonth ? 'Salário base' : 'Salário do período (proporcional)', value: periodBase, type: 'p' as const, always: true, hi: false },
        ...(splitHe ? [
          { label: `Hora extra — taxa normal (${fmtH(r.he_normal_minutes || 0)})`, value: normalHeValue, type: 'p' as const, always: false, hi: false },
          { label: `Hora extra — domingo/feriado (${fmtH(r.he_holiday_minutes || 0)})`, value: holidayHeValue, type: 'p' as const, always: false, hi: false },
        ] : [
          { label: `Horas extras — taxa individual (${fmtH(r.overtime_50_minutes || 0)})`, value: r.overtime_amount || 0, type: 'p' as const, always: false, hi: false },
        ]),
        { label: `Faltas (${r.absent_days || 0} dia(s))`, value: r.absence_discount || 0, type: 'd' as const, always: false, hi: (r.absent_days || 0) > 0 },
        { label: 'Atrasos / saídas cedo', value: r.deductions_amount || 0, type: 'd' as const, always: false, hi: false },
        { label: 'Adiantamentos do período', value: r.advances_total || 0, type: 'd' as const, always: false, hi: true },
      ]
  ).filter(l => l.value > 0 || l.always);
  const body = lines.map(l => `<tr${l.hi ? ' style="background:#fef3c7;"' : ''}>
    <td style="text-align:left;${l.hi ? 'color:#b45309;font-weight:600;' : ''}">${esc(l.label)}</td>
    <td>${l.type === 'p' ? fmt(l.value) : ''}</td>
    <td style="color:${l.hi ? '#b45309' : '#b91c1c'};${l.hi ? 'font-weight:600;' : ''}">${l.type === 'd' ? fmt(l.value) : ''}</td>
  </tr>`).join('');
  return `<section class="doc">
    <h2>Holerite · ${esc(periodTitle)}</h2>
    <p class="sub">${esc(e.name)}${e.role ? ' · ' + esc(e.role) : ''}${e.department ? ' · ' + esc(e.department) : ''}
      ${r.por_par
        ? `· pagamento POR PAR · ${nf(r.dias_produtivos || 0)} dia(s) produtivo(s) · ${nf((r.pares_medio || 0) + (r.pares_dificil || 0))} pares`
          + ((r.fichas || 0) > 0 ? ` · ${nf(r.fichas || 0)} fichas${r.fichas_derivadas ? ' *' : ''}` : '')
        : `· trabalhado ${fmtH(r.worked_minutes || 0)} · valor-hora ${fmt(r.hourly_rate || 0)} · salário mensal ${fmt(r.base_salary || 0)}`}</p>
    ${r.por_par ? `<p class="sub" style="font-size:9px;color:#555;">O relógio de ponto não influencia este pagamento — os pares vêm da Ficha de Montadores.${
        r.fichas_derivadas ? ' * fichas inferidas (lote de 12); os PARES, base do pagamento, não dependem disso.' : ''
      }${
        r.taxa_variou ? ' † o R$/par mudou no período; a taxa exibida é a média das gravadas — o total continua exato.' : ''
      }</p>` : ''}
    <table class="grid">
      <thead><tr><th style="text-align:left;">Descrição</th><th>Provento</th><th>Desconto</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div class="totais">
      <div><span>Bruto</span><strong style="color:#047857;">${fmt(r.total_proventos)}</strong></div>
      <div><span>Descontos</span><strong style="color:#b91c1c;">${fmt(r.total_descontos || 0)}</strong></div>
      <div><span>Líquido a receber</span><strong style="font-size:16px;color:#0f172a;">${fmt(r.total_liquido)}</strong></div>
    </div>
    ${r.rule_version ? `<p class="legend">Regra: ${esc(r.rule_version)}${r.calculated_at ? ` · calculado em ${esc(new Date(r.calculated_at).toLocaleString('pt-BR'))}` : ''}. Créditos e atrasos parciais são compensados dentro do período.</p>` : ''}
  </section>`;
}

// ── Espelho relógio de ponto: registro BRUTO importado, SEM cálculo nenhum ────
//    (nem falta, nem atraso, nem HE). Só a hora que bateu — pra conferir se o
//    arquivo do relógio está batendo. Uma tabela por funcionário.
const WEEKDAY_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function weekdayPt(dateStr: string): string {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return '';
  return WEEKDAY_PT[new Date(y, m - 1, d).getDay()] ?? '';
}
function espelhoSection(e: BundleEmployee, periodTitle: string): string {
  const days = (e.rawDays || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const rows = days.map(d => {
    const p = (Array.isArray(d.punches) ? d.punches : []).map(x => String(x).trim()).filter(Boolean);
    const has = p.length > 0;
    const entrada = has ? p[0] : '—';
    const saida = p.length >= 2 ? p[p.length - 1] : '—';
    const todas = has ? p.join('   ') : '—';
    const dd = `${String(d.date).slice(8, 10)}/${String(d.date).slice(5, 7)}`;
    return `<tr>
      <td style="text-align:center;">${dd}</td>
      <td style="text-align:center;">${weekdayPt(d.date)}</td>
      <td style="text-align:center;font-weight:600;">${esc(entrada)}</td>
      <td style="text-align:center;font-weight:600;">${esc(saida)}</td>
      <td style="text-align:center;font-family:'Fira Code',monospace;letter-spacing:.3px;">${esc(todas)}</td>
      <td style="text-align:center;color:${has ? '#047857' : '#b91c1c'};font-weight:600;">${has ? 'Bateu' : 'Não bateu'}</td>
    </tr>`;
  }).join('');
  const bateu = days.filter(d => (Array.isArray(d.punches) ? d.punches : []).some(x => String(x).trim())).length;
  return `<section class="doc">
    <h2>Espelho relógio de ponto · ${esc(periodTitle)}</h2>
    <p class="sub">${esc(e.name)}${e.id ? ' · matrícula ' + esc(e.id) : ''}${e.role ? ' · ' + esc(e.role) : ''}${e.department ? ' · ' + esc(e.department) : ''}
      · ${days.length} dia(s) importado(s) · ${bateu} com batida</p>
    <p class="legend" style="margin:0 0 8px;">Registro BRUTO do relógio — sem cálculo de horas, faltas ou atrasos. Confira as batidas.</p>
    <table class="grid">
      <thead><tr><th>Data</th><th>Dia</th><th>Entrada</th><th>Saída</th><th>Batidas</th><th>Situação</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:12px;">Nenhum registro importado neste período.</td></tr>'}</tbody>
    </table>
  </section>`;
}

export type PayrollDocs = { folha: boolean; calendario: boolean; holerite: boolean; setor?: boolean; espelho?: boolean };

/**
 * Monta o HTML do documento (sem abrir janela). Fonte ÚNICA usada tanto pela
 * impressão (`printPayrollBundle`) quanto pela PRÉVIA ao vivo no app (iframe
 * `srcDoc`) — assim a prévia é byte-a-byte o que sai na impressão.
 * `autoPrint: false` omite o script de auto-impressão (pra prévia em iframe).
 * Retorna '' quando não há nada pra renderizar.
 */
export function buildPayrollHtml(params: {
  periodTitle: string;
  docs: PayrollDocs;
  employees: BundleEmployee[];
  /** Lista do Espelho (registro bruto) — independente do escopo da folha, pois
   *  o Espelho não precisa da folha calculada. Cada item usa `rawDays`. */
  espelhoEmployees?: BundleEmployee[];
  autoPrint?: boolean;
  /** 'employee' (padrão): relatórios gerais (Folha/Setor) 1× no topo, depois o
   *  pacote de cada funcionário (Calendário + Holerite + Espelho) JUNTO —
   *  impressão funcionário-a-funcionário. 'type': todos do tipo A, depois do B. */
  groupBy?: 'employee' | 'type';
}): string {
  const { periodTitle, docs, employees } = params;
  // Defesa em profundidade: mesmo que um chamador passe o histórico completo,
  // folha cancelada não chega a Folha, Setor, Calendário nem Holerite.
  const financialEmployees = filterFinancialPayrollEmployees(employees);
  const espelhoEmps = params.espelhoEmployees ?? [];
  const wantsEspelho = !!docs.espelho && espelhoEmps.length > 0;
  if (financialEmployees.length === 0 && !wantsEspelho) return '';
  const groupBy = params.groupBy ?? 'employee';

  const sections: string[] = [];
  // Relatórios gerais (agregados do período) saem 1× no topo nos dois modos.
  if (financialEmployees.length > 0) {
    if (docs.setor) sections.push(sectorSummarySection(financialEmployees, periodTitle));
    if (docs.folha) sections.push(folhaSection(financialEmployees, periodTitle));
  }
  // Casa o Espelho (lista própria, por matrícula) com o funcionário da folha:
  // por matchId (id interno estampado no builder) e, em fallback, por nome
  // normalizado. Usado pra juntar o Espelho ao pacote do MESMO funcionário.
  const normName = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (groupBy === 'employee') {
    // Pacote por pessoa: Calendário + Holerite + ESPELHO do MESMO funcionário
    // fluem JUNTOS (wrapper .emp); a quebra acontece só ENTRE funcionários.
    const usedEspelho = new Set<BundleEmployee>();
    financialEmployees.forEach(e => {
      const empDocs: string[] = [];
      if (docs.calendario) empDocs.push(calendarSection(e, periodTitle));
      if (docs.holerite) empDocs.push(holeriteSection(e, periodTitle));
      if (docs.espelho) {
        const esp = espelhoEmps.find(x =>
          (x.matchId && x.matchId === e.id) || normName(x.name) === normName(e.name));
        if (esp) { empDocs.push(espelhoSection(esp, periodTitle)); usedEspelho.add(esp); }
      }
      if (empDocs.length) sections.push(`<section class="emp">${empDocs.join('')}</section>`);
    });
    // Espelho de quem NÃO tem folha calculada no escopo (só batidas importadas):
    // um por funcionário, depois dos pacotes acima.
    if (docs.espelho) espelhoEmps.filter(e => !usedEspelho.has(e)).forEach(e =>
      sections.push(`<section class="emp">${espelhoSection(e, periodTitle)}</section>`));
  } else {
    if (docs.calendario) financialEmployees.forEach(e => sections.push(calendarSection(e, periodTitle)));
    if (docs.holerite) financialEmployees.forEach(e => sections.push(holeriteSection(e, periodTitle)));
    // 'type': todos os Espelhos juntos, no fim (bloco por tipo).
    if (docs.espelho) espelhoEmps.forEach(e => sections.push(`<section class="emp">${espelhoSection(e, periodTitle)}</section>`));
  }
  if (sections.length === 0) return '';

  const printScript = params.autoPrint === false
    ? ''
    : '<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 150); };</script>';

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
  <title>Documentos · Folha · ${esc(periodTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Fira Sans', Arial, sans-serif; color: #111; margin: 24px; }
    h2 { font-family: 'Anton', Impact, sans-serif; font-size: 18px; text-transform: uppercase;
         letter-spacing: .5px; margin: 0 0 4px; border-bottom: 2px solid #000; padding-bottom: 4px; }
    .sub { font-size: 12px; color: #374151; margin: 0 0 10px; }
    .doc { page-break-inside: avoid; margin-bottom: 18px; }
    /* Pacote do funcionário (Calendário + Holerite) numa página só; quebra só
       ENTRE funcionários. Relatórios gerais (Folha/Setor) ficam antes e fluem
       naturalmente. Sem página em branco no começo (:first-child). */
    .emp { page-break-before: always; break-before: page; page-break-inside: avoid; }
    .emp:first-child { page-break-before: avoid; break-before: auto; }
    .emp > .doc { margin-bottom: 14px; }
    .emp > .doc:last-child { margin-bottom: 0; }
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
  </style></head><body>${sections.join('')}${printScript}
  </body></html>`;
}

export function printPayrollBundle(params: {
  periodTitle: string;
  docs: PayrollDocs;
  employees: BundleEmployee[];
  espelhoEmployees?: BundleEmployee[];
  groupBy?: 'employee' | 'type';
}): void {
  const html = buildPayrollHtml(params);
  if (!html) return;

  const w = window.open('', '_blank');
  if (!w) return; // popup bloqueado
  w.document.open();
  w.document.write(html);
  w.document.close();
}
