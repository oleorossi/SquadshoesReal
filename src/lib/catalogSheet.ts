/**
 * Montagem da LÂMINA de catálogo — 100% no navegador via canvas (sem IA,
 * sem custo de API): faixa lateral "COLEÇÃO | ANO", ref., numeração, fotos
 * geradas e nome da cor sob cada foto, no estilo da referência da coleção.
 *
 * Cores hardcoded de propósito: a lâmina é um ARTEFATO DE EXPORTAÇÃO (PNG pra
 * catálogo impresso/WhatsApp), não uma tela do app — mesma regra dos layouts
 * de print (worksheets/etiquetas): previsibilidade visual vence design token.
 * Fontes: 'Anton' (display) e 'Fira Sans' (texto) — ambas já carregadas pelo
 * index.css do app.
 */

export interface CatalogSheetItem {
  imageUrl: string;
  label: string;
}

export interface CatalogSheetSpec {
  brand: string;
  collectionLabel: string;
  collectionYear: string;
  ref: string;
  sizes: string;
  perPage: number;
  bandColor: string;
  items: CatalogSheetItem[];
}

const PAGE_W = 2000;
const PAGE_H = 1414; // proporção A4 paisagem
const BAND_W = 110;
const TEXT_DARK = '#28282a';
const TEXT_GRAY = '#5f5f64';

type Box = { x0: number; y0: number; x1: number; y1: number };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Falha ao carregar imagem: ${url}`));
    img.src = url;
  });
}

/**
 * Retângulos das fotos na área útil. n=3 replica o layout da referência
 * (1 grande à esquerda, 2 empilhadas à direita); demais usam grade.
 */
function layoutBoxes(n: number, area: Box): Box[] {
  const w = area.x1 - area.x0;
  const h = area.y1 - area.y0;
  const pad = 30;

  if (n === 3) {
    const leftW = Math.round(w * 0.48);
    return [
      { x0: area.x0, y0: area.y0 + Math.round(h * 0.18), x1: area.x0 + leftW, y1: area.y0 + Math.round(h * 0.82) },
      { x0: area.x0 + leftW + pad, y0: area.y0, x1: area.x1, y1: area.y0 + Math.floor(h / 2) - Math.floor(pad / 2) },
      { x0: area.x0 + leftW + pad, y0: area.y0 + Math.floor(h / 2) + Math.floor(pad / 2), x1: area.x1, y1: area.y1 },
    ];
  }

  const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cellW = Math.floor((w - pad * (cols - 1)) / cols);
  const cellH = Math.floor((h - pad * (rows - 1)) / rows);

  const boxes: Box[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const rowItems = Math.min(cols, n - r * cols);
    const offset = rowItems < cols
      ? Math.floor((w - (rowItems * cellW + (rowItems - 1) * pad)) / 2)
      : 0;
    const x0 = area.x0 + offset + c * (cellW + pad);
    const y0 = area.y0 + r * (cellH + pad);
    boxes.push({ x0, y0, x1: x0 + cellW, y1: y0 + cellH });
  }
  return boxes;
}

function drawFrame(ctx: CanvasRenderingContext2D, spec: CatalogSheetSpec): void {
  // Faixa lateral esquerda
  ctx.fillStyle = spec.bandColor;
  ctx.fillRect(0, 0, BAND_W, PAGE_H);

  const bandText = `${spec.collectionLabel}  |  ${spec.collectionYear}`.toUpperCase();
  ctx.save();
  ctx.translate(BAND_W / 2, PAGE_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = "44px 'Anton', Impact, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(bandText, 0, 0);
  ctx.restore();

  // Cabeçalho direito
  ctx.textBaseline = 'alphabetic';
  if (spec.sizes) {
    ctx.fillStyle = TEXT_GRAY;
    ctx.font = "30px 'Fira Sans', sans-serif";
    ctx.textAlign = 'right';
    ctx.fillText(spec.sizes, PAGE_W - 70, 80);
  }
  if (spec.ref) {
    ctx.fillStyle = TEXT_DARK;
    ctx.font = "46px 'Anton', Impact, sans-serif";
    ctx.textAlign = 'right';
    ctx.fillText(`ref.: ${spec.ref}`, PAGE_W - 70, 135);
  }

  // Marca no rodapé
  ctx.fillStyle = spec.bandColor;
  ctx.font = "54px 'Anton', Impact, sans-serif";
  ctx.textAlign = 'left';
  ctx.fillText(spec.brand, BAND_W + 50, PAGE_H - 60);
}

async function drawItem(
  ctx: CanvasRenderingContext2D,
  item: CatalogSheetItem,
  box: Box,
): Promise<void> {
  const labelH = 64;
  const slotW = box.x1 - box.x0;
  const slotH = box.y1 - box.y0 - labelH;

  const img = await loadImage(item.imageUrl);
  const scale = Math.min(slotW / img.width, slotH / img.height);
  const dw = Math.max(1, Math.round(img.width * scale));
  const dh = Math.max(1, Math.round(img.height * scale));
  const dx = box.x0 + Math.floor((slotW - dw) / 2);
  const dy = box.y0 + Math.floor((slotH - dh) / 2);
  ctx.drawImage(img, dx, dy, dw, dh);

  ctx.fillStyle = TEXT_DARK;
  ctx.font = "34px 'Fira Sans', sans-serif";
  ctx.textAlign = 'center';
  ctx.fillText(item.label, box.x0 + slotW / 2, box.y0 + slotH + 44);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao exportar PNG.'))),
      'image/png',
    );
  });
}

/**
 * Gera as páginas da lâmina (1 Blob PNG por página, 2000×1414), dividindo
 * `spec.items` em blocos de `spec.perPage` (1 a 6).
 */
export async function buildCatalogSheets(spec: CatalogSheetSpec): Promise<Blob[]> {
  if (!spec.items.length) throw new Error('Nenhuma foto selecionada pra lâmina.');
  const perPage = Math.max(1, Math.min(6, Math.floor(spec.perPage) || 3));

  // Garante que as fontes de display estejam prontas antes de desenhar.
  try {
    await Promise.all([
      document.fonts.load("44px 'Anton'"),
      document.fonts.load("34px 'Fira Sans'"),
    ]);
  } catch {
    // fallback silencioso — canvas usa a família substituta
  }

  const chunks: CatalogSheetItem[][] = [];
  for (let i = 0; i < spec.items.length; i += perPage) {
    chunks.push(spec.items.slice(i, i + perPage));
  }

  const blobs: Blob[] = [];
  for (const chunk of chunks) {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível neste navegador.');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    drawFrame(ctx, spec);

    const area: Box = { x0: BAND_W + 90, y0: 200, x1: PAGE_W - 90, y1: PAGE_H - 160 };
    const boxes = layoutBoxes(chunk.length, area);
    for (let i = 0; i < chunk.length; i++) {
      await drawItem(ctx, chunk[i], boxes[i]);
    }

    blobs.push(await canvasToBlob(canvas));
  }
  return blobs;
}
