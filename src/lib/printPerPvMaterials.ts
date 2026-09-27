import { formatCurrency, formatMoney } from '@/lib/utils';
import {
  NO_SUPPLIER_LABEL,
  type DraftPurchaseOrder,
  type PerPvDraftSummary,
} from '@/lib/perPvPurchasing';
import type { NapaRollup } from '@/lib/napaRollup';

/**
 * Impressão A4 dos materiais necessários do canal "Compras por Pedido".
 * Monta HTML, abre window.open e dispara print (mesmo padrão do PDF de
 * "Consumo de Materiais"). Agrupa por fornecedor + bloco "Sem Fornecedor".
 *
 * Inclui o rollup de napa (cabedal / forração / tiras → total) quando passado
 * — mesmo contrato da tela de consumo (dono, 27/09/2026).
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
  /** Rollup canônico de napa (mesmo da tela de consumo). */
  napaRollup?: NapaRollup | null;
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

const INK = '#1A1714';
const MUTED = '#8A847A';
const HAIR = '#E2DED6';
const AMBER = '#8A5A00';
const OXIDE = '#B0342B';

// Fontes do contexto de PRINT (window.open próprio — não herda o index.css do
// app, então só vale stack de sistema). Display segue a convenção do projeto
// ('Anton', Impact — uppercase decisivo); número SEMPRE mono, porque num
// documento de compra coluna de número que não alinha é defeito.
const DISPLAY = `'Anton', 'Arial Narrow', Impact, sans-serif`;
const MONO = `'SFMono-Regular', 'JetBrains Mono', 'Courier New', monospace`;
const BODY = `system-ui, -apple-system, 'Segoe UI', sans-serif`;

/**
 * Monta o HTML A4 do relatório. Separado do window.open pra ser testável e
 * renderizável fora do browser (conferência do layout sem abrir impressão).
 */
export function buildPerPvMaterialsHtml(input: PerPvPrintInput): string {
  const { scopeLabel, pvNumbers, drafts, netOfStock, summary, napaRollup } = input;

  const tables = drafts
    .map((d) => {
      const isNoSupplier = d.supplier_id === null;
      const bandBg = isNoSupplier ? AMBER : INK;
      const countLabel = isNoSupplier
        ? `${d.items.length} ${d.items.length === 1 ? 'item' : 'itens'} · atribuir`
        : `${d.items.length} ${d.items.length === 1 ? 'item' : 'itens'}`;

      const rowsHtml = d.items
        .map((it) => {
          const gradeSizes = it.grade
            ? Object.keys(it.grade)
                .filter((k) => (it.grade![k] ?? 0) > 0)
                .sort((a, b) => parseFloat(a) - parseFloat(b))
            : [];
          // Grade do solado por numeração — vive DENTRO da célula do material
          // (antes era uma <tr> extra, que a paginação podia separar da linha).
          const gradeBlock = gradeSizes.length
            ? `<div style="margin-top:3px;font-family:${MONO};font-size:7pt;color:#5E5850;letter-spacing:.02em">${gradeSizes
                .map(
                  (sz) =>
                    `<span style="display:inline-block;border:1px solid #C9C3B9;padding:0 3px;margin:0 2px 2px 0"><span style="color:#7B756B">${esc(sz)}</span>·<strong>${num(it.grade![sz])}</strong></span>`,
                )
                .join('')}</div>`
            : '';

          const surplus = Number(it.rounding_surplus) || 0;
          const roundNote =
            surplus > 0
              ? `<span style="display:block;font-family:${MONO};font-size:7pt;color:${AMBER};margin-top:1px;white-space:nowrap">&#8593; m&uacute;ltiplo +${num(surplus)}</span>`
              : '';

          const colorLine = it.color
            ? `<div style="margin-top:1px;font-family:${MONO};font-size:7.5pt;color:${MUTED};letter-spacing:.05em;text-transform:uppercase">${esc(it.color)}</div>`
            : '';

          // Identificação exata do item: código do produto (nos materiais
          // comprados, o código do próprio fornecedor) + descrição técnica com a
          // especificação que o nome curto não carrega. A descrição só entra
          // quando acrescenta — em vários cadastros ela repete o nome ou o código.
          const desc = (it.technical_name || '').trim();
          const descUtil = desc
            && desc.toLowerCase() !== it.product_name.trim().toLowerCase()
            && desc.toLowerCase() !== (it.sku || '').trim().toLowerCase();
          const skuLine = it.sku
            ? `<div style="margin-top:1px;font-family:${MONO};font-size:7.5pt;color:#5E5850;letter-spacing:.04em">${esc(it.sku)}</div>`
            : '';
          const descLine = descUtil
            ? `<div style="margin-top:1px;font-size:7.5pt;line-height:1.25;color:${MUTED}">${esc(desc)}</div>`
            : '';

          return `
        <tr>
          <td style="padding:5px 5px 5px 0;border-bottom:1px solid ${HAIR};vertical-align:top;width:14px">
            <span style="display:block;width:9px;height:9px;border:1px solid #000;margin-top:2px"></span>
          </td>
          <td style="padding:5px;border-bottom:1px solid ${HAIR};vertical-align:top">
            <div style="font-weight:650;font-size:9.5pt;line-height:1.2">${esc(it.product_name)}</div>
            ${skuLine}${colorLine}${descLine}${gradeBlock}
          </td>
          <td style="padding:5px;border-bottom:1px solid ${HAIR};text-align:right;vertical-align:top;font-family:${MONO};font-size:8.5pt;color:${MUTED};white-space:nowrap">${num(it.needed_qty)}</td>
          <td style="padding:5px;border-bottom:1px solid ${HAIR};text-align:right;vertical-align:top;font-family:${MONO};font-size:8.5pt;color:${MUTED};white-space:nowrap">${num(it.stock_qty)}</td>
          <td style="padding:5px;border-bottom:1px solid ${HAIR};text-align:right;vertical-align:top;white-space:nowrap">
            <span style="font-family:${MONO};font-size:11pt;font-weight:700">${num(it.quantity)}<span style="font-size:7.5pt;font-weight:400;color:#5E5850;margin-left:2px">${esc(it.unit)}</span></span>${roundNote}
          </td>
          <td style="padding:5px;border-bottom:1px solid ${HAIR};text-align:right;vertical-align:top;font-family:${MONO};font-size:8.5pt;color:#5E5850;white-space:nowrap">${esc(formatCurrency(it.unit_price))}</td>
          <td style="padding:5px 0 5px 5px;border-bottom:1px solid ${HAIR};text-align:right;vertical-align:top;font-family:${MONO};font-size:9.5pt;font-weight:650;white-space:nowrap">${esc(formatMoney(it.quantity * it.unit_price))}</td>
        </tr>`;
        })
        .join('');

      // 1 tabela por fornecedor. O <thead> (banda + rótulos) repete por página.
      return `
        <table class="supplier">
          <thead>
            <tr>
              <th colspan="7" style="padding:0;border:none">
                <div style="background:${bandBg};color:#fff;padding:5px 9px;display:flex;justify-content:space-between;align-items:baseline;gap:10px">
                  <span style="font-family:${DISPLAY};text-transform:uppercase;font-weight:800;letter-spacing:.045em;font-size:11.5pt;line-height:1.15">${esc(d.supplier_name)}</span>
                  <span style="font-family:${MONO};font-size:7.5pt;letter-spacing:.1em;opacity:.75;white-space:nowrap">${esc(countLabel)}</span>
                  <span style="margin-left:auto;font-family:${MONO};font-size:11pt;font-weight:700;white-space:nowrap">${esc(formatMoney(d.total))}</span>
                </div>
              </th>
            </tr>
            <tr>
              <th style="border-bottom:1px solid #000"></th>
              <th style="padding:5px 5px 3px;text-align:left;border-bottom:1px solid #000">Material</th>
              <th style="padding:5px 5px 3px;text-align:right;border-bottom:1px solid #000">Necess&aacute;rio</th>
              <th style="padding:5px 5px 3px;text-align:right;border-bottom:1px solid #000">Estoque</th>
              <th style="padding:5px 5px 3px;text-align:right;border-bottom:1px solid #000">A comprar</th>
              <th style="padding:5px 5px 3px;text-align:right;border-bottom:1px solid #000">Pre&ccedil;o un.</th>
              <th style="padding:5px 0 3px 5px;text-align:right;border-bottom:1px solid #000">Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;
    })
    .join('');

  // "Sem fornecedor" = TAREFA. Quantifica o impacto (R$ e % do pedido) — sem
  // isso o aviso é só um sinal vermelho que ninguém sabe quanto custa ignorar.
  const noSupplierDraft = drafts.find((d) => d.supplier_id === null);
  const noSupplierTotal = noSupplierDraft?.total ?? 0;
  const pct = summary.total > 0 ? Math.round((noSupplierTotal / summary.total) * 100) : 0;
  const noSupplierNote = summary.hasNoSupplier
    ? `<div style="display:flex;align-items:baseline;gap:8px;margin:10px 0 0;padding:7px 10px;border:1.2px solid ${AMBER};border-left-width:4px;background:#FBF4E6">
         <span style="font-family:${MONO};font-size:7.5pt;letter-spacing:.12em;text-transform:uppercase;color:${AMBER};font-weight:700;white-space:nowrap">Antes de comprar</span>
         <span style="font-size:8.5pt;color:#4A4038"><strong>${summary.noSupplierItemCount} ${summary.noSupplierItemCount === 1 ? 'item' : 'itens'}</strong> (${esc(formatMoney(noSupplierTotal))} — ${pct}% do pedido) sem fornecedor cadastrado, agrupados em &ldquo;${esc(NO_SUPPLIER_LABEL)}&rdquo;. Atribua um fornecedor para virar Ordem de Compra.</span>
       </div>`
    : '';

  const modeNote = netOfStock
    ? 'Quantidade = falta líquida (estoque descontado)'
    : 'Quantidade = necessidade bruta (estoque não descontado)';

  const pvList = pvNumbers.length ? esc(pvNumbers.join(', ')) : '';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Materiais necessários — ${esc(scopeLabel)}</title>
    <style>
      @page { size: A4 portrait; margin: 10mm; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      /* MEDIDA DE LEITURA: trava em 190mm (A4 útil). Sem isso o relatório herda a
         largura da janela e as colunas se esparramam num monitor wide. */
      body { font-family: ${BODY}; color: ${INK}; font-size: 9.5pt; line-height: 1.35;
             max-width: 190mm; margin: 0 auto; padding: 0 2mm; }
      table.supplier { width: 100%; border-collapse: collapse; margin: 14px 0 0; }
      table.supplier thead { display: table-header-group; }
      table.supplier tbody tr { break-inside: avoid; }
      table.supplier thead th { font-family: ${MONO}; font-size: 7pt; letter-spacing: .1em;
        text-transform: uppercase; color: #7B756B; font-weight: 400; white-space: nowrap; }
      .keep { break-inside: avoid; }
    </style></head>
    <body>

      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px;border-bottom:2.5px solid #000;padding-bottom:9px">
        <div style="font-family:${DISPLAY};text-transform:uppercase;font-weight:800;letter-spacing:.04em;font-size:10.5pt;line-height:1">
          Squad Shoes
          <span style="display:block;font-family:${MONO};font-size:6.5pt;letter-spacing:.14em;color:#7B756B;font-weight:400;margin-top:3px;text-transform:none">Compras por Pedido</span>
        </div>
        <div style="text-align:right">
          <div style="font-family:${DISPLAY};text-transform:uppercase;font-weight:800;letter-spacing:.02em;font-size:21pt;line-height:.9">Materiais<br>Necess&aacute;rios</div>
          <div style="font-family:${MONO};font-size:11pt;font-weight:700;letter-spacing:.02em;margin-top:4px">${esc(scopeLabel)}</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:7px;font-family:${MONO};font-size:6.8pt;letter-spacing:.09em;text-transform:uppercase;color:#7B756B">
        <span>Gerado ${new Date().toLocaleDateString('pt-BR')}</span>
        ${pvList ? `<span>${pvList}</span>` : ''}
        <span>${esc(modeNote)}</span>
        <span>Pre&ccedil;o estimado — sujeito a confirma&ccedil;&atilde;o</span>
      </div>

      <div style="display:flex;margin-top:11px;border:1.5px solid #000">
        <div style="flex:1.6;padding:7px 10px;border-right:1px solid #000">
          <div style="font-family:${MONO};font-size:6.5pt;letter-spacing:.13em;text-transform:uppercase;color:#7B756B">Total estimado</div>
          <div style="font-family:${DISPLAY};font-size:19pt;line-height:1.05;margin-top:1px;color:${OXIDE}">${esc(formatMoney(summary.total))}</div>
        </div>
        <div style="flex:1;padding:7px 10px;border-right:1px solid #000">
          <div style="font-family:${MONO};font-size:6.5pt;letter-spacing:.13em;text-transform:uppercase;color:#7B756B">Ordens</div>
          <div style="font-family:${DISPLAY};font-size:16pt;line-height:1.05;margin-top:1px">${summary.orderCount}</div>
        </div>
        <div style="flex:1;padding:7px 10px;border-right:1px solid #000">
          <div style="font-family:${MONO};font-size:6.5pt;letter-spacing:.13em;text-transform:uppercase;color:#7B756B">Itens</div>
          <div style="font-family:${DISPLAY};font-size:16pt;line-height:1.05;margin-top:1px">${summary.itemCount}</div>
        </div>
        <div style="flex:1;padding:7px 10px">
          <div style="font-family:${MONO};font-size:6.5pt;letter-spacing:.13em;text-transform:uppercase;color:#7B756B">Fornecedores</div>
          <div style="font-family:${DISPLAY};font-size:16pt;line-height:1.05;margin-top:1px">${summary.supplierCount}${summary.hasNoSupplier ? `<span style="font-family:${MONO};font-size:8pt"> +1 s/</span>` : ''}</div>
        </div>
      </div>

      ${napaRollup && napaRollup.byFamilyColor.length > 0 ? `
      <div class="keep" style="margin-top:12px;border:1.5px solid #000;padding:8px 10px">
        <div style="font-family:${MONO};font-size:6.5pt;letter-spacing:.13em;text-transform:uppercase;color:#7B756B">Necessidade de napa · cabedal · forração · tiras</div>
        <div style="font-family:${DISPLAY};font-size:18pt;line-height:1;margin-top:2px">${num(napaRollup.total)} m</div>
        ${napaRollup.byFamilyColor.map((block) => `
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid ${HAIR}">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:9pt">
              <strong>${esc(block.family)} · ${esc(block.color)}</strong>
              <span style="font-family:${MONO};font-weight:700">${num(block.total)} m</span>
            </div>
            <ul style="margin:3px 0 0;padding-left:14px;font-size:8pt;color:#5E5850">
              ${block.destinations.map((d) => `
                <li style="display:flex;justify-content:space-between;gap:8px">
                  <span>${esc(d.label)}${d.kind === 'Tira' && d.strapMeters ? ` · ${num(d.strapMeters)} m tira` : ''}${d.pending ? ' · rendimento pendente' : ''}</span>
                  <span style="font-family:${MONO}">${d.pending ? '—' : `${num(d.napaMeters)} m`}</span>
                </li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>` : ''}

      ${noSupplierNote}
      ${tables}

      <div class="keep" style="display:flex;align-items:center;gap:12px;margin-top:16px;background:${OXIDE};color:#fff;padding:9px 12px">
        <span style="font-family:${DISPLAY};text-transform:uppercase;font-weight:800;letter-spacing:.05em;font-size:12pt">Total estimado</span>
        <span style="font-family:${MONO};font-size:7.5pt;opacity:.88;letter-spacing:.06em">${summary.orderCount} ${summary.orderCount === 1 ? 'ordem' : 'ordens'} · ${summary.itemCount} ${summary.itemCount === 1 ? 'item' : 'itens'}</span>
        <span style="margin-left:auto;font-family:${MONO};font-size:16pt;font-weight:700">${esc(formatMoney(summary.total))}</span>
      </div>

      <div class="keep" style="display:flex;justify-content:space-between;gap:26px;margin-top:26px">
        <div style="flex:1;border-top:1.2px solid #000;padding-top:4px;text-align:center;font-family:${MONO};font-size:7pt;letter-spacing:.1em;text-transform:uppercase;color:#7B756B">Comprador</div>
        <div style="flex:1;border-top:1.2px solid #000;padding-top:4px;text-align:center;font-family:${MONO};font-size:7pt;letter-spacing:.1em;text-transform:uppercase;color:#7B756B">Confer&ecirc;ncia</div>
        <div style="flex:1;border-top:1.2px solid #000;padding-top:4px;text-align:center;font-family:${MONO};font-size:7pt;letter-spacing:.1em;text-transform:uppercase;color:#7B756B">Aprova&ccedil;&atilde;o</div>
      </div>

      <p class="keep" style="margin:14px 0 0;font-size:7pt;color:${MUTED};line-height:1.5;border-top:1px solid ${HAIR};padding-top:7px">
        <strong>Como ler:</strong> <em>Necess&aacute;rio</em> &eacute; o consumo calculado pelas fichas t&eacute;cnicas do pedido; <em>Estoque</em> &eacute; o saldo dispon&iacute;vel; <em>A comprar</em> &eacute; a falta arredondada para o m&uacute;ltiplo de compra — quando h&aacute; arredondamento, a diferen&ccedil;a aparece na pr&oacute;pria linha.
        Totais e subtotais em 2 casas decimais; o pre&ccedil;o unit&aacute;rio mant&eacute;m a precis&atilde;o cadastrada (ex.: R$ 0,031/un), pois arredond&aacute;-lo para centavos distorceria o total.
      </p>

    </body></html>`;

  return html;
}

/** @returns true se a janela de impressão foi aberta; false se bloqueada. */
export function printPerPvMaterials(input: PerPvPrintInput): boolean {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  printWindow.document.write(buildPerPvMaterialsHtml(input));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 400);
  return true;
}
