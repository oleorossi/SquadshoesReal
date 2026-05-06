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
    const refLabel = `${item.technical_sheets?.code || ''}-${item.technical_sheets?.name || ''}`;
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
      pedidaCells += `<td class="text-center mono">${qty || ''}</td>`;
      unitarioCells += `<td class="text-center mono">${qty > 0 ? formatCurrency(price) : ''}</td>`;
      valorCells += `<td class="text-center mono">${qty > 0 ? formatCurrency(val) : ''}</td>`;
      itemTotal += val;
      itemPairs += qty;
      grandTotals[s].pedida += qty;
      grandTotals[s].valor += val;
    });
    grandTotalPairs += itemPairs;
    grandTotalValue += itemTotal;

    const imgCell = imageUrl
      ? `<td rowspan="3" class="img-cell"><img src="${imageUrl}" alt="${escapeHtml(refLabel)}" /></td>`
      : `<td rowspan="3" class="img-cell" style="color:#aaa;font-size:8px;">Sem foto</td>`;

    bodyRows += `
      <tr class="row-product">
        ${imgCell}
        <td rowspan="3" class="product-cell">${escapeHtml(refLabel)}</td>
        <td rowspan="3" class="color-cell">${escapeHtml(color)}</td>
        <td class="type-cell">PEDIDA</td>
        ${pedidaCells}
        <td class="text-center mono total-col">${itemPairs}</td>
      </tr>
      <tr class="row-unit">
        <td class="type-cell">UNITÁRIO</td>
        ${unitarioCells}
        <td class="text-center mono total-col">${formatCurrency(price)}</td>
      </tr>
      <tr class="row-value">
        <td class="type-cell">VALOR</td>
        ${valorCells}
        <td class="text-center mono total-col">${formatCurrency(itemTotal)}</td>
      </tr>`;
  });

  // Calculate averages or just show unit price if it's unique
  const avgUnitPrice = grandTotalPairs > 0 ? grandTotalValue / grandTotalPairs : unitPrice;


  return `
<style>
  .order-container { font-family: 'Segoe UI', Arial, sans-serif; color: #333; }
  .order-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 2px solid #1a56db;
  }
  .order-title { font-size: 18px; font-weight: 800; color: #1a56db; margin: 0; }
  .order-number { font-size: 14px; font-weight: 600; color: #666; }
  .status-badge { 
    padding: 4px 8px; 
    background: #eef2ff; 
    color: #1a56db; 
    border-radius: 4px; 
    font-size: 10px; 
    font-weight: 700;
    text-transform: uppercase;
  }
  
  .info-section {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px 12px;
    margin-bottom: 10px;
    background: #f8fafc;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
  }
  .info-item { display: flex; flex-direction: column; gap: 2px; }
  .info-label { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.5px; }
  .info-value { font-size: 11px; font-weight: 600; color: #1e293b; }

  .order-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 10px; margin-bottom: 8px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
  .order-table th {
    background: #f1f5f9;
    color: #475569;
    font-weight: 700;
    text-align: center;
    padding: 5px 4px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 9px;
    text-transform: uppercase;
  }
  .order-table td {
    padding: 4px 5px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }
  .product-cell { font-weight: 700; color: #1a56db; }
  .type-cell { font-weight: 700; font-size: 8px; color: #64748b; background: #f8fafc; width: 60px; }
  
  .img-cell { width: 70px; text-align: center; padding: 5px; }
  .img-cell img { width: 60px; height: 60px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  
  .row-product td { border-top: 1px solid #e2e8f0; }
  .row-value td { border-bottom: 1px solid #cbd5e1; }
  
  .grand-total-section { margin-top: 0; }
  .grand-total { background: #1e293b !important; color: white !important; font-weight: 700; }
  .grand-total td { border-color: #334155 !important; padding: 5px 4px !important; }
  
  .notes-section {
    margin-top: 10px;
    padding: 8px 10px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
  }
  .notes-title { font-size: 10px; font-weight: 700; color: #64748b; margin-bottom: 5px; text-transform: uppercase; }
  .notes-content { font-size: 11px; color: #334155; line-height: 1.5; }

  .signature-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-top: 20px;
    padding: 0 10px;
  }
  .signature-box {
    text-align: center;
    border-top: 1px solid #94a3b8;
    padding-top: 10px;
  }
  .signature-label { font-size: 9px; color: #64748b; font-weight: 600; }

  .text-center { text-align: center; }
  .text-right { text-align: right; }
  .mono { font-family: 'Courier New', monospace; font-weight: 600; }
</style>

<div class="order-container">
  <div class="order-header">
    <div>
      <h1 class="order-title">PEDIDO DE VENDA</h1>
      <div class="order-number">Nº ${escapeHtml(order.order_number || '')}</div>
    </div>
    <div class="status-badge">
      ${escapeHtml((order.status || '').toUpperCase())}
    </div>
  </div>

  <div class="info-section">
    <div class="info-item">
      <span class="info-label">Cliente</span>
      <span class="info-value">
        ${(order as any).client_number ? `<strong style="color:#1a56db;">[${escapeHtml((order as any).client_number)}]</strong> ` : ''}${escapeHtml(order.client_name)}
      </span>
    </div>
    <div class="info-item">
      <span class="info-label">CNPJ / CPF</span>
      <span class="info-value">${escapeHtml(order.client_cnpj || '—')}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Representante</span>
      <span class="info-value">${escapeHtml(order.representative || '—')}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Ped. Cliente</span>
      <span class="info-value">${escapeHtml(order.client_order_number || '—')}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Condição de Pagamento</span>
      <span class="info-value">${escapeHtml(order.payment_condition || '—')}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Prazo de Entrega</span>
      <span class="info-value">${order.delivery_deadline ? new Date(order.delivery_deadline).toLocaleDateString('pt-BR') : '—'}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Contato</span>
      <span class="info-value">${escapeHtml(order.client_contact || '—')}</span>
    </div>
  </div>

  <table class="order-table">
    <thead>
      <tr>
        <th style="width:70px">Foto</th>
        <th style="text-align:left">Produto / Referência</th>
        <th>Cor</th>
        <th>Tipo</th>
        ${sizes.map(s => `<th>${s}</th>`).join('')}
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="grand-total">
        <td colspan="3" style="text-align:right; padding-right:15px; font-size:11px">TOTAL GERAL DO PEDIDO</td>
        <td class="text-center type-cell" style="background:transparent; color:white">PARES</td>
        ${sizes.map(s => `<td class="text-center mono">${grandTotals[s].pedida || ''}</td>`).join('')}
        <td class="text-center mono">${grandTotalPairs}</td>
      </tr>
      <tr class="grand-total" style="background:#f8fafc !important; color:#1e293b !important">
        <td colspan="4" style="text-align:right; padding-right:15px; border-color:#e2e8f0 !important">VALOR TOTAL (R$)</td>
        ${sizes.map(s => `<td class="text-center mono" style="border-color:#e2e8f0 !important">${grandTotals[s].valor > 0 ? formatCurrency(grandTotals[s].valor) : ''}</td>`).join('')}
        <td class="text-center mono" style="border-color:#e2e8f0 !important">${formatCurrency(grandTotalValue)}</td>
      </tr>
    </tbody>
  </table>

  ${order.notes ? `
    <div class="notes-section">
      <div class="notes-title">Observações Complementares</div>
      <div class="notes-content">${escapeHtml(order.notes)}</div>
    </div>
  ` : ''}

  ${order.commission_value ? `
    <div style="margin-top:10px; text-align:right; font-size:10px; color:#64748b;">
      <strong>Comissão estimada:</strong> R$ ${formatCurrency(Number(order.commission_value))}
    </div>
  ` : ''}

  <div class="signature-grid">
    <div class="signature-box">
      <div class="signature-label">Assinatura do Cliente</div>
    </div>
    <div class="signature-box">
      <div class="signature-label">Assinatura do Vendedor / Representante</div>
    </div>
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
