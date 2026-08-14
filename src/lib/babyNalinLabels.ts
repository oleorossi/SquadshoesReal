/**
 * Etiqueta de caixa do cliente — arte 46 × 38 mm em rolo térmico 50 × 40 mm.
 *
 * Padrão fixo do cliente, validado contra a etiqueta física do fornecedor e
 * contra o documento "Padrão de Etiquetagem". As medidas em `LAYOUT` NÃO são
 * ajustáveis: mudar qualquer uma gera etiqueta rejeitada no recebimento.
 * Milhares de pares são etiquetados por pedido — erro aqui custa caro.
 *
 * Entrada: o arquivo de exportação do pedido de compra do ERP do cliente
 * (`Exp_Etiquetas_PedCompra_*.csv`, `;` em UTF-16/UTF-8/CP1252, ou XLSX).
 * Saída: um PDF no tamanho exato do rolo, uma etiqueta por página.
 */
import { code128Bars, encodeCode128 } from './code128';

/* ─────────────────────── medidas oficiais (mm) ─────────────────────── */

/** Arte da etiqueta — o desenho em si. */
export const ART_WIDTH_MM = 46.0;
export const ART_HEIGHT_MM = 38.0;

/** Mídia física: o rolo comprado é 50 × 40; a arte fica centralizada nela. */
export const MEDIA_WIDTH_MM = 50.0;
export const MEDIA_HEIGHT_MM = 40.0;
export const OFFSET_X_MM = (MEDIA_WIDTH_MM - ART_WIDTH_MM) / 2; // 2,0
export const OFFSET_Y_MM = (MEDIA_HEIGHT_MM - ART_HEIGHT_MM) / 2; // 1,0

/**
 * Módulo do CODE128 definido pelo padrão do cliente: 7 dots a 600 dpi.
 *
 * A cabeça imprime em grade de dots; módulo que não é múltiplo inteiro de dot
 * sai com barras de larguras desiguais. Com 13 dígitos (123 módulos) o 2 dots
 * é o ÚNICO valor viável: 1 dot dá 0,125 mm — abaixo do que leitor de loja lê —
 * O desenho técnico entregue pelo cliente especifica 0,296 mm por módulo;
 * manter esse valor evita que a leitura do código varie entre lotes.
 */
export const PRINTER_DPI = 600;
export const DOT_MM = 25.4 / PRINTER_DPI; // 0,0423 mm
export const MODULE_DOTS = 7;
export const MODULE_MM = 0.296;

/** Mínimo em branco de cada lado do código. Nada pode invadir essa faixa. */
export const QUIET_ZONE_MIN_MM = 3.1;

/** Posições ancoradas no topo-esquerdo da ARTE (não da mídia). */
export const LAYOUT = {
  logo: { x: 2.5, y: 2.0, box: 10.5 },
  textX: 15.0,
  /** "TAM {tamanho}", cor, "Ref: {referencia}" — topo de cada linha. */
  textLinesY: [3.0, 7.4, 11.8] as const,
  textPt: 10,
  productCode: { x: 2.5, y: 17.4, pt: 14 },
  barcode: { topY: 25.5, heightMm: 5.0 },
  /** Margem direita usada pra decidir se o texto precisa encolher. */
  rightMarginMm: 2.0,
} as const;

/* ─────────────────────────── leitura do arquivo ─────────────────────────── */

export interface BabyNalinRow {
  tamanho: string;
  cor: string;
  referencia: string;
  codProduto: string;
  codigoBarra: string;
  /** `Qt. Solicitada` do pedido, quando o arquivo traz. Usado só se pedir cópias. */
  quantidade: number;
}

/** Cabeçalho do ERP vem com acento e ponto ("Cod. Produto"); comparamos sem eles. */
function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const COLUMN_ALIASES: Record<keyof Omit<BabyNalinRow, 'quantidade'> | 'quantidade', string[]> = {
  tamanho: ['tamanho', 'tam'],
  cor: ['cor'],
  referencia: ['referencia', 'ref'],
  codProduto: ['cod produto', 'codigo produto', 'cod prod'],
  codigoBarra: ['codigo barra', 'codigo de barra', 'codigo barras', 'ean'],
  quantidade: ['qt solicitada', 'qtd solicitada', 'quantidade', 'qt', 'qtde'],
};

/**
 * Decodifica os bytes do arquivo. O ERP costuma exportar UTF-16 com BOM, mas
 * já apareceu UTF-8 e CP1252 — decodificar errado transforma "TÊNIS" em lixo
 * e, pior, pode fazer o cabeçalho não bater e o arquivo ser recusado.
 */
export function decodeOrderBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }

  // Sem BOM: UTF-16LE sem BOM aparece como um NUL a cada dois bytes no ASCII.
  const amostra = bytes.subarray(0, Math.min(bytes.length, 512));
  const nuls = amostra.reduce((n, b) => (b === 0 ? n + 1 : n), 0);
  if (nuls > amostra.length / 4) return new TextDecoder('utf-16le').decode(bytes);

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-1252').decode(bytes);
}

/** Divide uma linha por `;` respeitando aspas duplas (o ERP cita campos com vírgula). */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let atual = '';
  let emAspas = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (emAspas && line[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        emAspas = !emAspas;
      }
    } else if (ch === delimiter && !emAspas) {
      out.push(atual);
      atual = '';
    } else {
      atual += ch;
    }
  }
  out.push(atual);
  return out.map(c => c.trim());
}

function buildRows(header: string[], linhas: string[][]): BabyNalinRow[] {
  const normalizado = header.map(normalizeHeader);
  const indice = (chave: keyof typeof COLUMN_ALIASES): number => {
    for (const alias of COLUMN_ALIASES[chave]) {
      const i = normalizado.indexOf(alias);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iBarra = indice('codigoBarra');
  if (iBarra < 0) {
    throw new Error(
      'Não achei a coluna "Codigo Barra" no arquivo. ' +
        'Use a exportação de etiquetas do pedido de compra (Exp_Etiquetas_PedCompra_*).',
    );
  }

  const iTam = indice('tamanho');
  const iCor = indice('cor');
  const iRef = indice('referencia');
  const iCod = indice('codProduto');
  const iQtd = indice('quantidade');
  const pega = (linha: string[], i: number) => (i >= 0 ? (linha[i] ?? '').trim() : '');

  return linhas
    .map(linha => {
      const qtdBruta = pega(linha, iQtd).replace(/\./g, '').replace(',', '.');
      const qtd = Number(qtdBruta);
      return {
        tamanho: pega(linha, iTam).toUpperCase(),
        cor: pega(linha, iCor).toUpperCase(),
        referencia: pega(linha, iRef).toUpperCase(),
        codProduto: pega(linha, iCod),
        codigoBarra: pega(linha, iBarra),
        quantidade: Number.isFinite(qtd) && qtd > 0 ? Math.round(qtd) : 1,
      };
    })
    // Linha sem código de barras é rodapé/total da exportação — ignorar, não falhar.
    .filter(r => r.codigoBarra.length > 0);
}

/** Lê o CSV já decodificado. Delimitador `;` (padrão do ERP), com `,` como plano B. */
export function parseOrderCsv(texto: string): BabyNalinRow[] {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (linhas.length < 2) throw new Error('Arquivo vazio ou sem linhas de dados.');

  const delimitador = (linhas[0].match(/;/g) ?? []).length >= (linhas[0].match(/,/g) ?? []).length ? ';' : ',';
  const header = splitDelimited(linhas[0], delimitador);
  const dados = linhas.slice(1).map(l => splitDelimited(l, delimitador));
  return buildRows(header, dados);
}

/** Lê a planilha (mesmas colunas do CSV). `xlsx` entra lazy — são 424 KB. */
export async function parseOrderXlsx(buffer: ArrayBuffer): Promise<BabyNalinRow[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  const aba = wb.Sheets[wb.SheetNames[0]];
  if (!aba) throw new Error('A planilha não tem nenhuma aba.');

  const matriz = XLSX.utils.sheet_to_json<string[]>(aba, { header: 1, raw: false, defval: '' });
  const linhas = matriz.filter(l => l.some(c => String(c ?? '').trim().length > 0));
  if (linhas.length < 2) throw new Error('Planilha vazia ou sem linhas de dados.');

  return buildRows(linhas[0].map(String), linhas.slice(1).map(l => l.map(c => String(c ?? ''))));
}

/** Ponto de entrada da tela: aceita CSV ou XLSX e devolve as linhas de etiqueta. */
export async function parseClientOrderFile(file: File): Promise<BabyNalinRow[]> {
  const buffer = await file.arrayBuffer();
  const nome = file.name.toLowerCase();
  const rows = nome.endsWith('.xlsx') || nome.endsWith('.xls')
    ? await parseOrderXlsx(buffer)
    : parseOrderCsv(decodeOrderBytes(buffer));

  if (rows.length === 0) throw new Error('Nenhuma linha com "Codigo Barra" preenchido no arquivo.');
  return rows;
}

/* ──────────────────────────── código de barras ──────────────────────────── */

export interface BarcodeFit {
  moduleCount: number;
  widthMm: number;
  quietZoneMm: number;
  fits: boolean;
}

/** Mede o código no módulo travado e confere a zona de silêncio dos dois lados. */
export function measureBarcode(codigo: string): BarcodeFit {
  const { moduleCount } = encodeCode128(codigo);
  const widthMm = moduleCount * MODULE_MM;
  const quietZoneMm = (ART_WIDTH_MM - widthMm) / 2;
  return { moduleCount, widthMm, quietZoneMm, fits: quietZoneMm >= QUIET_ZONE_MIN_MM };
}

/**
 * Barra o PDF quando o código não cabe — em vez de imprimir milhares de
 * etiquetas com barra cortada, que só se descobre no leitor da loja.
 */
export function assertBarcodeFits(codigo: string): BarcodeFit {
  const fit = measureBarcode(codigo);
  if (!fit.fits) {
    throw new Error(
      `O código "${codigo}" ocupa ${fit.widthMm.toFixed(1)} mm e deixa só ` +
        `${fit.quietZoneMm.toFixed(1)} mm de zona de silêncio (mínimo ${QUIET_ZONE_MIN_MM} mm). ` +
        'Código longo demais para a etiqueta de 46 mm.',
    );
  }
  return fit;
}

/* ──────────────────────────────── PDF ──────────────────────────────── */

export interface BabyNalinPdfOptions {
  /** Repete cada etiqueta pela `Qt. Solicitada` do pedido. Padrão: 1 por linha. */
  repeatByQuantity?: boolean;
  /** Etiquetas físicas por par quando a repetição por quantidade estiver ligada. */
  repeatMultiplier?: number;
  /** PNG em data URI + proporção, pra compor a logomarca. Sem ele, sai sem logo. */
  logo?: { dataUrl: string; width: number; height: number } | null;
}

type PdfDoc = import('jspdf').jsPDF;

/** Piso de corpo do texto: abaixo disso não se lê no chão de fábrica. */
export const MIN_FONT_PT = 6;

/**
 * Maior corpo que couber na largura útil. Só encolhe até `MIN_FONT_PT`; se
 * nem no piso couber, CORTA o texto com reticências.
 *
 * O corte é de propósito: em rolo contínuo, texto que passa da arte não some —
 * ele invade a etiqueta vizinha. Antes de reduzir mais, some com o excedente.
 */
export function fitText(
  doc: PdfDoc,
  texto: string,
  ideal: number,
  larguraMax: number,
): { pt: number; texto: string } {
  for (let pt = ideal; pt >= MIN_FONT_PT; pt--) {
    doc.setFontSize(pt);
    if (doc.getTextWidth(texto) <= larguraMax) return { pt, texto };
  }

  doc.setFontSize(MIN_FONT_PT);
  let cortado = texto;
  while (cortado.length > 1 && doc.getTextWidth(`${cortado}…`) > larguraMax) {
    cortado = cortado.slice(0, -1);
  }
  return { pt: MIN_FONT_PT, texto: `${cortado.trimEnd()}…` };
}

function drawLabel(doc: PdfDoc, row: BabyNalinRow, options: BabyNalinPdfOptions): void {
  const ox = OFFSET_X_MM;
  const oy = OFFSET_Y_MM;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);

  if (options.logo && options.logo.width > 0 && options.logo.height > 0) {
    const { dataUrl, width, height } = options.logo;
    const escala = Math.min(LAYOUT.logo.box / width, LAYOUT.logo.box / height);
    doc.addImage(dataUrl, 'PNG', ox + LAYOUT.logo.x, oy + LAYOUT.logo.y, width * escala, height * escala);
  }

  const larguraTexto = ART_WIDTH_MM - LAYOUT.rightMarginMm - LAYOUT.textX;
  const linhas = [`TAM ${row.tamanho}`, row.cor, `Ref: ${row.referencia}`];
  linhas.forEach((linha, i) => {
    const { pt, texto } = fitText(doc, linha, LAYOUT.textPt, larguraTexto);
    doc.setFontSize(pt);
    doc.text(texto, ox + LAYOUT.textX, oy + LAYOUT.textLinesY[i], { baseline: 'top' });
  });

  // O código do produto começa na margem esquerda, então tem a arte inteira.
  const larguraCodigo = ART_WIDTH_MM - 2 * LAYOUT.productCode.x;
  const codigo = fitText(doc, row.codProduto, LAYOUT.productCode.pt, larguraCodigo);
  doc.setFontSize(codigo.pt);
  doc.text(codigo.texto, ox + LAYOUT.productCode.x, oy + LAYOUT.productCode.y, { baseline: 'top' });

  const fit = assertBarcodeFits(row.codigoBarra);
  const x0 = ox + (ART_WIDTH_MM - fit.widthMm) / 2;
  const y0 = oy + LAYOUT.barcode.topY;
  doc.setFillColor(0, 0, 0);
  for (const barra of code128Bars(row.codigoBarra)) {
    doc.rect(x0 + barra.start * MODULE_MM, y0, barra.width * MODULE_MM, LAYOUT.barcode.heightMm, 'F');
  }
}

/** Expande as linhas em páginas — uma etiqueta por página, na ordem do arquivo. */
export function expandRows(rows: BabyNalinRow[], repeatByQuantity: boolean, repeatMultiplier = 1): BabyNalinRow[] {
  if (!repeatByQuantity) return rows;
  const multiplier = Math.min(100, Math.max(1, Math.trunc(Number(repeatMultiplier) || 1)));
  return rows.flatMap(r => Array.from({ length: Math.max(1, r.quantidade) * multiplier }, () => r));
}

/** Monta o PDF: uma página por etiqueta, no tamanho exato da mídia 50 × 40. */
export async function buildBabyNalinPdf(
  rows: BabyNalinRow[],
  options: BabyNalinPdfOptions = {},
): Promise<PdfDoc> {
  if (rows.length === 0) throw new Error('Nada para gerar: nenhuma etiqueta selecionada.');

  const { jsPDF } = await import('jspdf');
  const paginas = expandRows(rows, options.repeatByQuantity ?? false, options.repeatMultiplier ?? 1);

  const doc = new jsPDF({
    unit: 'mm',
    format: [MEDIA_WIDTH_MM, MEDIA_HEIGHT_MM],
    orientation: 'landscape',
    compress: true,
  });
  doc.setProperties({ title: `Etiquetas ${ART_WIDTH_MM}x${ART_HEIGHT_MM}mm CODE128` });

  paginas.forEach((row, i) => {
    if (i > 0) doc.addPage([MEDIA_WIDTH_MM, MEDIA_HEIGHT_MM], 'landscape');
    drawLabel(doc, row, options);
  });

  return doc;
}

/**
 * Carrega a logomarca como data URI. Só roda no browser; em teste/SSR devolve
 * null e o PDF sai sem logo em vez de estourar.
 */
export async function loadLogoDataUrl(url: string): Promise<BabyNalinPdfOptions['logo']> {
  if (typeof document === 'undefined' || typeof FileReader === 'undefined') return null;
  try {
    const resposta = await fetch(url);
    if (!resposta.ok) return null;
    const blob = await resposta.blob();

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('logo ilegível'));
      img.src = dataUrl;
    });

    return { dataUrl, width, height };
  } catch {
    return null;
  }
}

/** Nome do arquivo baixado, derivado do arquivo de origem. */
export function pdfFilename(origem: string): string {
  const base = origem.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `Etiquetas_${base || 'pedido'}.pdf`;
}
