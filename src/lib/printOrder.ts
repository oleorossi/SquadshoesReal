import { getSignedUrl } from '@/lib/getSignedUrl';
import { escapeHtml } from './htmlUtils';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';

function buildPrintHtmlContent(title: string, bodyHtml: string, options?: { landscape?: boolean }): string {
  const pageSize = options?.landscape ? 'A4 landscape' : 'A4';
  // OTIMIZAÇÃO DE ESPAÇO: helper compartilhado por ~10 arquivos lib/print*.ts
  // (printGroupedReport, printCombinedSectorReport, printSectorWorkSheet,
  //  printPurchaseOrder, printSaleOrderOPs, printStockPurchaseOrder,
  //  printTimeMirror, printTimesheet, printLabels, printCuttingGroupedReport).
  // Reduzir margens/paddings/font-sizes aqui = otimizar TODOS de uma vez.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page {
    size: ${pageSize};
    margin: 6mm 7mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #000; font-weight: 400; line-height: 1.25; padding: 3mm 4mm; max-width: ${options?.landscape ? '297mm' : '210mm'}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 16px; font-weight: 800; margin-bottom: 2px; color: #000; letter-spacing: -0.2px; }
  h2 { font-size: 13px; font-weight: 800; margin: 6px 0 2px; border-bottom: 2px solid #000; padding-bottom: 1px; color: #000; text-transform: uppercase; letter-spacing: 0.3px; }
  h3 { font-size: 12px; font-weight: 700; margin: 4px 0 2px; color: #000; }
  .subtitle { font-size: 10px; color: #1a1a1a; margin-bottom: 4px; font-weight: 600; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; margin-bottom: 4px; font-size: 10.5px; }
  .info-grid .label { font-weight: 700; color: #000; }
  table { width: 100%; border-collapse: collapse; margin-top: 2px; }
  th, td { border: 1px solid #555; padding: 2px 4px; text-align: left; font-size: 10.5px; color: #000; font-weight: 500; line-height: 1.2; }
  th { background: #1f2937; color: #fff !important; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; font-size: 10px; }
  tbody tr:nth-child(even) td { background: #f7f8fa; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .mono { font-family: 'SFMono-Regular', 'Courier New', monospace; font-variant-numeric: tabular-nums; font-weight: 600; }
  .footer { margin-top: 6px; font-size: 9px; color: #1a1a1a; text-align: center; border-top: 1px solid #999; padding-top: 2px; font-weight: 600; }
  .total-row td { font-weight: 800 !important; background: #fef3c7 !important; color: #000 !important; border-top: 2px solid #000; font-size: 11px; }
  img { max-width: 100%; }
  .toolbar { display: none; }
  .content-wrapper { margin-top: 0; }
  @media print {
    body { padding: 0; max-width: none; }
    .content-wrapper { margin-top: 0; }
    .page-break { page-break-after: always; }
    tr, .summary-card { page-break-inside: avoid; }
    h1, h2, h3 { page-break-after: avoid; }
  }
  @media screen {
    body { max-width: ${options?.landscape ? '297mm' : '210mm'}; margin: 0 auto; background: #fff; min-height: ${options?.landscape ? '210mm' : '297mm'}; }
  }
</style>
</head>
<body>
<div class="content-wrapper">
${bodyHtml}
</div>
</body></html>`;
}

type PrintPreviewUi = {
  closeButton: HTMLButtonElement;
  overlay: HTMLDivElement;
  previewFrame: HTMLIFrameElement;
  printButton: HTMLButtonElement;
  printFrame: HTMLIFrameElement;
  title: HTMLSpanElement;
};

let printPreviewUi: PrintPreviewUi | null = null;
let currentPrintHtml = '';
let currentPrintTitle = '';

function createPrintPreviewUi(): PrintPreviewUi {
  const overlay = document.createElement('div');
  overlay.setAttribute('data-print-preview', 'true');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'none',
    flexDirection: 'column',
    background: 'hsl(var(--background))',
  });

  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '12px 16px',
    borderBottom: '1px solid hsl(var(--border))',
    background: 'hsl(var(--card))',
    color: 'hsl(var(--card-foreground))',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
  });

  const title = document.createElement('span');
  Object.assign(title.style, {
    fontSize: '14px',
    fontWeight: '700',
  });

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  });

  const printButton = document.createElement('button');
  printButton.type = 'button';
  printButton.textContent = '💾 Salvar / Imprimir';
  Object.assign(printButton.style, {
    border: '1px solid hsl(var(--border))',
    background: 'hsl(var(--primary))',
    color: 'hsl(var(--primary-foreground))',
    borderRadius: '8px',
    padding: '8px 14px',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
  });

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '✕ Fechar';
  Object.assign(closeButton.style, {
    border: '1px solid hsl(var(--border))',
    background: 'hsl(var(--secondary))',
    color: 'hsl(var(--secondary-foreground))',
    borderRadius: '8px',
    padding: '8px 14px',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
  });

  const previewFrame = document.createElement('iframe');
  previewFrame.title = 'Print Preview';
  Object.assign(previewFrame.style, {
    flex: '1',
    width: '100%',
    border: '0',
    background: '#fff',
  });

  const printFrame = document.createElement('iframe');
  printFrame.title = 'Print Frame';
  Object.assign(printFrame.style, {
    position: 'fixed',
    width: '210mm',
    height: '297mm',
    left: '-10000px',
    top: '0',
    pointerEvents: 'none',
    border: '0',
    visibility: 'hidden',
  });

  actions.appendChild(printButton);
  actions.appendChild(closeButton);
  toolbar.appendChild(title);
  toolbar.appendChild(actions);
  overlay.appendChild(toolbar);
  overlay.appendChild(previewFrame);
  overlay.appendChild(printFrame);
  document.body.appendChild(overlay);

  return { closeButton, overlay, previewFrame, printButton, printFrame, title };
}

function getPrintPreviewUi(): PrintPreviewUi {
  if (!printPreviewUi) {
    printPreviewUi = createPrintPreviewUi();

    printPreviewUi.closeButton.addEventListener('click', () => {
      printPreviewUi!.overlay.style.display = 'none';
      printPreviewUi!.previewFrame.srcdoc = '';
      printPreviewUi!.printFrame.srcdoc = '';
    });

    printPreviewUi.printButton.addEventListener('click', async () => {
      if (!currentPrintHtml) return;
      // Print directly from the preview iframe (already loaded and rendered).
      // Printing from a hidden srcdoc iframe is unreliable in Chromium —
      // the print dialog often fails to open silently.
      const previewWin = printPreviewUi!.previewFrame.contentWindow;
      if (!previewWin) return;
      try {
        await waitForIframeAssets(printPreviewUi!.previewFrame);
        previewWin.focus();
        previewWin.print();
      } catch (err) {
        console.error('[print] Falha ao acionar diálogo de impressão:', err);
        // Fallback: try the hidden frame
        try {
          await loadHtmlIntoIframe(printPreviewUi!.printFrame, currentPrintHtml);
          await waitForIframeAssets(printPreviewUi!.printFrame);
          printPreviewUi!.printFrame.contentWindow?.focus();
          printPreviewUi!.printFrame.contentWindow?.print();
        } catch (fallbackErr) {
          console.error('[print] Fallback de impressão também falhou:', fallbackErr);
          window.alert('Não foi possível abrir o diálogo de impressão. Tente novamente ou use Ctrl+P na visualização.');
        }
      }
    });
  }

  return printPreviewUi;
}

function createPrintWindowProxy(): Window {
  return {
    close: () => {
      const ui = getPrintPreviewUi();
      ui.overlay.style.display = 'none';
      ui.previewFrame.srcdoc = '';
      ui.printFrame.srcdoc = '';
    },
    closed: false,
    document: window.document.implementation.createHTMLDocument('print-proxy'),
    focus: () => {
      const ui = getPrintPreviewUi();
      ui.overlay.style.display = 'flex';
    },
  } as unknown as Window;
}

function loadHtmlIntoIframe(frame: HTMLIFrameElement, htmlContent: string): Promise<void> {
  return new Promise((resolve) => {
    const handleLoad = () => {
      frame.removeEventListener('load', handleLoad);
      resolve();
    };

    frame.addEventListener('load', handleLoad);
    frame.srcdoc = htmlContent;
  });
}

async function waitForIframeAssets(frame: HTMLIFrameElement): Promise<void> {
  const doc = frame.contentDocument;
  if (!doc) return;

  const fonts = (doc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
  if (fonts?.ready) {
    try {
      await fonts.ready;
    } catch {
      // ignore font readiness failures
    }
  }

  const images = Array.from(doc.images || []);
  await Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
    });
  }));

  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function showPrintPreview(title: string, htmlContent: string): Promise<void> {
  const ui = getPrintPreviewUi();
  currentPrintTitle = title;
  currentPrintHtml = htmlContent;
  ui.title.textContent = currentPrintTitle;
  ui.overlay.style.display = 'flex';
  await loadHtmlIntoIframe(ui.previewFrame, currentPrintHtml);
}

/**
 * Mantido por compatibilidade com os fluxos existentes.
 * Agora retorna um proxy local e não abre nova aba/janela.
 */
export function openPrintWindow(_title: string): Window | null {
  return createPrintWindowProxy();
}

/**
 * Abre o preview de impressão em overlay com iframe isolado.
 */
export function writePrintWindow(_win: Window | null, title: string, bodyHtml: string, options?: { landscape?: boolean }) {
  const htmlContent = buildPrintHtmlContent(title, bodyHtml, options);
  void showPrintPreview(title, htmlContent);
}

/**
 * Abre um HTML bruto em preview de impressão com iframe isolado.
 */
export function writeRawPrintWindow(_win: Window | null, htmlContent: string) {
  const extractedTitle = htmlContent.match(/<title>(.*?)<\/title>/i)?.[1] || 'Impressão';
  void showPrintPreview(extractedTitle, htmlContent);
}

/**
 * One-shot preview: abre o documento no overlay de impressão.
 */
export function printHtml(title: string, bodyHtml: string, options?: { landscape?: boolean }) {
  const htmlContent = buildPrintHtmlContent(title, bodyHtml, options);
  void showPrintPreview(title, htmlContent);
}

// --- Sale Order & Production Order builders below ---

export async function buildSaleOrderPrintHtml(order: any, items: any[], colorVariants: any[] = []) {
  const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const getItemImage = (item: any): string | null => {
    const color = item.color || '';
    const refId = item.reference_id;
    // 1. Color-specific variant
    if (color && colorVariants.length > 0) {
      const variant = colorVariants.find((v: any) => v.reference_id === refId && v.color?.toLowerCase() === color.toLowerCase() && v.image_url);
      if (variant?.image_url) return variant.image_url;
    }
    // 2. Technical sheet images
    const images = item.technical_sheets?.images;
    if (images && Array.isArray(images) && images.length > 0) {
      const first = images[0];
      if (typeof first === 'string') return first;
      if (first?.url) return first.url;
    }
    if (item.technical_sheets?.image_url) return item.technical_sheets.image_url;
    // 3. Any variant of this reference that has an image
    if (colorVariants.length > 0) {
      const anyVariant = colorVariants.find((v: any) => v.reference_id === refId && v.image_url);
      if (anyVariant?.image_url) return anyVariant.image_url;
    }
    return null;
  };

  // Resolve all image URLs to signed URLs for private storage
  const imageUrlMap = new Map<string, string>();
  const rawUrls = items.map(item => getItemImage(item)).filter(Boolean) as string[];
  const uniqueUrls = [...new Set(rawUrls)];
  await Promise.all(uniqueUrls.map(async (url) => {
    const signed = await getSignedUrl(url);
    imageUrlMap.set(url, signed);
  }));
  const resolveUrl = (url: string | null) => url ? (imageUrlMap.get(url) || url) : null;

  const allSizes = new Set<string>();
  items.forEach(item => {
    const grade = item.grade as Record<string, number> | null;
    if (grade) Object.keys(grade).filter(s => !s.startsWith('_')).forEach(s => allSizes.add(s));
  });
  // Ordena numérico; numerações conjugadas ("33/34") ordenam pela 1ª parte.
  // ANTES usava Number("33/34") = NaN → colunas conjugadas saíam fora de ordem.
  const sizeOrder = (s: string) => parseInt(String(s).split('/')[0], 10) || 0;
  const sizes = Array.from(allSizes).sort((a, b) => sizeOrder(a) - sizeOrder(b));

  let bodyRows = '';
  const grandTotals: Record<string, { pedida: number; valor: number }> = {};
  sizes.forEach(s => { grandTotals[s] = { pedida: 0, valor: 0 }; });
  let grandTotalPairs = 0;
  let grandTotalValue = 0;
  const unitPrice = items.length > 0 ? Number(items[0].unit_price) : 0;

  items.forEach(item => {
    // `item.grade` no banco é a grade BASE (1 ficha, soma ~12/15). A
    // quantidade REALMENTE pedida está em `item.quantity`. O PDF precisa
    // escalar a base pela qtd real (multiplier = quantity / soma da base),
    // com largest-remainder pra a soma por numeração bater EXATAMENTE com
    // quantity — igual à tela do PV e à geração de OP.
    // BUG (corrigido 2026-06-09): antes usava a grade base CRUA → mostrava
    // ~12 pares por item e valores ~37× menores que o total real do pedido.
    const baseGrade = item.grade as Record<string, number> | null;
    const baseSum = baseGrade
      ? Object.entries(baseGrade).reduce((s, [k, v]) => k.startsWith('_') ? s : s + (Number(v) || 0), 0)
      : 0;
    const realQty = Number(item.quantity) || 0;
    const grade = (baseSum > 0 && realQty > 0)
      ? scaleGradeWithLargestRemainder(baseGrade, realQty / baseSum, realQty)
      : (baseGrade || {});
    const refCode = item.technical_sheets?.code || '';
    const refName = item.technical_sheets?.name || '';
    const color = item.color || '—';
    const price = Number(item.unit_price);
    let itemTotal = 0;
    let itemPairs = 0;
    const imageUrl = resolveUrl(getItemImage(item));

    let pedidaCells = '';
    let unitarioCells = '';
    let valorCells = '';
    sizes.forEach(s => {
      const qty = grade?.[s] ? Number(grade[s]) : 0;
      const val = qty * price;
      pedidaCells += `<td class="pv-size-cell${qty ? '' : ' empty'}">${qty || '·'}</td>`;
      unitarioCells += `<td class="pv-size-cell${qty > 0 ? '' : ' empty'}" style="font-size:8.5px;">${qty > 0 ? formatCurrency(price) : '·'}</td>`;
      valorCells += `<td class="pv-size-cell${qty > 0 ? '' : ' empty'}" style="font-size:8.5px;">${qty > 0 ? formatCurrency(val) : '·'}</td>`;
      itemTotal += val;
      itemPairs += qty;
      grandTotals[s].pedida += qty;
      grandTotals[s].valor += val;
    });
    grandTotalPairs += itemPairs;
    grandTotalValue += itemTotal;

    const imgCell = imageUrl
      ? `<td rowspan="3" class="pv-img-cell"><img src="${imageUrl}" alt="${escapeHtml(refCode)}" /></td>`
      : `<td rowspan="3" class="pv-img-cell empty">sem<br>foto</td>`;

    // Evita duplicação "DS05/DS05" quando code == name. Mostra só o code
    // se houver, ou só o name. ref-name só aparece quando difere do code.
    const showName = refName && refName !== refCode;
    const refCellContent = refCode
      ? `<span class="ref-code">${escapeHtml(refCode)}</span>${showName ? `<span class="ref-name">${escapeHtml(refName)}</span>` : ''}`
      : escapeHtml(refName || '—');

    bodyRows += `
      <tr class="pv-row-qty">
        ${imgCell}
        <td rowspan="3" class="pv-ref-cell">${refCellContent}</td>
        <td rowspan="3" class="pv-color-cell">${escapeHtml(color)}</td>
        <td class="pv-type-cell pv-type-cell--qty">Pedido</td>
        ${pedidaCells}
        <td class="pv-total-cell pv-total-cell--qty">${itemPairs}</td>
      </tr>
      <tr class="pv-row-unit">
        <td class="pv-type-cell">Unit.</td>
        ${unitarioCells}
        <td class="pv-total-cell pv-total-cell--unit">${formatCurrency(price)}</td>
      </tr>
      <tr class="pv-row-total">
        <td class="pv-type-cell">Total</td>
        ${valorCells}
        <td class="pv-total-cell pv-total-cell--total">${formatCurrency(itemTotal)}</td>
      </tr>`;
  });

  // Calculate averages or just show unit price if it's unique
  const avgUnitPrice = grandTotalPairs > 0 ? grandTotalValue / grandTotalPairs : unitPrice;

  // Industrial Editorial Pro: status são INK+texto, não bg colorido infantil.
  // Manter só accent semântico no dot (verde/âmbar/vermelho).
  const statusDot: Record<string, string> = {
    'Rascunho':           '#a1a1aa',
    'Pendente':           '#f59e0b',
    'Aprovado':           '#0a7b2c',
    'Em Produção':        '#3b82f6',
    'Pronto':             '#0a7b2c',
    'Faturado':           '#0a7b2c',
    'Expedido':           '#0a7b2c',
    'Concluído':          '#0a7b2c',
    'Finalizado s/ NF':   '#a1a1aa',
    'Cancelado':          '#D9264E',
  };
  const dotColor = statusDot[order.status] || '#a1a1aa';

  const issuedDate = order.created_at
    ? new Date(order.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return `
<style>
  /* ═══════════════════════════════════════════════════════════════════════
     PV PRINT — Industrial Editorial Pro (2026-05-29 redesign)
     PAPER #FAFAF7 · INK #0A0A0A · RED #D9264E
     Anton (display) · Fira Sans (body) · Fira Code (numbers)
     Rule-thick 3px · radius sharp 2px · sem gradientes
     ═══════════════════════════════════════════════════════════════════════ */
  @import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

  .pv-doc {
    font-family: 'Fira Sans', system-ui, -apple-system, sans-serif;
    color: #0A0A0A;
    font-size: 10.5px;
    line-height: 1.45;
    background: #FAFAF7;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .pv-doc * { box-sizing: border-box; }

  /* ── Eyebrow MONO (10px tracking widest uppercase) ── */
  .ed-eyebrow {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(10,10,10,0.55);
    line-height: 1;
  }

  /* ── Header editorial: 3 colunas com rule-thick embaixo ── */
  .pv-header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: flex-end;
    gap: 24px;
    padding: 0 0 14px 0;
    border-bottom: 3px solid #0A0A0A;
    margin-bottom: 16px;
  }
  .pv-header__brand {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pv-header__brand-mark {
    font-family: 'Anton', Impact, sans-serif;
    font-size: 28px;
    letter-spacing: -0.02em;
    line-height: 0.9;
    text-transform: uppercase;
    color: #0A0A0A;
    padding-top: 0.06em;
  }
  .pv-header__brand-mark .dot { color: #D9264E; }
  .pv-header__brand-tag {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 8.5px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(10,10,10,0.55);
  }
  .pv-header__title {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .pv-header__title-eyebrow {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: rgba(10,10,10,0.55);
  }
  .pv-header__num {
    font-family: 'Anton', Impact, sans-serif;
    font-size: 38px;
    letter-spacing: -0.01em;
    line-height: 0.9;
    color: #0A0A0A;
    padding-top: 0.05em;
  }
  .pv-header__meta {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    text-align: right;
  }
  .pv-header__meta-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 80px;
    text-align: right;
  }
  .pv-header__meta-label {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(10,10,10,0.55);
  }
  .pv-header__meta-value {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
    color: #0A0A0A;
    font-variant-numeric: tabular-nums;
  }
  .pv-header__status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border: 1.5px solid #0A0A0A;
    border-radius: 2px;
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #0A0A0A;
  }
  .pv-header__status-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: ${dotColor};
  }

  /* ── Cards de informações: 3 colunas, sharp 2px, sem fundo ── */
  .pv-info {
    display: grid;
    grid-template-columns: 1.3fr 1fr 1fr;
    gap: 14px;
    margin-bottom: 16px;
  }
  .pv-card {
    page-break-inside: avoid;
  }
  .pv-card__title {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 8.5px;
    font-weight: 600;
    color: #0A0A0A;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    padding-bottom: 6px;
    margin-bottom: 8px;
    border-bottom: 1.5px solid #0A0A0A;
  }
  .pv-card__row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 3px 0;
    font-size: 10.5px;
    align-items: baseline;
  }
  .pv-card__row .lbl {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 8.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(10,10,10,0.55);
    white-space: nowrap;
  }
  .pv-card__row .val {
    color: #0A0A0A;
    font-weight: 600;
    text-align: right;
    font-size: 11px;
  }
  .pv-card__row .val strong { font-weight: 800; }
  .pv-card__row .val.mono {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
  }

  /* ── Section title antes da tabela (rule + eyebrow + Anton) ── */
  .pv-items-title {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1.5px solid #0A0A0A;
    margin-bottom: 8px;
  }
  .pv-items-title__h {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pv-items-title__eyebrow {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: rgba(10,10,10,0.55);
  }
  .pv-items-title h2 {
    font-family: 'Anton', Impact, sans-serif;
    font-size: 18px;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    color: #0A0A0A;
    margin: 0;
    line-height: 1;
    padding-top: 0.05em;
  }
  .pv-items-title .count {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 10px;
    font-weight: 700;
    color: #0A0A0A;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }
  .pv-items-title .count em { color: rgba(10,10,10,0.55); font-style: normal; font-weight: 500; margin: 0 4px; }

  /* ── Tabela editorial — borda sharp, header INK ── */
  .pv-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    margin-bottom: 0;
    border: 1.5px solid #0A0A0A;
    border-radius: 2px;
    overflow: hidden;
  }
  .pv-table thead th {
    background: #0A0A0A;
    color: #FAFAF7;
    font-family: 'Fira Code', ui-monospace, monospace;
    font-weight: 700;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 8px 4px;
    text-align: center;
    border: none;
  }
  .pv-table thead th.text-left { text-align: left; padding-left: 10px; }

  .pv-table tbody td {
    padding: 4px 5px;
    vertical-align: middle;
    font-size: 10px;
    border: none;
  }
  .pv-row-qty td { border-top: 1.5px solid #0A0A0A; }
  .pv-table tbody tr:first-child td { border-top: none; }

  .pv-img-cell {
    width: 60px;
    text-align: center;
    padding: 5px !important;
    background: #FAFAF7;
    border-right: 1px solid rgba(10,10,10,0.12);
  }
  .pv-img-cell img {
    width: 50px;
    height: 50px;
    object-fit: cover;
    border-radius: 2px;
    border: 1.5px solid #0A0A0A;
    display: block;
    margin: 0 auto;
  }
  .pv-img-cell.empty {
    color: rgba(10,10,10,0.35);
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 7.5px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .pv-ref-cell {
    font-weight: 700;
    color: #0A0A0A;
    font-size: 11px;
    padding-left: 10px !important;
    border-right: 1px solid rgba(10,10,10,0.12);
  }
  .pv-ref-cell .ref-code {
    font-family: 'Fira Code', ui-monospace, monospace;
    color: #0A0A0A;
    font-weight: 800;
    letter-spacing: 0.02em;
    font-size: 12px;
  }
  .pv-ref-cell .ref-name {
    color: rgba(10,10,10,0.55);
    font-weight: 500;
    font-size: 9px;
    display: block;
    margin-top: 2px;
    font-style: italic;
  }

  .pv-color-cell {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-weight: 700;
    color: #0A0A0A;
    font-size: 9.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border-right: 1px solid rgba(10,10,10,0.12);
    text-align: center;
  }

  .pv-type-cell {
    background: rgba(10,10,10,0.04);
    font-family: 'Fira Code', ui-monospace, monospace;
    font-weight: 600;
    font-size: 8.5px;
    color: rgba(10,10,10,0.55);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    text-align: left;
    padding-left: 10px !important;
    width: 60px;
    white-space: nowrap;
    border-right: 1px solid rgba(10,10,10,0.12);
  }
  .pv-type-cell--qty {
    color: #0A0A0A;
    background: rgba(10,10,10,0.08);
    font-weight: 700;
  }

  .pv-size-cell {
    text-align: center;
    font-family: 'Fira Code', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    color: rgba(10,10,10,0.7);
    padding: 4px 4px;
  }
  .pv-size-cell.empty { color: rgba(10,10,10,0.18); }
  .pv-row-qty .pv-size-cell {
    color: #0A0A0A;
    font-weight: 700;
    font-size: 12px;
  }
  .pv-row-unit .pv-size-cell {
    color: rgba(10,10,10,0.5);
    font-size: 8.5px;
    font-weight: 500;
  }
  .pv-row-total .pv-size-cell {
    color: rgba(10,10,10,0.7);
    font-size: 8.5px;
    font-weight: 600;
  }

  .pv-total-cell {
    text-align: center;
    font-family: 'Fira Code', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    color: #0A0A0A;
    background: rgba(10,10,10,0.04);
    border-left: 1.5px solid #0A0A0A;
  }
  .pv-total-cell--qty { font-weight: 800; font-size: 12px; }
  .pv-total-cell--unit { font-weight: 600; font-size: 9px; color: rgba(10,10,10,0.6); }
  .pv-total-cell--total { font-weight: 800; font-size: 10.5px; color: #D9264E; }

  /* ── Linha de totais geral (INK) ── */
  .pv-totals-row td {
    background: #0A0A0A !important;
    color: #FAFAF7 !important;
    font-family: 'Fira Code', ui-monospace, monospace;
    font-weight: 700;
    padding: 9px 5px;
    font-size: 10.5px;
    border: none !important;
    border-top: 2px solid #0A0A0A !important;
  }
  .pv-totals-row .label-cell {
    text-align: right;
    padding-right: 14px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-size: 9px;
  }
  .pv-totals-value-row td {
    background: rgba(10,10,10,0.04) !important;
    color: rgba(10,10,10,0.85) !important;
    font-family: 'Fira Code', ui-monospace, monospace;
    font-weight: 700;
    padding: 7px 5px;
    font-size: 9.5px;
    border: none !important;
    border-top: 1px solid rgba(10,10,10,0.12) !important;
  }
  .pv-totals-value-row .label-cell {
    text-align: right;
    padding-right: 14px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(10,10,10,0.55);
    font-size: 9px;
    font-weight: 600;
  }

  /* ── Resumo: notas + KPI hero ── */
  .pv-summary {
    display: grid;
    grid-template-columns: 1.6fr 1fr 1fr;
    gap: 14px;
    margin-top: 16px;
    page-break-inside: avoid;
  }
  .pv-summary__notes {
    padding: 12px 14px;
    background: #FAFAF7;
    border: 1.5px solid #0A0A0A;
    border-radius: 2px;
  }
  .pv-summary__notes-title {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 8.5px;
    font-weight: 600;
    color: #0A0A0A;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    margin-bottom: 6px;
    padding-bottom: 5px;
    border-bottom: 1.5px solid #0A0A0A;
  }
  .pv-summary__notes-content {
    font-family: 'Fira Sans', sans-serif;
    font-size: 10.5px;
    color: #0A0A0A;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .pv-summary__notes-content.empty {
    color: rgba(10,10,10,0.35);
    font-style: italic;
  }
  .pv-summary__kpi {
    padding: 12px 14px;
    background: #FAFAF7;
    border: 1.5px solid #0A0A0A;
    border-radius: 2px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
  }
  .pv-summary__kpi.primary {
    background: #0A0A0A;
    color: #FAFAF7;
    border-color: #0A0A0A;
  }
  .pv-summary__kpi-label {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 8.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: rgba(10,10,10,0.55);
  }
  .pv-summary__kpi.primary .pv-summary__kpi-label {
    color: rgba(250,250,247,0.65);
  }
  .pv-summary__kpi-value {
    font-family: 'Anton', Impact, sans-serif;
    font-size: 32px;
    font-weight: 400;
    color: #0A0A0A;
    line-height: 0.92;
    letter-spacing: -0.02em;
    padding-top: 0.05em;
    font-variant-numeric: tabular-nums;
  }
  .pv-summary__kpi.primary .pv-summary__kpi-value {
    color: #FAFAF7;
    font-size: 28px;
  }
  .pv-summary__kpi-sub {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 9px;
    font-weight: 500;
    color: rgba(10,10,10,0.55);
    margin-top: 2px;
    letter-spacing: 0.04em;
  }
  .pv-summary__kpi.primary .pv-summary__kpi-sub {
    color: rgba(250,250,247,0.55);
  }

  /* ── Assinaturas: rule INK 1.5px ── */
  .pv-signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    margin-top: 28px;
    padding: 0 4px;
    page-break-inside: avoid;
  }
  .pv-sig-box {
    text-align: center;
    border-top: 1.5px solid #0A0A0A;
    padding-top: 8px;
  }
  .pv-sig-box .lbl {
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 9px;
    color: #0A0A0A;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.18em;
  }
  .pv-sig-box .sub {
    font-family: 'Fira Sans', sans-serif;
    font-size: 9px;
    color: rgba(10,10,10,0.55);
    margin-top: 3px;
    font-style: italic;
  }

  .pv-footer {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1.5px solid #0A0A0A;
    font-family: 'Fira Code', ui-monospace, monospace;
    font-size: 8.5px;
    color: rgba(10,10,10,0.55);
    text-align: center;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
</style>

<div class="pv-doc">
  <!-- Header editorial: 3 colunas + rule-thick -->
  <div class="pv-header">
    <div class="pv-header__brand">
      <div class="pv-header__brand-mark">Squad<span class="dot">·</span>Shoes</div>
      <div class="pv-header__brand-tag">Gestão Industrial · Indústria</div>
    </div>
    <div class="pv-header__title">
      <div class="pv-header__title-eyebrow">Pedido de Venda</div>
      <div class="pv-header__num">${escapeHtml(order.order_number || '—')}</div>
    </div>
    <div class="pv-header__meta">
      <div class="pv-header__meta-item">
        <span class="pv-header__meta-label">Emitido</span>
        <span class="pv-header__meta-value">${issuedDate}</span>
      </div>
      ${order.client_order_number ? `
      <div class="pv-header__meta-item">
        <span class="pv-header__meta-label">Ped. cliente</span>
        <span class="pv-header__meta-value">${escapeHtml(order.client_order_number)}</span>
      </div>` : ''}
      <div class="pv-header__status">
        <span class="pv-header__status-dot"></span>
        ${escapeHtml(order.status || '—')}
      </div>
    </div>
  </div>

  <!-- Cards informativos -->
  <div class="pv-info">
    <div class="pv-card">
      <div class="pv-card__title">Cliente</div>
      <div class="pv-card__row">
        <span class="lbl">Razão</span>
        <span class="val">
          ${(order as any).client_number ? `<strong>#${escapeHtml((order as any).client_number)}</strong> · ` : ''}<strong>${escapeHtml(order.client_name || '—')}</strong>
        </span>
      </div>
      <div class="pv-card__row">
        <span class="lbl">CNPJ/CPF</span>
        <span class="val mono">${escapeHtml(order.client_cnpj || '—')}</span>
      </div>
      <div class="pv-card__row">
        <span class="lbl">Contato</span>
        <span class="val">${escapeHtml(order.client_contact || '—')}</span>
      </div>
    </div>
    <div class="pv-card">
      <div class="pv-card__title">Comercial</div>
      <div class="pv-card__row">
        <span class="lbl">Vendedor</span>
        <span class="val">${escapeHtml(order.representative || '—')}</span>
      </div>
      <div class="pv-card__row">
        <span class="lbl">Pagamento</span>
        <span class="val">${escapeHtml(order.payment_condition || '—')}</span>
      </div>
      ${order.commission_value ? `
      <div class="pv-card__row">
        <span class="lbl">Comissão</span>
        <span class="val mono">R$ ${formatCurrency(Number(order.commission_value))}</span>
      </div>` : ''}
    </div>
    <div class="pv-card">
      <div class="pv-card__title">Entrega</div>
      <div class="pv-card__row">
        <span class="lbl">Prazo</span>
        <span class="val mono"><strong>${order.delivery_deadline ? new Date(order.delivery_deadline + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</strong></span>
      </div>
      ${order.delivery_month ? `
      <div class="pv-card__row">
        <span class="lbl">Faturamento</span>
        <span class="val mono">${escapeHtml(order.delivery_month)}${order.delivery_week ? ` · ${escapeHtml(order.delivery_week)}` : ''}</span>
      </div>` : ''}
      ${order.nfe ? `
      <div class="pv-card__row">
        <span class="lbl">NF-e</span>
        <span class="val mono">${escapeHtml(order.nfe)}</span>
      </div>` : ''}
    </div>
  </div>

  <!-- Section title editorial pra tabela -->
  <div class="pv-items-title">
    <div class="pv-items-title__h">
      <span class="pv-items-title__eyebrow">Detalhamento</span>
      <h2>Itens do Pedido</h2>
    </div>
    <span class="count">${items.length}<em>${items.length === 1 ? 'ref' : 'refs'}</em>${grandTotalPairs}<em>pares</em>R$ ${formatCurrency(grandTotalValue)}</span>
  </div>

  <table class="pv-table">
    <thead>
      <tr>
        <th style="width:56px;">Foto</th>
        <th class="text-left" style="min-width:130px;">Referência</th>
        <th style="width:80px;">Cor</th>
        <th style="width:54px;">Tipo</th>
        ${sizes.map(s => `<th style="min-width:32px;">${s}</th>`).join('')}
        <th style="width:74px;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="pv-totals-row">
        <td colspan="3" class="label-cell">Total · Pares</td>
        <td class="pv-type-cell" style="background:transparent !important; color:#FAFAF7 !important;font-weight:700;border-right:none !important;">PARES</td>
        ${sizes.map(s => `<td class="pv-size-cell" style="color:#FAFAF7 !important;font-weight:800;font-size:12px;">${grandTotals[s].pedida || '·'}</td>`).join('')}
        <td class="pv-total-cell" style="background:transparent !important; color:#FAFAF7 !important; border-left:1.5px solid rgba(250,250,247,0.3) !important;font-weight:800;font-size:12px;">${grandTotalPairs}</td>
      </tr>
      <tr class="pv-totals-value-row">
        <td colspan="4" class="label-cell">Valor por Numeração</td>
        ${sizes.map(s => `<td class="pv-size-cell" style="font-family:'Fira Code',monospace;font-size:8.5px;color:rgba(10,10,10,0.7) !important;">${grandTotals[s].valor > 0 ? formatCurrency(grandTotals[s].valor) : '·'}</td>`).join('')}
        <td class="pv-total-cell" style="color:#D9264E !important;font-weight:800;font-size:10.5px;border-left:1.5px solid #0A0A0A !important;">${formatCurrency(grandTotalValue)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Resumo + KPIs editorial -->
  <div class="pv-summary">
    ${order.notes ? `
    <div class="pv-summary__notes">
      <div class="pv-summary__notes-title">Observações</div>
      <div class="pv-summary__notes-content">${escapeHtml(order.notes)}</div>
    </div>` : `
    <div class="pv-summary__notes">
      <div class="pv-summary__notes-title">Observações</div>
      <div class="pv-summary__notes-content empty">Nenhuma observação adicional.</div>
    </div>`}
    <div class="pv-summary__kpi">
      <div class="pv-summary__kpi-label">Pares</div>
      <div class="pv-summary__kpi-value">${grandTotalPairs}</div>
      <div class="pv-summary__kpi-sub">${items.length} ${items.length === 1 ? 'referência' : 'referências'}</div>
    </div>
    <div class="pv-summary__kpi primary">
      <div class="pv-summary__kpi-label">Total</div>
      <div class="pv-summary__kpi-value">R$ ${formatCurrency(grandTotalValue)}</div>
      <div class="pv-summary__kpi-sub">R$ ${formatCurrency(avgUnitPrice)} / par</div>
    </div>
  </div>

  <!-- Assinaturas -->
  <div class="pv-signatures">
    <div class="pv-sig-box">
      <div class="lbl">Cliente</div>
      <div class="sub">${escapeHtml(order.client_name || '')}</div>
    </div>
    <div class="pv-sig-box">
      <div class="lbl">Vendedor / Representante</div>
      <div class="sub">${escapeHtml(order.representative || '—')}</div>
    </div>
  </div>

  <div class="pv-footer">
    Squad Shoes · Gestão Comercial · ${new Date().toLocaleString('pt-BR')}
  </div>
</div>`;
}


export function buildProductionOrderPrintHtml(order: any, materials: any[]) {
  const refName = order.technical_sheets?.name || '—';
  const refCode = order.technical_sheets?.code || '';

  let matsHtml = '';
  const orderGrade = order.grade as Record<string, number> | null;
  materials.forEach(m => {
    const perSize = (m as any).consumption_per_size as Record<string, number> | null;
    let needed: number;
    if (perSize && orderGrade && Object.keys(perSize).length > 0 && Object.keys(orderGrade).length > 0) {
      needed = Object.entries(orderGrade).reduce((sum, [size, pairs]) => {
        const p = Number(pairs) || 0;
        const c = Number(perSize[size]) || Number(m.quantity_per_unit) || 0;
        return sum + p * c;
      }, 0);
    } else {
      needed = Number(m.quantity_per_unit) * order.quantity;
    }
    matsHtml += `<tr>
      <td>${escapeHtml(m.products?.name || '—')}</td>
      <td class="text-right mono">${Number(m.quantity_per_unit).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
      <td class="text-right mono">${needed.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
      <td>${escapeHtml(m.products?.unit || '')}</td>
    </tr>`;
  });

  const grade = order.grade as Record<string, number> | null;
  // Build a proper grade distribution table
  let gradeHtml = '';
  if (grade && typeof grade === 'object') {
    const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];
    const activeSizes = SIZES.filter(s => (Number(grade[s]) || 0) > 0);
    if (activeSizes.length > 0) {
      const gradeSum = activeSizes.reduce((sum, s) => sum + (Number(grade[s]) || 0), 0);
      const totalPairs = order.quantity || gradeSum;
      const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
      const headerCells = activeSizes.map(s => `<th style="border:1px solid #999;padding:3px 4px;text-align:center;font-size:10px;background:#e8e8d0;">${s}</th>`).join('');
      const baseCells = activeSizes.map(s => `<td style="border:1px solid #999;padding:3px 4px;text-align:center;font-family:monospace;font-size:10px;color:#666;">${Number(grade[s]) || 0}</td>`).join('');
      const scaledCells = activeSizes.map(s => {
        const qty = Math.round((Number(grade[s]) || 0) * multiplier);
        return `<td style="border:1px solid #999;padding:3px 4px;text-align:center;font-family:monospace;font-size:11px;font-weight:700;">${qty}</td>`;
      }).join('');
      const showBaseRow = gradeSum !== totalPairs;
      gradeHtml = `
<h2>Grade de Distribuição por Número</h2>
<table style="border-collapse:collapse;margin-bottom:8px;">
  <thead><tr>${headerCells}<th style="border:1px solid #999;padding:3px 4px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th></tr></thead>
  <tbody>
    ${showBaseRow ? `<tr style="background:#f9f9f0;">${baseCells}<td style="border:1px solid #999;padding:3px 4px;text-align:center;font-family:monospace;font-size:10px;color:#666;background:#f5f5e8;">${gradeSum}p (ficha)</td></tr>` : ''}
    <tr>${scaledCells}<td style="border:1px solid #999;padding:3px 4px;text-align:center;font-family:monospace;font-size:12px;font-weight:700;background:#f5f5f0;">${totalPairs}</td></tr>
  </tbody>
</table>`;
    }
  }

  return `
<h1>Ordem de Produção — ${escapeHtml(order.order_number || '')}</h1>
<p class="subtitle">Status: ${escapeHtml(order.status)}</p>
<div class="info-grid">
  <div><span class="label">Referência:</span> ${escapeHtml(refCode)} - ${escapeHtml(refName)}</div>
  <div><span class="label">Quantidade:</span> ${order.quantity} pares</div>
  <div><span class="label">Cor:</span> ${escapeHtml(order.color || '—')}</div>
  <div><span class="label">Embalagem:</span> ${escapeHtml(order.packaging_type || '—')}</div>
  <div><span class="label">Linha Produção:</span> ${escapeHtml(order.production_line || '—')}</div>
  <div><span class="label">Responsável:</span> ${escapeHtml(order.responsible || '—')}</div>
  <div><span class="label">Início Plan.:</span> ${order.planned_start ? new Date(order.planned_start).toLocaleDateString('pt-BR') : '—'}</div>
  <div><span class="label">Entrega Plan.:</span> ${order.planned_delivery ? new Date(order.planned_delivery).toLocaleDateString('pt-BR') : '—'}</div>
</div>
${gradeHtml}
${order.notes ? `<p><span class="label">Obs:</span> ${escapeHtml(order.notes)}</p>` : ''}
${materials.length > 0 ? `
<h2>Materiais Necessários</h2>
<table>
  <thead><tr><th>Material</th><th class="text-right">Qtd/Par</th><th class="text-right">Total</th><th>Unidade</th></tr></thead>
  <tbody>${matsHtml}</tbody>
</table>` : ''}`;
}
