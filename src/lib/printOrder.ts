import { getSignedUrl } from '@/lib/getSignedUrl';
import { escapeHtml } from './htmlUtils';

function buildPrintHtmlContent(title: string, bodyHtml: string, options?: { landscape?: boolean }): string {
  const pageSize = options?.landscape ? 'A4 landscape' : 'A4';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page {
    size: ${pageSize};
    margin: 8mm 8mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #000; font-weight: 400; line-height: 1.35; padding: 5mm 6mm; max-width: ${options?.landscape ? '297mm' : '210mm'}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 18px; font-weight: 800; margin-bottom: 4px; color: #000; letter-spacing: -0.2px; }
  h2 { font-size: 14px; font-weight: 800; margin: 10px 0 4px; border-bottom: 2px solid #000; padding-bottom: 2px; color: #000; text-transform: uppercase; letter-spacing: 0.3px; }
  .subtitle { font-size: 11px; color: #1a1a1a; margin-bottom: 8px; font-weight: 600; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin-bottom: 8px; font-size: 11px; }
  .info-grid .label { font-weight: 700; color: #000; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { border: 1px solid #555; padding: 4px 6px; text-align: left; font-size: 11px; color: #000; font-weight: 500; }
  th { background: #1f2937; color: #fff !important; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; font-size: 10.5px; }
  tbody tr:nth-child(even) td { background: #f7f8fa; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .mono { font-family: 'SFMono-Regular', 'Courier New', monospace; font-variant-numeric: tabular-nums; font-weight: 600; }
  .footer { margin-top: 10px; font-size: 9px; color: #1a1a1a; text-align: center; border-top: 1px solid #999; padding-top: 4px; font-weight: 600; }
  .total-row td { font-weight: 800 !important; background: #fef3c7 !important; color: #000 !important; border-top: 2px solid #000; font-size: 11.5px; }
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
    if (grade) Object.keys(grade).forEach(s => allSizes.add(s));
  });
  const sizes = Array.from(allSizes).sort((a, b) => Number(a) - Number(b));

  let bodyRows = '';
  const grandTotals: Record<string, { pedida: number; valor: number }> = {};
  sizes.forEach(s => { grandTotals[s] = { pedida: 0, valor: 0 }; });
  let grandTotalPairs = 0;
  let grandTotalValue = 0;
  const unitPrice = items.length > 0 ? Number(items[0].unit_price) : 0;

  items.forEach(item => {
    const grade = item.grade as Record<string, number> | null;
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


  // Status badge color por status (cor semântica)
  const statusColors: Record<string, { bg: string; fg: string; border: string }> = {
    'Rascunho':     { bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1' },
    'Pendente':     { bg: '#fef3c7', fg: '#92400e', border: '#fbbf24' },
    'Aprovado':     { bg: '#dbeafe', fg: '#1e40af', border: '#60a5fa' },
    'Em Produção':  { bg: '#ede9fe', fg: '#6d28d9', border: '#a78bfa' },
    'Pronto':       { bg: '#d1fae5', fg: '#065f46', border: '#34d399' },
    'Faturado':     { bg: '#cffafe', fg: '#155e75', border: '#22d3ee' },
    'Cancelado':    { bg: '#fee2e2', fg: '#991b1b', border: '#f87171' },
  };
  const sc = statusColors[order.status] || statusColors['Rascunho'];

  const issuedDate = order.created_at
    ? new Date(order.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return `
<style>
  .pv-doc {
    font-family: 'Helvetica Neue', -apple-system, 'Segoe UI', Arial, sans-serif;
    color: #1a1a1a;
    font-size: 11px;
    line-height: 1.4;
  }
  .pv-doc * { box-sizing: border-box; }

  /* Header — burgundy band com identidade Squad Shoes */
  .pv-header {
    display: flex;
    align-items: stretch;
    margin-bottom: 12px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #d4d4d4;
  }
  .pv-header__brand {
    background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
    color: #fff;
    padding: 14px 18px;
    flex: 0 0 36%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
  }
  .pv-header__brand-title {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    opacity: 0.85;
  }
  .pv-header__brand-name {
    font-size: 18px;
    font-weight: 900;
    letter-spacing: -0.2px;
    line-height: 1;
  }
  .pv-header__brand-tag {
    font-size: 9px;
    opacity: 0.7;
    margin-top: 2px;
    letter-spacing: 0.05em;
  }
  .pv-header__title {
    flex: 1;
    padding: 14px 18px;
    background: #fff;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
  }
  .pv-header__doc {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.2em;
    color: #71717a;
    text-transform: uppercase;
  }
  .pv-header__num {
    font-size: 22px;
    font-weight: 900;
    color: #18181b;
    line-height: 1;
    letter-spacing: -0.5px;
    font-family: 'SFMono-Regular', 'Courier New', monospace;
  }
  .pv-header__meta {
    display: flex;
    gap: 14px;
    font-size: 9.5px;
    color: #52525b;
    margin-top: 2px;
  }
  .pv-header__meta strong { color: #18181b; }
  .pv-header__status {
    flex: 0 0 110px;
    background: ${sc.bg};
    border-left: 1px solid #d4d4d4;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 10px;
  }
  .pv-header__status-label {
    font-size: 8px;
    font-weight: 700;
    color: ${sc.fg};
    letter-spacing: 0.15em;
    text-transform: uppercase;
    opacity: 0.7;
  }
  .pv-header__status-value {
    font-size: 11px;
    font-weight: 800;
    color: ${sc.fg};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Cards de informações */
  .pv-info {
    display: grid;
    grid-template-columns: 1.4fr 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
  }
  .pv-card {
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    padding: 8px 12px;
    background: #fafafa;
    page-break-inside: avoid;
  }
  .pv-card__title {
    font-size: 8.5px;
    font-weight: 800;
    color: #71717a;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid #e4e4e7;
  }
  .pv-card__row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; font-size: 10px; }
  .pv-card__row .lbl { color: #71717a; font-weight: 600; }
  .pv-card__row .val { color: #18181b; font-weight: 600; text-align: right; }
  .pv-card__row .val strong { font-weight: 800; }

  /* Tabela de itens */
  .pv-items-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .pv-items-title h2 {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #18181b;
    margin: 0;
  }
  .pv-items-title .count { font-size: 9.5px; color: #71717a; font-weight: 600; }

  .pv-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
    margin-bottom: 4px;
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    overflow: hidden;
  }
  .pv-table thead th {
    background: #18181b;
    color: #fff;
    font-weight: 700;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 6px 4px;
    text-align: center;
    border: none;
  }
  .pv-table thead th:first-child { border-top-left-radius: 6px; }
  .pv-table thead th:last-child  { border-top-right-radius: 6px; }
  .pv-table thead th.text-left { text-align: left; padding-left: 8px; }

  .pv-table tbody td {
    padding: 3px 5px;
    vertical-align: middle;
    font-size: 9.5px;
    border: none;
  }
  /* Separador entre grupos de item (foto/ref/cor). Linha leve, não pesada. */
  .pv-row-qty td { border-top: 1px solid #d4d4d4; }
  .pv-table tbody tr:first-child td { border-top: none; }

  .pv-img-cell { width: 56px; text-align: center; padding: 4px !important; background: #fafafa; }
  .pv-img-cell img {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid #e4e4e7;
    display: block;
    margin: 0 auto;
  }
  .pv-img-cell.empty {
    color: #d4d4d8;
    font-size: 8px;
    font-style: italic;
  }

  .pv-ref-cell { font-weight: 700; color: #18181b; font-size: 10.5px; padding-left: 8px !important; }
  .pv-ref-cell .ref-code { color: #7f1d1d; font-weight: 800; letter-spacing: 0.02em; }
  .pv-ref-cell .ref-name { color: #71717a; font-weight: 500; font-size: 9px; display: block; margin-top: 1px; }

  .pv-color-cell {
    font-weight: 600;
    color: #18181b;
    font-size: 9.5px;
    letter-spacing: 0.02em;
  }

  .pv-type-cell {
    background: #fafafa;
    font-weight: 700;
    font-size: 8.5px;
    color: #71717a;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    text-align: left;
    padding-left: 8px !important;
    width: 54px;
    white-space: nowrap;
  }
  /* Linha PEDIDO: label preto pra reforçar que é a linha primária */
  .pv-type-cell--qty {
    color: #18181b;
    background: #f4f4f5;
  }

  .pv-size-cell {
    text-align: center;
    font-family: 'SFMono-Regular', 'Courier New', monospace;
    font-variant-numeric: tabular-nums;
    color: #3f3f46;
    padding: 3px 4px;
  }
  .pv-size-cell.empty { color: #d4d4d8; }
  /* Quantidade (linha primária): texto mais escuro e bold */
  .pv-row-qty .pv-size-cell { color: #18181b; font-weight: 700; font-size: 11px; }
  /* Preço unitário: cinza médio, menor */
  .pv-row-unit .pv-size-cell { color: #71717a; font-size: 8.5px; font-weight: 500; }
  /* Valor total: contraste médio, mantém destaque numérico */
  .pv-row-total .pv-size-cell { color: #3f3f46; font-size: 8.5px; font-weight: 600; }

  .pv-total-cell {
    text-align: center;
    font-family: 'SFMono-Regular', 'Courier New', monospace;
    font-variant-numeric: tabular-nums;
    color: #18181b;
    background: #fafafa;
    border-left: 1px solid #e4e4e7;
  }
  .pv-total-cell--qty { font-weight: 800; font-size: 11px; }
  .pv-total-cell--unit { font-weight: 600; font-size: 9px; color: #52525b; }
  .pv-total-cell--total { font-weight: 800; font-size: 10px; color: #7f1d1d; }

  /* Linha do PEDIDO recebe leve realce de fundo pra firmar hierarquia */
  .pv-row-qty .pv-size-cell { background: #fdfdfd; }

  /* Totais */
  .pv-totals-row td {
    background: #18181b !important;
    color: #fff !important;
    font-weight: 700;
    padding: 7px 5px;
    font-size: 10px;
    border: none !important;
  }
  .pv-totals-row .label-cell {
    text-align: right;
    padding-right: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 9px;
  }
  .pv-totals-value-row td {
    background: #fafafa !important;
    color: #27272a !important;
    font-weight: 700;
    padding: 6px 5px;
    font-size: 9.5px;
    border: none !important;
    border-top: 1px solid #e4e4e7 !important;
  }
  .pv-totals-value-row .label-cell {
    text-align: right;
    padding-right: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #71717a;
    font-size: 9px;
  }

  /* Card resumo financeiro */
  .pv-summary {
    display: grid;
    grid-template-columns: 1.5fr 1fr 1fr;
    gap: 8px;
    margin-top: 12px;
    page-break-inside: avoid;
  }
  .pv-summary__notes {
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    padding: 8px 12px;
    background: #fffbeb;
    border-color: #fde68a;
  }
  .pv-summary__notes-title {
    font-size: 8.5px;
    font-weight: 800;
    color: #92400e;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 3px;
  }
  .pv-summary__notes-content {
    font-size: 10px;
    color: #422006;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .pv-summary__kpi {
    border: 1px solid #d4d4d4;
    border-radius: 6px;
    padding: 8px 12px;
    background: #fafafa;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .pv-summary__kpi.primary {
    background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
    color: #fff;
    border-color: #7f1d1d;
  }
  .pv-summary__kpi-label {
    font-size: 8.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #71717a;
    margin-bottom: 4px;
  }
  .pv-summary__kpi.primary .pv-summary__kpi-label { color: #fbcfe8; opacity: 0.9; }
  .pv-summary__kpi-value {
    font-size: 18px;
    font-weight: 900;
    font-family: 'SFMono-Regular', 'Courier New', monospace;
    color: #18181b;
    line-height: 1;
    letter-spacing: -0.5px;
  }
  .pv-summary__kpi.primary .pv-summary__kpi-value { color: #fff; font-size: 20px; }
  .pv-summary__kpi-sub {
    font-size: 9px;
    color: #71717a;
    margin-top: 3px;
  }
  .pv-summary__kpi.primary .pv-summary__kpi-sub { color: #fde2e2; }

  /* Footer / assinaturas */
  .pv-signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-top: 22px;
    padding: 0 8px;
    page-break-inside: avoid;
  }
  .pv-sig-box {
    text-align: center;
    border-top: 1px solid #18181b;
    padding-top: 6px;
  }
  .pv-sig-box .lbl {
    font-size: 8.5px;
    color: #52525b;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .pv-sig-box .sub {
    font-size: 8px;
    color: #a1a1aa;
    margin-top: 2px;
  }

  .pv-footer {
    margin-top: 14px;
    padding-top: 8px;
    border-top: 1px solid #e4e4e7;
    font-size: 8px;
    color: #a1a1aa;
    text-align: center;
    letter-spacing: 0.05em;
  }
</style>

<div class="pv-doc">
  <!-- Cabeçalho -->
  <div class="pv-header">
    <div class="pv-header__brand">
      <div class="pv-header__brand-title">Squad Shoes · Indústria</div>
      <div class="pv-header__brand-name">SQUAD SHOES</div>
      <div class="pv-header__brand-tag">GESTÃO COMERCIAL</div>
    </div>
    <div class="pv-header__title">
      <div class="pv-header__doc">Pedido de Venda</div>
      <div class="pv-header__num">${escapeHtml(order.order_number || '—')}</div>
      <div class="pv-header__meta">
        <span>Emitido em <strong>${issuedDate}</strong></span>
        ${order.client_order_number ? `<span>Ped. cliente <strong>${escapeHtml(order.client_order_number)}</strong></span>` : ''}
      </div>
    </div>
    <div class="pv-header__status">
      <div class="pv-header__status-label">Status</div>
      <div class="pv-header__status-value">${escapeHtml(order.status || '—')}</div>
    </div>
  </div>

  <!-- Cards de info -->
  <div class="pv-info">
    <div class="pv-card">
      <div class="pv-card__title">Cliente</div>
      <div class="pv-card__row">
        <span class="lbl">Razão Social</span>
        <span class="val">
          ${(order as any).client_number ? `<strong style="color:#7f1d1d;">#${escapeHtml((order as any).client_number)}</strong> · ` : ''}<strong>${escapeHtml(order.client_name || '—')}</strong>
        </span>
      </div>
      <div class="pv-card__row">
        <span class="lbl">CNPJ / CPF</span>
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
        <span class="lbl">Representante</span>
        <span class="val">${escapeHtml(order.representative || '—')}</span>
      </div>
      <div class="pv-card__row">
        <span class="lbl">Pagamento</span>
        <span class="val">${escapeHtml(order.payment_condition || '—')}</span>
      </div>
      ${order.commission_value ? `
      <div class="pv-card__row">
        <span class="lbl">Comissão</span>
        <span class="val">R$ ${formatCurrency(Number(order.commission_value))}</span>
      </div>` : ''}
    </div>
    <div class="pv-card">
      <div class="pv-card__title">Entrega</div>
      <div class="pv-card__row">
        <span class="lbl">Prazo</span>
        <span class="val"><strong>${order.delivery_deadline ? new Date(order.delivery_deadline + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</strong></span>
      </div>
      ${order.delivery_month ? `
      <div class="pv-card__row">
        <span class="lbl">Mês fatur.</span>
        <span class="val">${escapeHtml(order.delivery_month)}${order.delivery_week ? ` · ${escapeHtml(order.delivery_week)}` : ''}</span>
      </div>` : ''}
      ${order.nfe ? `
      <div class="pv-card__row">
        <span class="lbl">NF-e</span>
        <span class="val mono">${escapeHtml(order.nfe)}</span>
      </div>` : ''}
    </div>
  </div>

  <!-- Tabela de itens -->
  <div class="pv-items-title">
    <h2>Itens do Pedido</h2>
    <span class="count">${items.length} referência(s) · ${grandTotalPairs} pares</span>
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
        <td colspan="3" class="label-cell">Total Geral · Pares</td>
        <td class="pv-type-cell" style="background:transparent !important; color:#fff !important;font-weight:700;">PARES</td>
        ${sizes.map(s => `<td class="pv-size-cell" style="color:#fff !important;font-weight:800;font-size:11px;">${grandTotals[s].pedida || '·'}</td>`).join('')}
        <td class="pv-total-cell" style="background:#27272a !important; color:#fff !important; border-left:1px solid #3f3f46 !important;font-weight:800;font-size:11px;">${grandTotalPairs}</td>
      </tr>
      <tr class="pv-totals-value-row">
        <td colspan="4" class="label-cell">Valor por Numeração</td>
        ${sizes.map(s => `<td class="pv-size-cell" style="font-size:8.5px;color:#52525b !important;">${grandTotals[s].valor > 0 ? formatCurrency(grandTotals[s].valor) : '·'}</td>`).join('')}
        <td class="pv-total-cell" style="color:#7f1d1d !important;font-weight:800;font-size:10px;">${formatCurrency(grandTotalValue)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Resumo + KPIs -->
  <div class="pv-summary">
    ${order.notes ? `
    <div class="pv-summary__notes">
      <div class="pv-summary__notes-title">📝 Observações</div>
      <div class="pv-summary__notes-content">${escapeHtml(order.notes)}</div>
    </div>` : `
    <div class="pv-summary__notes" style="background:#fafafa; border-color:#e4e4e7;">
      <div class="pv-summary__notes-title" style="color:#a1a1aa;">Observações</div>
      <div class="pv-summary__notes-content" style="color:#a1a1aa; font-style:italic;">Nenhuma observação adicional.</div>
    </div>`}
    <div class="pv-summary__kpi">
      <div class="pv-summary__kpi-label">Total de Pares</div>
      <div class="pv-summary__kpi-value">${grandTotalPairs}</div>
      <div class="pv-summary__kpi-sub">${items.length} referência(s)</div>
    </div>
    <div class="pv-summary__kpi primary">
      <div class="pv-summary__kpi-label">Valor Total</div>
      <div class="pv-summary__kpi-value">R$ ${formatCurrency(grandTotalValue)}</div>
      <div class="pv-summary__kpi-sub">Preço médio R$ ${formatCurrency(avgUnitPrice)}/par</div>
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
    Documento gerado pelo Squad Shoes — Sistema de Gestão Comercial · ${new Date().toLocaleString('pt-BR')}
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
