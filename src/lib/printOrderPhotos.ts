import { getSignedUrl } from '@/lib/getSignedUrl';
import { escapeHtml, safeUrlAttr } from '@/lib/htmlUtils';
import { openPrintTab, printHtmlAsPdf } from '@/lib/printPdf';

/**
 * Catálogo de fotos do PV — o PDF que sai do botão GERAR PDF dentro de Fotos.
 *
 * Não é o "Gerar Pedido (PDF)" (grade, preços, assinatura). Aqui só as fotos
 * das fichas técnicas / variantes de cor, uma por item, agrupadas por referência.
 *
 * Caminho: HTML com URLs assinadas → POST /api/render-pdf (Chromium no servidor).
 * Fotos vão por URL, não em base64, pra caber no teto de 4MB do documento.
 */

export type OrderPhotoItem = {
  id: string;
  color?: string | null;
  quantity?: number | null;
  reference_id?: string | null;
  variant_image_url?: string | null;
  technical_sheets?: {
    name?: string | null;
    code?: string | null;
    image_url?: string | null;
    images?: unknown;
  } | null;
};

export type OrderPhoto = {
  id: string;
  src: string;
  refCode: string;
  refName: string;
  color: string;
  quantity: number;
};

export type OrderPhotoGroup = {
  key: string;
  refCode: string;
  refName: string;
  items: OrderPhoto[];
};

function firstSheetImage(images: unknown): string {
  if (!Array.isArray(images) || images.length === 0) return '';
  const first = images[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof (first as { url?: unknown }).url === 'string') {
    return (first as { url: string }).url;
  }
  return '';
}

/** Mesma prioridade da lista do PV: variante de cor → images[0] da ficha → image_url. */
export function resolveOrderItemPhoto(item: OrderPhotoItem): string {
  if (item.variant_image_url) return item.variant_image_url;
  const fromSheet = firstSheetImage(item.technical_sheets?.images);
  if (fromSheet) return fromSheet;
  return item.technical_sheets?.image_url || '';
}

export function collectOrderPhotos(items: OrderPhotoItem[]): OrderPhoto[] {
  return items.map((item) => {
    const refName = item.technical_sheets?.name || '';
    const refCode = item.technical_sheets?.code || '';
    return {
      id: item.id,
      src: resolveOrderItemPhoto(item),
      refCode: refCode || refName || '—',
      refName: refName || refCode || '—',
      color: item.color || '—',
      quantity: Number(item.quantity) || 0,
    };
  });
}

export function groupOrderPhotos(photos: OrderPhoto[]): OrderPhotoGroup[] {
  const map = new Map<string, OrderPhotoGroup>();
  const order: string[] = [];
  for (const photo of photos) {
    const key = `${photo.refName}||${photo.refCode}`.toLowerCase();
    let group = map.get(key);
    if (!group) {
      group = { key, refCode: photo.refCode, refName: photo.refName, items: [] };
      map.set(key, group);
      order.push(key);
    }
    group.items.push(photo);
  }
  return order.map((k) => map.get(k)!);
}

export function buildOrderPhotosPrintHtml(opts: {
  orderNumber: string;
  clientName?: string;
  photos: OrderPhoto[];
}): string {
  const groups = groupOrderPhotos(opts.photos);
  const withPhoto = opts.photos.filter((p) => p.src).length;
  const pairs = opts.photos.reduce((s, p) => s + p.quantity, 0);
  const stamp = new Date().toLocaleString('pt-BR');
  const title = `Fotos ${opts.orderNumber || ''}`.trim();

  const groupsHtml = groups.map((g) => {
    const showName = g.refName && g.refName !== g.refCode;
    const cards = g.items.map((p) => {
      const img = p.src
        ? `<img src="${safeUrlAttr(p.src)}" alt="${escapeHtml(`${p.refCode} ${p.color}`)}" />`
        : `<div class="empty">sem<br>foto</div>`;
      return `<figure class="card">
        ${img}
        <figcaption>
          <span class="color">${escapeHtml(p.color)}</span>
          <span class="qty">${p.quantity} pares</span>
        </figcaption>
      </figure>`;
    }).join('');
    return `<section class="ref">
      <h2><span class="code">${escapeHtml(g.refCode)}</span>${showName ? ` <span class="name">${escapeHtml(g.refName)}</span>` : ''} <em>${g.items.length} ${g.items.length === 1 ? 'cor' : 'cores'}</em></h2>
      <div class="grid">${cards}</div>
    </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter Tight', system-ui, sans-serif;
    color: #15171a;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-size: 11px;
  }
  .top {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 10px;
    border-bottom: 2.5px solid #15171a;
    margin-bottom: 14px;
  }
  .brand { font-family: 'Anton', Impact, sans-serif; font-size: 22px; letter-spacing: 0.02em; text-transform: uppercase; line-height: 1; }
  .kind { font-size: 9px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #6b7280; margin-bottom: 2px; }
  .pv { font-family: 'Anton', Impact, sans-serif; font-size: 28px; line-height: 0.9; }
  .meta { text-align: right; font-size: 10.5px; color: #6b7280; }
  .meta strong { color: #15171a; font-weight: 700; }
  .ref { margin-bottom: 16px; break-inside: avoid; }
  .ref h2 {
    font-size: 13px;
    font-weight: 800;
    margin: 0 0 8px;
    display: flex;
    align-items: baseline;
    gap: 8px;
    page-break-after: avoid;
  }
  .ref h2 .code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 14px; }
  .ref h2 .name { font-weight: 500; color: #6b7280; }
  .ref h2 em { font-style: normal; font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; margin-left: auto; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .card {
    border: 1.5px solid #d7dade;
    border-radius: 5px;
    overflow: hidden;
    background: #fff;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .card img, .card .empty {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    display: block;
    background: #f4f5f7;
  }
  .card .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9ca3af;
    line-height: 1.2;
  }
  figcaption {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 8px 7px;
    border-top: 1px solid #e5e7eb;
  }
  figcaption .color { font-weight: 700; font-size: 11px; }
  figcaption .qty { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9.5px; color: #6b7280; }
  .foot {
    margin-top: 16px;
    padding-top: 8px;
    border-top: 1px solid #d7dade;
    display: flex;
    justify-content: space-between;
    font-size: 8.5px;
    color: #6b7280;
    letter-spacing: 0.04em;
  }
  @media print {
    .ref { break-inside: auto; }
    .card { break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="top">
    <div>
      <div class="kind">Squad Shoes · Fichas técnicas</div>
      <div class="brand">Fotos do pedido</div>
    </div>
    <div class="meta">
      <div class="pv">${escapeHtml(opts.orderNumber || '—')}</div>
      ${opts.clientName ? `<div>${escapeHtml(opts.clientName)}</div>` : ''}
      <div><strong>${groups.length}</strong> ${groups.length === 1 ? 'referência' : 'referências'} · <strong>${opts.photos.length}</strong> ${opts.photos.length === 1 ? 'cor' : 'cores'} · <strong>${pairs}</strong> pares · ${withPhoto} foto${withPhoto === 1 ? '' : 's'}</div>
    </div>
  </div>
  ${groupsHtml || '<p>Pedido sem itens.</p>'}
  <div class="foot">
    <span>Squad Shoes · Fotos ${escapeHtml(opts.orderNumber || '')}</span>
    <span>Gerado em ${escapeHtml(stamp)}</span>
  </div>
</body>
</html>`;
}

/**
 * Assina as URLs e manda o HTML pro Chromium do servidor.
 * `target` TEM que ser a aba aberta no clique (openPrintTab), senão o celular
 * bloqueia o pop-up.
 */
export async function printOrderPhotosPdf(opts: {
  orderNumber: string;
  clientName?: string;
  items: OrderPhotoItem[];
  target?: Window | null;
}): Promise<boolean> {
  const photos = collectOrderPhotos(opts.items);
  const unique = [...new Set(photos.map((p) => p.src).filter(Boolean))];
  const signed = new Map<string, string>();
  await Promise.all(unique.map(async (url) => {
    signed.set(url, await getSignedUrl(url));
  }));
  const resolved = photos.map((p) => ({ ...p, src: p.src ? (signed.get(p.src) || p.src) : '' }));
  const html = buildOrderPhotosPrintHtml({
    orderNumber: opts.orderNumber,
    clientName: opts.clientName,
    photos: resolved,
  });
  const filename = `fotos-${String(opts.orderNumber || 'pedido').replace(/[^\w.-]+/g, '-')}`;
  return printHtmlAsPdf(html, {
    filename,
    landscape: true,
    target: opts.target ?? null,
  });
}

export { openPrintTab };
