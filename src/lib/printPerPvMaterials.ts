import { formatCurrency, formatMoney } from '@/lib/utils';
import {
  NO_SUPPLIER_LABEL,
  type DraftPurchaseOrder,
  type PerPvDraftSummary,
} from '@/lib/perPvPurchasing';

/**
 * Impressão A4 dos materiais necessários do canal "Compras por Pedido".
 * Monta HTML, abre window.open e dispara print (mesmo padrão do PDF de
 * "Consumo de Materiais"). Agrupa por fornecedor + bloco "Sem Fornecedor".
 *
 * ── Design (redesenho 2026-07-20) ────────────────────────────────────────────
 * É um documento OPERACIONAL: o comprador lê pra comprar. Decisões:
 *  • MEDIDA DE LEITURA: largura travada em 190mm (A4 útil). Antes o HTML herdava
 *    a largura da janela (2560px num monitor wide) e o nome do material ficava a
 *    meio metro do valor — o olho tinha que viajar.
 *  • "A COMPRAR" É A COLUNA-HERÓI: é o único número que o comprador executa.
 *    Mono 11pt bold. `Necessário` e `Estoque` viram CONTEXTO (cinza, 8.5pt).
 *  • ARREDONDAMENTO VISÍVEL: `rounding_surplus` (já calculado em perPvPurchasing,
 *    exibido em azul no modal) agora aparece na linha impressa — antes o
 *    comprador via "necessário 46,147 → comprar 50 m" sem saber de onde vinham
 *    os 4 m a mais, e isso é exatamente a linha que gera discussão com o
 *    fornecedor.
 *  • "SEM FORNECEDOR" É TAREFA, NÃO ERRO: âmbar (#8A5A00), não vermelho, com o
 *    peso do problema explícito (quantos itens, quanto R$, que % do pedido).
 *  • CAIXA DE CONFERÊNCIA por item — o comprador risca conforme pede.
 *  • MOEDA: totais/subtotais em `formatMoney` (2 casas). Preço unitário segue em
 *    `formatCurrency` (até 4 casas) porque R$ 0,031/un virando R$ 0,03 faria o
 *    documento não fechar (4.608 × 0,03 = 138,24 ≠ 142,85).
 *
 * Robustez de paginação: cada fornecedor é UMA tabela cujo <thead> usa
 * display:table-header-group → repete no topo de cada página; cada <tr> usa
 * break-inside:avoid → nunca é cortado no meio. Sem overflow:hidden (atrapalha
 * a fragmentação).
 *
 * Regra de print do projeto: sem primitive shadcn, sem token com alpha — cor
 * cravada em hex (bordas #000 puras) pra ter garantia visual no papel.
 *
 * Não dá baixa em nada — é espelho impresso do modal, pra conferência/cotação
 * antes de gerar as OCs. Retorna false se o popup foi bloqueado.
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
  const { scopeLabel, pvNumbers, drafts, netOfStock, summary } = input;

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

          return `
        <tr>
          <td style="padding:5px 5px 5px 0;border-bottom:1px solid ${HAIR};vertical-align:top;width:14px">
            <span style="display:block;width:9px;height:9px;border:1px solid #000;margin-top:2px"></span>
          </td>
          <td style="padding:5px;border-bottom:1px solid ${HAIR};vertical-align:top">
            <div style="font-weight:650;font-size:9.5pt;line-height:1.2">${esc(it.product_name)}</div>
            ${colorLine}${gradeBlock}
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
