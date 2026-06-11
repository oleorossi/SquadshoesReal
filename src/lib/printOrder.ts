import { getSignedUrl } from '@/lib/getSignedUrl';
import { escapeHtml } from './htmlUtils';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';
import { supabase } from '@/integrations/supabase/client';
import logoSquad from '@/assets/logo-squad-shoes.jpg';

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

// ── Helpers de formatação BR (CNPJ/CPF, CEP, telefone) ──
function fmtDoc(doc?: string | null): string {
  if (!doc) return '';
  const d = String(doc).replace(/\D/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return String(doc);
}
function fmtCep(cep?: string | null): string {
  if (!cep) return '';
  const d = String(cep).replace(/\D/g, '');
  if (d.length === 8) return d.replace(/^(\d{5})(\d{3})$/, '$1-$2');
  return String(cep);
}
function fmtPhone(tel?: string | null): string {
  if (!tel) return '';
  const d = String(tel).replace(/\D/g, '');
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return String(tel);
}

/**
 * Busca os dados complementares (itens, imagens de cor, cliente completo e
 * identidade da empresa) e abre o preview de impressão do PV.
 *
 * Centraliza o fetch que antes estava DUPLICADO inline em 2 botões da
 * página de pedidos. Assim o PDF sempre recebe bloco do cliente completo
 * (razão/CNPJ/IE/endereço/contato) e o cabeçalho da Squad Shoes
 * (logo + CNPJ + endereço) — antes o `order` cru não trazia nada disso.
 */
export async function fetchCompanySettings(): Promise<any> {
  const { data } = await (supabase as any)
    .from('company_settings').select('*').eq('is_default', true).maybeSingle();
  return data || null;
}

/**
 * Monta o HTML do PV já com os dados complementares (itens, imagens de cor,
 * cliente completo). `company` pode ser pré-buscado (impressão em lote busca
 * 1×) ou omitido (busca aqui).
 */
export async function buildSaleOrderHtmlWithData(order: any, company?: any): Promise<string> {
  const db = supabase as any;
  const co = company !== undefined ? company : await fetchCompanySettings();
  const { data: itemsData } = await db
    .from('sale_order_items')
    .select('*, technical_sheets(name, code, image_url, images)')
    .eq('sale_order_id', order.id);
  const items = (itemsData || []) as any[];
  const refIds = [...new Set(items.map((i) => i.reference_id).filter(Boolean))];
  const [variantsRes, clientRes] = await Promise.all([
    refIds.length
      ? db.from('reference_color_variants').select('reference_id, color, image_url').in('reference_id', refIds)
      : Promise.resolve({ data: [] as any[] }),
    order.client_id
      ? db.from('clients').select('*').eq('id', order.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return buildSaleOrderPrintHtml(order, items, variantsRes.data || [], {
    company: co,
    client: clientRes.data || null,
  });
}

export async function printSaleOrderPdf(order: any): Promise<void> {
  const html = await buildSaleOrderHtmlWithData(order);
  printHtml(`PV ${order.order_number}`, html);
}

export async function buildSaleOrderPrintHtml(
  order: any,
  items: any[],
  colorVariants: any[] = [],
  opts: { company?: any; client?: any } = {},
) {
  const money = (v: number) =>
    'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);

  // ── Resolve imagens p/ signed URLs (storage privado) ──
  const getItemImage = (item: any): string | null => {
    const color = item.color || '';
    const refId = item.reference_id;
    if (color && colorVariants.length > 0) {
      const v = colorVariants.find((cv: any) => cv.reference_id === refId && cv.color?.toLowerCase() === color.toLowerCase() && cv.image_url);
      if (v?.image_url) return v.image_url;
    }
    const images = item.technical_sheets?.images;
    if (Array.isArray(images) && images.length > 0) {
      const first = images[0];
      if (typeof first === 'string') return first;
      if (first?.url) return first.url;
    }
    if (item.technical_sheets?.image_url) return item.technical_sheets.image_url;
    if (colorVariants.length > 0) {
      const any = colorVariants.find((cv: any) => cv.reference_id === refId && cv.image_url);
      if (any?.image_url) return any.image_url;
    }
    return null;
  };
  const imageUrlMap = new Map<string, string>();
  const rawUrls = [...new Set(items.map(getItemImage).filter(Boolean) as string[])];
  await Promise.all(rawUrls.map(async (url) => { imageUrlMap.set(url, await getSignedUrl(url)); }));
  const resolveUrl = (url: string | null) => (url ? imageUrlMap.get(url) || url : null);

  const sizeKey = (s: string) => parseInt(String(s).split('/')[0], 10) || 0;

  // ── AGRUPAMENTO POR REFERÊNCIA ──
  // Cada referência (code+name) vira um bloco; as cores são sub-linhas da
  // grade. `item.grade` no banco é a grade BASE (1 ficha ~12 pares); escala
  // p/ a qtd real (`item.quantity`) com largest-remainder pra a soma por
  // numeração bater EXATAMENTE com o pedido — igual à tela do PV e à OP.
  type ColorRow = { color: string; grade: Record<string, number>; pairs: number; unit: number; total: number };
  type RefGroup = { key: string; code: string; name: string; image: string | null; sizes: Set<string>; rows: ColorRow[]; pairs: number; value: number };
  const groupsMap = new Map<string, RefGroup>();
  const groupOrder: string[] = [];

  for (const item of items) {
    const baseGrade = item.grade as Record<string, number> | null;
    const baseSum = baseGrade
      ? Object.entries(baseGrade).reduce((s, [k, v]) => (k.startsWith('_') ? s : s + (Number(v) || 0)), 0)
      : 0;
    const realQty = Number(item.quantity) || 0;
    const grade = baseSum > 0 && realQty > 0
      ? scaleGradeWithLargestRemainder(baseGrade, realQty / baseSum, realQty)
      : (baseGrade || {});
    const code = item.technical_sheets?.code || '';
    const name = item.technical_sheets?.name || '';
    const key = `${code}||${name}||${item.reference_id || ''}`.toLowerCase();
    const unit = Number(item.unit_price) || 0;
    let pairs = 0;
    Object.entries(grade).forEach(([k, v]) => { if (!k.startsWith('_')) pairs += Number(v) || 0; });
    const total = pairs * unit;
    const image = resolveUrl(getItemImage(item));

    let g = groupsMap.get(key);
    if (!g) {
      g = { key, code, name, image, sizes: new Set(), rows: [], pairs: 0, value: 0 };
      groupsMap.set(key, g);
      groupOrder.push(key);
    }
    if (!g.image && image) g.image = image;
    Object.keys(grade).forEach((s) => { if (!s.startsWith('_')) g!.sizes.add(s); });
    g.rows.push({ color: item.color || '—', grade, pairs, unit, total });
    g.pairs += pairs;
    g.value += total;
  }

  const groups = groupOrder.map((k) => groupsMap.get(k)!);
  groups.sort((a, b) => `${a.code} ${a.name}`.trim().localeCompare(`${b.code} ${b.name}`.trim(), 'pt-BR', { numeric: true }));
  groups.forEach((g) => g.rows.sort((a, b) => a.color.localeCompare(b.color, 'pt-BR')));

  const grandPairs = groups.reduce((s, g) => s + g.pairs, 0);
  const subtotal = groups.reduce((s, g) => s + g.value, 0);
  const refsCount = groups.length;
  const freight = Number(order.valor_frete || 0) || (Number(order.shipping_rate_per_pair || 0) * grandPairs);
  // `sale_orders.total` é só MERCADORIA (Σ itens, == subtotal); o frete mora
  // em `valor_frete` (useSaleOrders: "NF-e e financeiro usam valor_frete +
  // total"). Logo Total geral = mercadoria + frete. Descontos já estão
  // embutidos no unit_price (tabela de preço do cliente) → sem linha separada.
  const totalGeral = subtotal + freight;
  const avgUnit = grandPairs > 0 ? subtotal / grandPairs : 0;

  // ── Render dos blocos de referência ──
  let refBlocks = '';
  for (const g of groups) {
    const gsizes = Array.from(g.sizes).sort((a, b) => sizeKey(a) - sizeKey(b));
    const showName = g.name && g.name !== g.code;
    const head = `
      <div class="ref-head">
        ${g.image ? `<img class="ref-photo" src="${g.image}" alt="${escapeHtml(g.code)}" />` : `<div class="ref-photo empty">sem<br>foto</div>`}
        <div class="ref-id">
          <span class="ref-code">${escapeHtml(g.code || g.name || '—')}</span>
          ${showName ? `<span class="ref-name">${escapeHtml(g.name)}</span>` : ''}
        </div>
        <div class="ref-kpi">
          <span class="ref-kpi-pairs">${g.pairs}<em>pares</em></span>
          <span class="ref-kpi-val">${money(g.value)}</span>
        </div>
      </div>`;

    const colHead = gsizes.map((s) => `<th>${escapeHtml(s)}</th>`).join('');
    let rowsHtml = '';
    for (const r of g.rows) {
      const cells = gsizes.map((s) => {
        const q = Number(r.grade?.[s] || 0);
        return `<td class="size${q ? '' : ' empty'}">${q || '·'}</td>`;
      }).join('');
      rowsHtml += `
        <tr>
          <td class="color">${escapeHtml(r.color)}</td>
          ${cells}
          <td class="pairs">${r.pairs}</td>
          <td class="unit">${money(r.unit)}</td>
          <td class="total">${money(r.total)}</td>
        </tr>`;
    }
    const subCells = gsizes.map((s) => {
      const q = g.rows.reduce((acc, r) => acc + Number(r.grade?.[s] || 0), 0);
      return `<td class="size">${q || '·'}</td>`;
    }).join('');
    const subRow = g.rows.length > 1 ? `
        <tr class="ref-sub">
          <td class="color">Subtotal ref.</td>
          ${subCells}
          <td class="pairs">${g.pairs}</td>
          <td class="unit"></td>
          <td class="total">${money(g.value)}</td>
        </tr>` : '';

    refBlocks += `
      <div class="ref-block keep-together">
        ${head}
        <table class="ref-grade">
          <thead>
            <tr>
              <th class="color">Cor</th>
              ${colHead}
              <th class="pairs">Pares</th>
              <th class="unit">Unit.</th>
              <th class="total">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            ${subRow}
          </tbody>
        </table>
      </div>`;
  }
  if (groups.length === 0) {
    refBlocks = `<div class="pv-empty">Pedido sem itens cadastrados.</div>`;
  }

  // ── Identidade da empresa (company_settings) ──
  const co = opts.company || {};
  const coName = co.nome_fantasia || co.razao_social || 'Squad Shoes';
  const coRazao = co.razao_social && co.razao_social !== coName ? co.razao_social : '';
  const coDoc = fmtDoc(co.cnpj || co.cpf);
  const coAddrLine = [co.endereco, [co.cidade, co.uf].filter(Boolean).join('/'), fmtCep(co.cep) ? `CEP ${fmtCep(co.cep)}` : ''].filter(Boolean).join(' · ');
  const coContact = [fmtPhone(co.telefone), co.email].filter(Boolean).join(' · ');

  // ── Cliente (clients row OU fallback p/ campos do pedido) ──
  const cl = opts.client || {};
  const clName = cl.razao_social || order.client_name || '—';
  const clFantasia = cl.nome_fantasia && cl.nome_fantasia !== clName ? cl.nome_fantasia : '';
  const clDoc = fmtDoc(cl.cnpj || order.client_cnpj);
  const clIe = cl.inscricao_estadual || '';
  const clAddr = [
    [cl.endereco, cl.numero].filter(Boolean).join(', '),
    cl.complemento,
    cl.bairro,
    [cl.cidade, cl.estado].filter(Boolean).join('/'),
    fmtCep(cl.cep) ? `CEP ${fmtCep(cl.cep)}` : '',
  ].filter(Boolean).join(' · ');
  const clContact = [cl.contato, fmtPhone(cl.telefone || order.client_contact), cl.email].filter(Boolean).join(' · ');
  const clNumber = cl.client_number || (order as any).client_number || '';

  // ── Status (accent semântico só no dot) ──
  const statusDot: Record<string, string> = {
    'Rascunho': '#a1a1aa', 'Pendente': '#f59e0b', 'Aprovado': '#0a7b2c', 'Em Produção': '#3b82f6',
    'Pronto': '#0a7b2c', 'Faturado': '#0a7b2c', 'Expedido': '#0a7b2c', 'Concluído': '#0a7b2c',
    'Finalizado s/ NF': '#a1a1aa', 'Cancelado': '#D9264E',
  };
  const dotColor = statusDot[order.status] || '#71717a';

  const issuedDate = order.created_at
    ? new Date(order.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const deadline = order.delivery_deadline ? new Date(order.delivery_deadline + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
  const genStamp = new Date().toLocaleString('pt-BR');

  const clientRow = (lbl: string, val: string) => val
    ? `<div class="kv"><span class="k">${lbl}</span><span class="v">${escapeHtml(val)}</span></div>` : '';

  return `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

  .pv-doc {
    --ink: #15171a; --muted: #6b7280; --line: #d7dade; --line-strong: #15171a;
    --red: #D9264E; --paper: #ffffff; --soft: #f4f5f7;
    font-family: 'Inter Tight', system-ui, -apple-system, Arial, sans-serif;
    color: var(--ink); font-size: 11px; line-height: 1.45; background: var(--paper);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pv-doc * { box-sizing: border-box; }
  .pv-doc .mono { font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace; font-variant-numeric: tabular-nums; }

  /* ── Topo: marca (logo + identidade) | documento ── */
  .pv-top { display: grid; grid-template-columns: 1fr auto; align-items: flex-start; gap: 20px; padding-bottom: 12px; border-bottom: 2.5px solid var(--line-strong); }
  .pv-brand { display: flex; align-items: flex-start; gap: 12px; }
  .pv-logo { height: 38px; width: auto; object-fit: contain; margin-top: 1px; }
  .pv-brand-name { font-family: 'Anton', Impact, sans-serif; font-size: 20px; letter-spacing: 0.01em; text-transform: uppercase; line-height: 1; }
  .pv-brand-sub { font-size: 10px; font-weight: 600; color: var(--ink); margin-top: 2px; }
  .pv-brand-meta { display: flex; flex-direction: column; gap: 1px; margin-top: 4px; }
  .pv-brand-meta span { font-size: 9px; color: var(--muted); line-height: 1.35; }
  .pv-doc-id { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .pv-doc-kind { font-size: 9px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
  .pv-doc-num { font-family: 'Anton', Impact, sans-serif; font-size: 30px; line-height: 0.9; letter-spacing: 0.005em; }
  .pv-doc-status { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border: 1.5px solid var(--line-strong); border-radius: 3px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .pv-doc-status .dot { width: 7px; height: 7px; border-radius: 50%; background: ${dotColor}; }

  /* ── Cartões: Cliente | Pedido ── */
  .pv-meta { display: grid; grid-template-columns: 1.5fr 1fr; gap: 14px; margin: 14px 0 16px; }
  .pv-card { border: 1.5px solid var(--line); border-radius: 4px; overflow: hidden; }
  .pv-card__h { background: var(--soft); padding: 5px 10px; font-size: 9px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink); border-bottom: 1.5px solid var(--line); }
  .pv-card__b { padding: 8px 10px; display: flex; flex-direction: column; gap: 3px; }
  .pv-card__b .kv { display: grid; grid-template-columns: 78px 1fr; gap: 8px; align-items: baseline; }
  .pv-card__b .kv .k { font-size: 8.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .pv-card__b .kv .v { font-size: 10.5px; font-weight: 500; color: var(--ink); }
  .pv-card__b .kv .v strong { font-weight: 800; }

  /* ── Título da seção de itens ── */
  .pv-items-h { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid var(--line-strong); padding-bottom: 6px; margin-bottom: 12px; }
  .pv-items-h h2 { font-family: 'Anton', Impact, sans-serif; font-size: 16px; letter-spacing: 0.01em; text-transform: uppercase; margin: 0; }
  .pv-items-h .count { font-size: 9.5px; font-weight: 600; color: var(--muted); }
  .pv-items-h .count b { color: var(--ink); font-weight: 800; }

  /* ── Bloco de referência ── */
  .ref-block { border: 1.5px solid var(--line); border-radius: 5px; overflow: hidden; margin-bottom: 12px; }
  .ref-head { display: flex; align-items: center; gap: 11px; padding: 7px 11px; background: var(--soft); border-bottom: 1.5px solid var(--line); }
  .ref-photo { width: 42px; height: 42px; object-fit: cover; border-radius: 4px; border: 1.5px solid var(--line-strong); background: #fff; flex: none; }
  .ref-photo.empty { display: flex; align-items: center; justify-content: center; text-align: center; font-size: 7px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); line-height: 1.1; }
  .ref-id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .ref-code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; font-weight: 700; letter-spacing: 0.01em; }
  .ref-name { font-size: 10px; color: var(--muted); font-weight: 500; }
  .ref-kpi { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; flex: none; }
  .ref-kpi-pairs { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; font-weight: 700; }
  .ref-kpi-pairs em { font-style: normal; font-size: 8.5px; font-weight: 600; color: var(--muted); margin-left: 3px; text-transform: uppercase; letter-spacing: 0.08em; }
  .ref-kpi-val { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 700; color: var(--red); }

  .ref-grade { width: 100%; border-collapse: collapse; }
  .ref-grade thead th { background: var(--ink); color: #fff; font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 600; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; padding: 5px 3px; text-align: center; }
  .ref-grade thead th.color { text-align: left; padding-left: 11px; width: 96px; }
  .ref-grade thead th.pairs, .ref-grade thead th.unit, .ref-grade thead th.total { width: 62px; }
  .ref-grade tbody td { border-top: 1px solid var(--line); padding: 5px 3px; text-align: center; font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; font-size: 10.5px; }
  .ref-grade tbody td.color { text-align: left; padding-left: 11px; font-family: 'Inter Tight', sans-serif; font-weight: 600; font-size: 10.5px; }
  .ref-grade tbody td.size { color: var(--ink); font-weight: 600; }
  .ref-grade tbody td.size.empty { color: #c4c8ce; font-weight: 400; }
  .ref-grade tbody td.pairs { font-weight: 800; background: var(--soft); }
  .ref-grade tbody td.unit { color: var(--muted); font-size: 9.5px; }
  .ref-grade tbody td.total { font-weight: 700; color: var(--ink); }
  .ref-grade tbody tr.ref-sub td { background: #eef0f3; font-weight: 800; border-top: 1.5px solid var(--line-strong); }
  .ref-grade tbody tr.ref-sub td.color { text-transform: uppercase; font-size: 8.5px; letter-spacing: 0.08em; color: var(--muted); }
  .ref-grade tbody tr.ref-sub td.total { color: var(--red); }

  .pv-empty { padding: 24px; text-align: center; color: var(--muted); font-style: italic; border: 1.5px dashed var(--line); border-radius: 5px; }

  /* ── Resumo: observações | totais ── */
  .pv-summary { display: grid; grid-template-columns: 1.5fr 1fr; gap: 14px; margin-top: 4px; page-break-inside: avoid; }
  .pv-notes { border: 1.5px solid var(--line); border-radius: 4px; padding: 9px 11px; }
  .pv-notes-title { font-size: 9px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink); margin-bottom: 4px; }
  .pv-notes-body { font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; }
  .pv-notes-body.empty { color: var(--muted); font-style: italic; }
  .pv-totals { border: 1.5px solid var(--line-strong); border-radius: 4px; overflow: hidden; align-self: start; }
  .pv-tline { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 5px 12px; border-bottom: 1px solid var(--line); font-size: 10.5px; }
  .pv-tline span { color: var(--muted); font-weight: 600; font-size: 9.5px; letter-spacing: 0.04em; text-transform: uppercase; }
  .pv-tline b { font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 700; font-variant-numeric: tabular-nums; }
  .pv-tline.grand { background: var(--ink); color: #fff; padding: 8px 12px; border-bottom: none; }
  .pv-tline.grand span { color: rgba(255,255,255,0.7); font-weight: 700; }
  .pv-tline.grand b { color: #fff; font-size: 15px; }
  .pv-tline.avg { border-bottom: none; }
  .pv-tline.avg b { color: var(--muted); font-weight: 600; }

  /* ── Assinaturas ── */
  .pv-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 26px; padding: 0 6px; page-break-inside: avoid; }
  .pv-sign__box { text-align: center; border-top: 1.5px solid var(--line-strong); padding-top: 6px; }
  .pv-sign__box .l { font-size: 9px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
  .pv-sign__box .s { font-size: 9px; color: var(--muted); margin-top: 2px; }

  /* ── Rodapé: estático no preview, fixo/repetido na impressão ── */
  .pv-foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 8.5px; color: var(--muted); letter-spacing: 0.04em; }
  .pv-foot .mono { font-size: 8.5px; }

  @media print {
    .pv-foot { position: fixed; left: 0; right: 0; bottom: 0; margin-top: 0; padding: 4px 2mm; background: #fff; border-top: 1px solid var(--line); }
    .pv-doc { padding-bottom: 12mm; }
    .ref-block, .pv-summary, .pv-sign, .pv-card { page-break-inside: avoid; }
    .keep-together { break-inside: avoid; }
  }
</style>

<div class="pv-doc">
  <div class="pv-top">
    <div class="pv-brand">
      <img class="pv-logo" src="${logoSquad}" alt="${escapeHtml(coName)}" onerror="this.style.display='none'" />
      <div class="pv-brand-id">
        <div class="pv-brand-name">${escapeHtml(coName)}</div>
        ${coRazao ? `<div class="pv-brand-sub">${escapeHtml(coRazao)}</div>` : ''}
        <div class="pv-brand-meta">
          ${coDoc ? `<span>CNPJ ${escapeHtml(coDoc)}</span>` : ''}
          ${coAddrLine ? `<span>${escapeHtml(coAddrLine)}</span>` : ''}
          ${coContact ? `<span>${escapeHtml(coContact)}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="pv-doc-id">
      <div class="pv-doc-kind">Pedido de Venda</div>
      <div class="pv-doc-num">${escapeHtml(order.order_number || '—')}</div>
      <div class="pv-doc-status"><span class="dot"></span>${escapeHtml(order.status || '—')}</div>
    </div>
  </div>

  <div class="pv-meta">
    <div class="pv-card">
      <div class="pv-card__h">Cliente</div>
      <div class="pv-card__b">
        <div class="kv"><span class="k">Razão</span><span class="v">${clNumber ? `<strong>#${escapeHtml(clNumber)}</strong> · ` : ''}<strong>${escapeHtml(clName)}</strong></span></div>
        ${clientRow('Fantasia', clFantasia)}
        <div class="kv"><span class="k">CNPJ/CPF</span><span class="v mono">${escapeHtml(clDoc || '—')}</span></div>
        ${clientRow('Insc. Est.', clIe)}
        ${clientRow('Endereço', clAddr)}
        ${clientRow('Contato', clContact)}
      </div>
    </div>
    <div class="pv-card">
      <div class="pv-card__h">Pedido</div>
      <div class="pv-card__b">
        <div class="kv"><span class="k">Emitido</span><span class="v mono">${issuedDate}</span></div>
        <div class="kv"><span class="k">Prazo</span><span class="v mono"><strong>${deadline}</strong></span></div>
        <div class="kv"><span class="k">Vendedor</span><span class="v">${escapeHtml(order.representative || '—')}</span></div>
        <div class="kv"><span class="k">Pagamento</span><span class="v">${escapeHtml(order.payment_condition || '—')}</span></div>
        ${order.client_order_number ? `<div class="kv"><span class="k">Ped. cliente</span><span class="v mono">${escapeHtml(order.client_order_number)}</span></div>` : ''}
        ${order.nfe ? `<div class="kv"><span class="k">NF-e</span><span class="v mono">${escapeHtml(order.nfe)}</span></div>` : ''}
      </div>
    </div>
  </div>

  <div class="pv-items-h">
    <h2>Itens do Pedido</h2>
    <span class="count"><b>${refsCount}</b> ${refsCount === 1 ? 'referência' : 'referências'} · <b>${grandPairs}</b> pares · <b>${money(subtotal)}</b></span>
  </div>

  ${refBlocks}

  <div class="pv-summary">
    <div class="pv-notes">
      <div class="pv-notes-title">Observações</div>
      <div class="pv-notes-body${order.notes ? '' : ' empty'}">${order.notes ? escapeHtml(order.notes) : 'Nenhuma observação adicional.'}</div>
      ${order.informacoes_complementares_nf ? `<div class="pv-notes-title" style="margin-top:8px">Informações complementares (NF)</div><div class="pv-notes-body">${escapeHtml(order.informacoes_complementares_nf)}</div>` : ''}
    </div>
    <div class="pv-totals">
      <div class="pv-tline"><span>Referências</span><b>${refsCount}</b></div>
      <div class="pv-tline"><span>Total de pares</span><b>${grandPairs}</b></div>
      <div class="pv-tline"><span>Subtotal itens</span><b>${money(subtotal)}</b></div>
      <div class="pv-tline"><span>Frete</span><b>${money(freight)}</b></div>
      <div class="pv-tline grand"><span>Total geral</span><b>${money(totalGeral)}</b></div>
      <div class="pv-tline avg"><span>Médio / par</span><b>${money(avgUnit)}</b></div>
    </div>
  </div>

  <div class="pv-sign">
    <div class="pv-sign__box"><div class="l">Cliente</div><div class="s">${escapeHtml(clName)}</div></div>
    <div class="pv-sign__box"><div class="l">Vendedor / Representante</div><div class="s">${escapeHtml(order.representative || '—')}</div></div>
  </div>

  <div class="pv-foot">
    <span>${escapeHtml(coName)} · Pedido de Venda ${escapeHtml(order.order_number || '')}</span>
    <span class="mono">Gerado em ${genStamp}</span>
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
