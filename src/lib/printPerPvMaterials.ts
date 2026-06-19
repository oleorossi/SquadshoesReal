import { formatCurrency } from '@/lib/utils';
import {
  NO_SUPPLIER_LABEL,
  type DraftPurchaseOrder,
  type PerPvDraftSummary,
} from '@/lib/perPvPurchasing';

/**
 * Impressão A4 dos materiais necessários do canal "Compras por Pedido".
 * Mesmo padrão do PDF de "Consumo de Materiais"
 * (MaterialConsumptionDialog.handlePrintPdf): monta HTML, abre window.open e
 * dispara print. Agrupa por fornecedor (+ tabela "Sem Fornecedor" destacada).
 *
 * Robustez de paginação (review 2026-06-19): diferente do PDF de consumo (cards
 * curtos em grid 2 colunas), aqui UM fornecedor pode ter dezenas de itens e a
 * tabela transborda a folha. Por isso cada fornecedor é UMA tabela cujo <thead>
 * (banda do fornecedor + rótulos de coluna) usa display:table-header-group →
 * repete no topo de cada página; cada <tr> de item usa break-inside:avoid →
 * nunca é cortado no meio. Sem overflow:hidden (atrapalha a fragmentação).
 *
 * Não dá baixa em nada — é só um espelho impresso do que o modal mostra, pra
 * conferência/cotação antes de gerar as OCs. Retorna false se o popup foi
 * bloqueado (o caller avisa o usuário).
 */

export interface PerPvPrintInput {
  /** "PV-00144" (single) ou "3 pedidos" (multi). */
  scopeLabel: string;
  /** Números dos PVs ("PV-2026-00144") pra linha de subtítulo. */
  pvNumbers: string[];
  drafts: DraftPurchaseOrder[];
  /** Se true, as quantidades já estão líquidas (descontado o estoque). */
  netOfStock: boolean;
  summary: PerPvDraftSummary;
}

/** Escape defensivo de HTML (nomes de material/cor/fornecedor vêm do banco). */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const num = (n: number) =>
  (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** @returns true se a janela de impressão foi aberta; false se bloqueada. */
export function printPerPvMaterials(input: PerPvPrintInput): boolean {
  const { scopeLabel, pvNumbers, drafts, netOfStock, summary } = input;

  const tables = drafts
    .map((d) => {
      const isNoSupplier = d.supplier_id === null;
      const headBg = isNoSupplier ? '#fef2f2' : '#1f2937';
      const headColor = isNoSupplier ? '#dc2626' : '#ffffff';
      const border = isNoSupplier ? '#fca5a5' : '#1f2937';

      const rowsHtml = d.items
        .map(
          (it) => `
        <tr>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb">
            <div style="font-weight:600;font-size:10pt">${esc(it.product_name)}</div>
            ${it.color ? `<div style="color:#6b7280;font-size:8.5pt">${esc(it.color)}</div>` : ''}
          </td>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;color:#6b7280;font-size:9pt">${num(it.needed_qty)}</td>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;color:#6b7280;font-size:9pt">${num(it.stock_qty)}</td>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-weight:700;font-size:10pt">${num(it.quantity)} <span style="color:#6b7280;font-weight:400;font-size:8pt">${esc(it.unit)}</span></td>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;color:#6b7280;font-size:9pt">${esc(formatCurrency(it.unit_price))}</td>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-size:9.5pt">${esc(formatCurrency(it.quantity * it.unit_price))}</td>
        </tr>`,
        )
        .join('');

      // 1 tabela por fornecedor. O <thead> (banda + rótulos) repete por página.
      return `
        <table class="supplier" style="width:100%;border-collapse:collapse;border:2px solid ${border};margin-bottom:8px;background:white">
          <thead>
            <tr>
              <th colspan="6" style="background:${headBg};color:${headColor};padding:5px 8px;font-weight:700;font-size:10.5pt;text-align:left">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                  <span>▌${esc(d.supplier_name)} <span style="font-weight:600;opacity:.85;font-size:8.5pt">· ${d.items.length} item(ns)</span></span>
                  <span style="font-size:9.5pt">${esc(formatCurrency(d.total))}</span>
                </div>
              </th>
            </tr>
            <tr style="background:#f9fafb;color:#6b7280;font-size:7.5pt;text-transform:uppercase;letter-spacing:.3px">
              <th style="padding:3px 6px;text-align:left">Material</th>
              <th style="padding:3px 6px;text-align:right">Necessário</th>
              <th style="padding:3px 6px;text-align:right">Estoque</th>
              <th style="padding:3px 6px;text-align:right">A comprar</th>
              <th style="padding:3px 6px;text-align:right">Preço est.</th>
              <th style="padding:3px 6px;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;
    })
    .join('');

  const noSupplierNote = summary.hasNoSupplier
    ? `<p style="background:#fef2f2;color:#b91c1c;padding:5px 8px;border-radius:4px;font-size:8.5pt;margin:0 0 8px">⚠ ${summary.noSupplierItemCount} item(ns) sem fornecedor cadastrado — agrupados em "${esc(NO_SUPPLIER_LABEL)}".</p>`
    : '';

  const modeNote = netOfStock
    ? 'quantidade = falta líquida (estoque descontado)'
    : 'quantidade = necessidade bruta (estoque não descontado)';

  const pvList = pvNumbers.length ? ` · ${esc(pvNumbers.join(', '))}` : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Materiais necessários — ${esc(scopeLabel)}</title>
    <style>
      @page { size: A4 portrait; margin: 8mm; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: system-ui, -apple-system, sans-serif; color: #111; font-size: 10pt; line-height: 1.3; max-width: 100%; overflow-x: hidden; }
      h1 { font-size: 14pt; margin: 0 0 2px; }
      .sub { color: #6b7280; font-size: 9pt; margin: 0 0 8px; }
      .totals-strip { margin-bottom: 10px; padding: 6px 0; border-top: 2px solid #1f2937; border-bottom: 2px solid #1f2937; display:flex; gap:6px; flex-wrap:wrap; }
      .chip { display:inline-block; background:#1f2937; color:white; padding:3px 10px; border-radius:4px; font-size:9.5pt; font-weight:600; }
      .chip-light { background:#e5e7eb; color:#1f2937; }
      table.supplier { max-width: 100%; }
      /* Cabeçalho (banda + rótulos) repete em cada página quando a tabela
         transborda a folha; linhas de item nunca são cortadas no meio. */
      table.supplier thead { display: table-header-group; }
      table.supplier tbody tr { break-inside: avoid; }
    </style></head>
    <body>
      <h1>Materiais necessários — ${esc(scopeLabel)}</h1>
      <p class="sub">Compras por Pedido${pvList} · ${modeNote} · Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
      <div class="totals-strip">
        <span class="chip">Total estimado: ${esc(formatCurrency(summary.total))}</span>
        <span class="chip chip-light">${summary.orderCount} OC(s)</span>
        <span class="chip chip-light">${summary.itemCount} item(ns)</span>
        <span class="chip chip-light">${summary.supplierCount} fornecedor(es)${summary.hasNoSupplier ? ' + sem fornecedor' : ''}</span>
      </div>
      ${noSupplierNote}
      ${tables}
    </body></html>`;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 400);
  return true;
}
