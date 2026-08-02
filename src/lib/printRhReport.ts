// Helper compartilhado dos relatórios de RH (Folha, Faltas, Atrasos) — monta uma
// tabela "todos os funcionários" e abre o preview de impressão (mesma infra dos
// demais prints do app: printHtml → buildPrintHtmlContent, layout A4 padrão).
//
// Cada relatório só monta headers + rows (células já formatadas) e chama
// printRhReport. Nomes são escapados; números vêm prontos como string.
import { printHtml } from './printOrder';
import { escapeHtml } from './htmlUtils';

export type RhCell = { v: string; align?: 'r' | 'l'; neg?: boolean; strong?: boolean };

/** Bloco com colunas PRÓPRIAS dentro do mesmo documento.
 *
 *  Existe porque a folha tem duas formas de pagar que não cabem na mesma linha:
 *  quem é pago pelo relógio de ponto (salário, faltas, atrasos, hora extra) e
 *  quem é pago por par (dias produtivos, pares, R$/par). Numa tabela única,
 *  metade das colunas de cada linha sairia "—" e o papel ficaria mais largo sem
 *  informar mais. Bloco vazio não é renderizado — então filtrar o relatório só
 *  para os montadores devolve uma folha só com o bloco deles. */
export interface RhSection {
  /** Cabeçalho do bloco (ex.: "Por par · Ficha de Montadores"). */
  title: string;
  /** Uma linha de contexto abaixo do título (o que este bloco significa). */
  note?: string;
  headers: { label: string; align?: 'r' | 'l' }[];
  rows: RhCell[][];
  totals?: RhCell[];
}

export interface PrintRhReportOptions {
  /** Título grande do documento (ex.: "Folha — Relatório por Funcionário"). */
  title: string;
  /** Período formatado (ex.: "01/06/2026 – 07/07/2026"). */
  periodo: string;
  subtitle?: string;
  /** dd/MM/yyyy — data de emissão. */
  generatedAt?: string;
  kpis?: { label: string; value: string }[];
  /** Tabela única (Faltas, Atrasos). Ignorado quando `sections` vem preenchido. */
  headers?: { label: string; align?: 'r' | 'l' }[];
  rows?: RhCell[][];
  /** Linha de total (destacada). */
  totals?: RhCell[];
  /** Blocos com colunas próprias. Quando presente, substitui headers/rows/totals. */
  sections?: RhSection[];
  /** Fecho do documento somando os blocos (ex.: "Total geral · R$ 34.604,00"). */
  grandTotal?: { label: string; value: string };
  footNote?: string;
}

function cellHtml(c: RhCell, tag: 'td' | 'th' = 'td'): string {
  const cls = [
    c.align === 'r' ? 'text-right' : '',
    c.neg ? 'neg' : '',
    c.strong ? 'strong' : '',
  ].filter(Boolean).join(' ');
  return `<${tag}${cls ? ` class="${cls}"` : ''}>${escapeHtml(c.v ?? '')}</${tag}>`;
}

/** Uma tabela completa (cabeçalho + corpo + total). */
function tableHtml(t: { headers: { label: string; align?: 'r' | 'l' }[]; rows: RhCell[][]; totals?: RhCell[] }): string {
  const head = `<tr>${t.headers
    .map(h => `<th class="${h.align === 'r' ? 'text-right' : ''}">${escapeHtml(h.label)}</th>`)
    .join('')}</tr>`;
  const body = t.rows
    .map(r => `<tr>${r.map(c => cellHtml(c)).join('')}</tr>`)
    .join('');
  const foot = t.totals
    ? `<tfoot><tr class="total-row">${t.totals.map(c => cellHtml(c)).join('')}</tr></tfoot>`
    : '';
  return `<table><thead>${head}</thead><tbody>${body}</tbody>${foot}</table>`;
}

export function printRhReport(o: PrintRhReportOptions): void {
  // Blocos vazios são descartados: um relatório em que só existem montadores sai
  // com um bloco só, sem cabeçalho órfão de uma seção sem ninguém.
  const secs = (o.sections ?? []).filter(s => s.rows.length > 0);
  const corpo = secs.length
    ? secs.map(s => `
        <div class="rh-sec">
          <h2 class="rh-sec-t">${escapeHtml(s.title)}</h2>
          ${s.note ? `<p class="rh-sec-n">${escapeHtml(s.note)}</p>` : ''}
          ${tableHtml(s)}
        </div>`).join('')
    : tableHtml({ headers: o.headers ?? [], rows: o.rows ?? [], totals: o.totals });
  const grand = o.grandTotal
    ? `<div class="rh-grand"><span>${escapeHtml(o.grandTotal.label)}</span><b>${escapeHtml(o.grandTotal.value)}</b></div>`
    : '';
  const kpis = o.kpis?.length
    ? `<div class="rh-kpis">${o.kpis
        .map(k => `<div class="rh-kpi"><span class="rh-kl">${escapeHtml(k.label)}</span><span class="rh-kv">${escapeHtml(k.value)}</span></div>`)
        .join('')}</div>`
    : '';
  const subtitle = [o.subtitle, o.periodo, o.generatedAt ? `Emitido em ${o.generatedAt}` : '']
    .filter(Boolean).join(' · ');

  const bodyHtml = `
<style>
  .neg { color: #b91c1c; font-weight: 600; }
  .strong { font-weight: 800; }
  .rh-kpis { display: flex; gap: 0; border: 1px solid #555; border-radius: 4px; overflow: hidden; margin: 5px 0 7px; }
  .rh-kpi { flex: 1; padding: 4px 8px; border-right: 1px solid #ccc; }
  .rh-kpi:last-child { border-right: none; }
  .rh-kl { display: block; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
  .rh-kv { display: block; font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
  /* Blocos: a barra preta à esquerda separa as duas formas de pagar sem depender
     de cor — a fábrica imprime em laser P&B. */
  .rh-sec { margin: 10px 0 4px; break-inside: auto; }
  .rh-sec-t { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px;
              margin: 0 0 1px; padding-left: 6px; border-left: 4px solid #000; }
  .rh-sec-n { font-size: 8.5px; color: #444; margin: 0 0 4px; padding-left: 10px; }
  .rh-grand { display: flex; justify-content: space-between; align-items: baseline;
              border-top: 2px solid #000; margin-top: 8px; padding-top: 5px;
              font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
  .rh-grand b { font-size: 15px; font-variant-numeric: tabular-nums; }
</style>
<h1>${escapeHtml(o.title)}</h1>
<div class="subtitle">${escapeHtml(subtitle)}</div>
${kpis}
${corpo}
${grand}
${o.footNote ? `<div class="footer">${escapeHtml(o.footNote)}</div>` : ''}
`;
  printHtml(o.title, bodyHtml);
}
