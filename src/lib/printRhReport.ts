// Helper compartilhado dos relatórios de RH (Folha, Faltas, Atrasos) — monta uma
// tabela "todos os funcionários" e abre o preview de impressão (mesma infra dos
// demais prints do app: printHtml → buildPrintHtmlContent, layout A4 padrão).
//
// Cada relatório só monta headers + rows (células já formatadas) e chama
// printRhReport. Nomes são escapados; números vêm prontos como string.
import { printHtml } from './printOrder';
import { escapeHtml } from './htmlUtils';

export type RhCell = { v: string; align?: 'r' | 'l'; neg?: boolean; strong?: boolean };

export interface PrintRhReportOptions {
  /** Título grande do documento (ex.: "Folha — Relatório por Funcionário"). */
  title: string;
  /** Período formatado (ex.: "01/06/2026 – 07/07/2026"). */
  periodo: string;
  subtitle?: string;
  /** dd/MM/yyyy — data de emissão. */
  generatedAt?: string;
  kpis?: { label: string; value: string }[];
  headers: { label: string; align?: 'r' | 'l' }[];
  rows: RhCell[][];
  /** Linha de total (destacada). */
  totals?: RhCell[];
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

export function printRhReport(o: PrintRhReportOptions): void {
  const head = `<tr>${o.headers
    .map(h => `<th class="${h.align === 'r' ? 'text-right' : ''}">${escapeHtml(h.label)}</th>`)
    .join('')}</tr>`;
  const body = o.rows
    .map(r => `<tr>${r.map(c => cellHtml(c)).join('')}</tr>`)
    .join('');
  const foot = o.totals
    ? `<tfoot><tr class="total-row">${o.totals.map(c => cellHtml(c)).join('')}</tr></tfoot>`
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
</style>
<h1>${escapeHtml(o.title)}</h1>
<div class="subtitle">${escapeHtml(subtitle)}</div>
${kpis}
<table>
  <thead>${head}</thead>
  <tbody>${body}</tbody>
  ${foot}
</table>
${o.footNote ? `<div class="footer">${escapeHtml(o.footNote)}</div>` : ''}
`;
  printHtml(o.title, bodyHtml);
}
