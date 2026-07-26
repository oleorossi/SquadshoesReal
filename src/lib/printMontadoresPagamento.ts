// ─────────────────────────────────────────────────────────────────────────────
// Impressão A4 do RELATÓRIO DE PAGAMENTO POR PRODUÇÃO (Ficha de Montadores).
// Seção 1: produzido × já pago × saldo por montador (snapshot R$/par — mesma
// fórmula da folha). Seção 2: referências + cores produzidas pelo setor no
// período (derivado das OPs).
//
// Print layout: HTML inline + cores hardcoded (isento de tokens — CLAUDE.md),
// mesmo estilo tipográfico do relatório de produtividade existente.
// ─────────────────────────────────────────────────────────────────────────────

import type { PagamentoMontadorRow, StatusPagamento } from '@/lib/montadorPagamentos';
import type { ReferenciaProduzidaRow } from '@/lib/referenciasProduzidas';

const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nf = (n: number) => (Number(n) || 0).toLocaleString('pt-BR');
const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const STATUS_PRINT: Record<StatusPagamento, { label: string; color: string }> = {
  pago:     { label: 'Pago',     color: '#047857' },
  parcial:  { label: 'Parcial',  color: '#b45309' },
  pendente: { label: 'Pendente', color: '#c81e2e' },
};

function openPrint(html: string) {
  const w = window.open('', '_blank');
  if (!w) { alert('Permita pop-ups neste site para imprimir.'); return; }
  w.document.write(html);
  w.document.close();
}

export interface TotaisPagamento {
  paresMedio: number;
  paresDificil: number;
  pares: number;
  produzido: number;
  pago: number;
  saldo: number;
}

export function imprimirRelatorioPagamento(p: {
  setorLabel: string;
  periodo: string;      // ex.: "1ª quinzena"
  intervalo: string;    // ex.: "01/07/2026 a 15/07/2026"
  geradoEm: string;     // ex.: "26/07/2026"
  rows: PagamentoMontadorRow[];
  totals: TotaisPagamento;
  refs: ReferenciaProduzidaRow[];
}): void {
  const css = `*{box-sizing:border-box}body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    h1{font-size:18px;margin:0 0 2px} h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.04em}
    .sub{font-size:11px;color:#555;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;font-size:11.5px} th,td{border:1px solid #333;padding:5px 7px}
    th{background:#f1f0ed;text-align:left;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#444}
    td.n{text-align:right;font-variant-numeric:tabular-nums} tfoot td{font-weight:800;background:#f6f5f2}
    .med{color:#b45309} .dif{color:#c81e2e}
    .saldo-aberto{color:#b45309;font-weight:700} .saldo-ok{color:#047857;font-weight:700}
    .sec{break-inside:avoid} .obs{font-size:9.5px;color:#666;margin-top:6px}
    @page{size:A4 portrait;margin:12mm}`;

  const bodyPag = p.rows.map((r, i) => {
    const st = STATUS_PRINT[r.status];
    const saldoCls = r.saldo > 0.005 ? 'saldo-aberto' : 'saldo-ok';
    return `<tr><td>${i + 1}. ${esc(r.nome)}</td>`
      + `<td class="n med">${nf(r.paresMedio)}</td><td class="n dif">${nf(r.paresDificil)}</td><td class="n">${nf(r.pares)}</td>`
      + `<td class="n">${fmtBRL(r.produzido)}</td><td class="n">${fmtBRL(r.pago)}</td>`
      + `<td class="n ${saldoCls}">${fmtBRL(r.saldo)}</td>`
      + `<td style="color:${st.color};font-weight:700">${st.label}</td></tr>`;
  }).join('');

  const bodyRefs = p.refs.map((r) => `<tr><td>${esc(r.code)}${r.name && r.name !== '—' ? ` — ${esc(r.name)}` : ''}</td>`
    + `<td>${esc(r.color)}</td><td class="n">${nf(r.opsCount)}</td><td class="n">${nf(r.pares)}</td></tr>`).join('');
  const totalRefsPares = p.refs.reduce((s, r) => s + r.pares, 0);
  const totalRefsOps = p.refs.reduce((s, r) => s + r.opsCount, 0);

  openPrint(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pagamento por produção — ${esc(p.setorLabel)}</title><style>${css}</style></head><body>
    <h1>Pagamento por produção — ${esc(p.setorLabel)}</h1>
    <div class="sub">${esc(p.periodo)} · ${esc(p.intervalo)} — gerado em ${esc(p.geradoEm)}</div>

    <div class="sec">
    <table><thead><tr><th>Montador</th>
      <th style="text-align:right" class="med">Pares méd</th><th style="text-align:right" class="dif">Pares dif</th><th style="text-align:right">Pares</th>
      <th style="text-align:right">Produzido</th><th style="text-align:right">Pago</th><th style="text-align:right">Saldo</th><th>Status</th></tr></thead>
    <tbody>${bodyPag || '<tr><td colspan="8" style="text-align:center;color:#888">Sem produção nem pagamentos no período.</td></tr>'}</tbody>
    <tfoot><tr><td>TOTAL (${p.rows.length} montador${p.rows.length === 1 ? '' : 'es'})</td>
      <td class="n med">${nf(p.totals.paresMedio)}</td><td class="n dif">${nf(p.totals.paresDificil)}</td><td class="n">${nf(p.totals.pares)}</td>
      <td class="n">${fmtBRL(p.totals.produzido)}</td><td class="n">${fmtBRL(p.totals.pago)}</td>
      <td class="n">${fmtBRL(p.totals.saldo)}</td><td></td></tr></tfoot></table>
    <div class="obs">Produzido = pares apontados na chamada do dia × R$/par (médio/difícil) congelado no apontamento — mesma fórmula da folha.
      Pago = pagamentos registrados nas folhas cujo período cobre o intervalo.</div>
    </div>

    <div class="sec">
    <h2>Referências produzidas no período</h2>
    <table><thead><tr><th>Referência</th><th>Cor</th><th style="text-align:right">OPs</th><th style="text-align:right">Pares</th></tr></thead>
    <tbody>${bodyRefs || '<tr><td colspan="4" style="text-align:center;color:#888">Sem apontamentos de produção no período.</td></tr>'}</tbody>
    ${p.refs.length ? `<tfoot><tr><td>TOTAL (${p.refs.length} referência${p.refs.length === 1 ? '' : 's'}/cor)</td><td></td><td class="n">${nf(totalRefsOps)}</td><td class="n">${nf(totalRefsPares)}</td></tr></tfoot>` : ''}</table>
    <div class="obs">Derivado dos apontamentos das OPs no setor (ledger de produção); OPs antigas sem ledger entram pela conclusão do estágio.</div>
    </div>

    <script>window.onload=function(){window.focus();window.print();};<\/script></body></html>`);
}
