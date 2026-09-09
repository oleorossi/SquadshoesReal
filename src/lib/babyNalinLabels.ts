/**
 * Etiqueta de caixa do cliente.
 *
 * Padrão próprio: 2 × 50 × 30 mm com 6 mm de vão (página 106 × 30). Não misturar
 * com a etiqueta térmica de caixa individual da Squad (100 × 30 mm, um avanço).
 *
 * A arte e o CODE128 seguem o padrão fixo do cliente. A geometria do liner do
 * couchê (vão e margens) é um perfil separado, pois muda conforme a faca da
 * gráfica e não pode ser deduzida por fotografia.
 * Milhares de pares são etiquetados por pedido — erro aqui custa caro.
 *
 * Entrada: o arquivo de exportação do pedido de compra do ERP do cliente
 * (`Exp_Etiquetas_PedCompra_*.csv`, `;` em UTF-16/UTF-8/CP1252, ou XLSX).
 * Saídas:
 *   - produção L42PRO: duas etiquetas 50 × 30 mm por carreira, repetidas pela quantidade;
 *   - gráfica: duas artes 50 × 30 mm lado a lado, uma por SKU; vão e margens são opcionais.
 */
import { code128Bars, encodeCode128 } from './code128';

/* ─────────────────────── medidas oficiais (mm) ─────────────────────── */

/**
 * Arte útil de cada coluna 50 × 30.
 *
 * 1 mm para dentro da faca em cada lado. Cada etiqueta física de 50 mm
 * usa 48 mm de arte. O vão entre colunas é o liner da faca — sem ele a
 * coluna da direita imprime em cima do intervalo e corta logo e código.
 */
export const ART_WIDTH_MM = 48.0;
export const ART_HEIGHT_MM = 38.0;

/** Compatibilidade do desenho legado 50 × 40; o gerador atual usa o perfil 2-up abaixo. */
export const MEDIA_WIDTH_MM = 50.0;
export const MEDIA_HEIGHT_MM = 40.0;
export const OFFSET_X_MM = (MEDIA_WIDTH_MM - ART_WIDTH_MM) / 2; // 1,0
export const OFFSET_Y_MM = (MEDIA_HEIGHT_MM - ART_HEIGHT_MM) / 2; // 1,0

/** Imposição da gráfica: duas etiquetas couchê de 50 × 30 mm por carreira. */
export const COUCHE_LABEL_WIDTH_MM = 50.0;
export const COUCHE_LABEL_HEIGHT_MM = 30.0;
export const COUCHE_COLUMNS = 2;

/**
 * Medidas variáveis da faca/liner. O perfil padrão preserva o PDF já usado,
 * mas a tela deixa todas explícitas para conferência com a gráfica.
 */
export interface CoucheRollProfile {
  columnGapMm: number;
  leftMarginMm: number;
  rightMarginMm: number;
  topMarginMm: number;
  bottomMarginMm: number;
}

export const DEFAULT_COUCHE_ROLL_PROFILE: Readonly<CoucheRollProfile> = Object.freeze({
  // Faca 2 × 50 × 30 mm com 6 mm de liner entre as colunas (página 106 × 30).
  // Vão 0 colava a arte da direita no intervalo e cortava logo e o 9 do código.
  columnGapMm: 6,
  leftMarginMm: 0,
  rightMarginMm: 0,
  topMarginMm: 0,
  bottomMarginMm: 0,
});

/** Compatibilidade para consumidores que exibem as medidas do perfil padrão. */
export const COUCHE_COLUMN_GAP_MM = DEFAULT_COUCHE_ROLL_PROFILE.columnGapMm;
export const COUCHE_PAGE_WIDTH_MM =
  COUCHE_LABEL_WIDTH_MM * COUCHE_COLUMNS
  + COUCHE_COLUMN_GAP_MM * (COUCHE_COLUMNS - 1)
  + DEFAULT_COUCHE_ROLL_PROFILE.leftMarginMm
  + DEFAULT_COUCHE_ROLL_PROFILE.rightMarginMm;
export const COUCHE_PAGE_HEIGHT_MM =
  DEFAULT_COUCHE_ROLL_PROFILE.topMarginMm
  + COUCHE_LABEL_HEIGHT_MM
  + DEFAULT_COUCHE_ROLL_PROFILE.bottomMarginMm;
/** Área segura 48 × 28, centralizada dentro de cada etiqueta física 50 × 30. */
export const COUCHE_ART_HEIGHT_MM = 28.0;
export const COUCHE_OFFSET_X_MM = (COUCHE_LABEL_WIDTH_MM - ART_WIDTH_MM) / 2; // 1,0
export const COUCHE_OFFSET_Y_MM = (COUCHE_LABEL_HEIGHT_MM - COUCHE_ART_HEIGHT_MM) / 2; // 1,0
/** No perfil compacto, as barras terminam em y=29 mm e preservam 1 mm inferior. */
export const COUCHE_BARCODE_TOP_Y_MM = 23.0;

/**
 * Módulo do CODE128 definido pelo padrão do cliente: 7 dots a 600 dpi.
 *
 * A cabeça imprime em grade de dots; módulo que não é múltiplo inteiro de dot
 * sai com barras de larguras desiguais. O desenho técnico entregue pelo
 * cliente especifica 7 dots, aproximadamente 0,296 mm por módulo;
 * manter esse valor evita que a leitura do código varie entre lotes.
 */
export const PRINTER_DPI = 600;
export const DOT_MM = 25.4 / PRINTER_DPI; // 0,0423 mm
export const MODULE_DOTS = 7;
export const MODULE_MM = 0.296;
/** Formato obrigatório do cliente, inclusive quando o conteúdo tem 13 dígitos. */
export const BARCODE_FORMAT = 'CODE128' as const;

/** Mínimo em branco de cada lado do código. Nada pode invadir essa faixa. */
export const QUIET_ZONE_MIN_MM = 3.1;

/** Ajuste horizontal do número + CODE128 medido na etiqueta física oficial. */
export const CODE_BLOCK_SHIFT_X_MM = 1.5;

export function barcodeOriginXMm(
  artOriginXMm: number,
  artWidthMm: number,
  barcodeWidthMm: number,
  shiftMm = CODE_BLOCK_SHIFT_X_MM,
): number {
  return artOriginXMm + (artWidthMm - barcodeWidthMm) / 2 + shiftMm;
}

export function barcodeQuietZonesMm(
  artWidthMm: number,
  barcodeWidthMm: number,
  shiftMm = CODE_BLOCK_SHIFT_X_MM,
): { leftMm: number; rightMm: number } {
  const centered = (artWidthMm - barcodeWidthMm) / 2;
  return {
    leftMm: centered + shiftMm,
    rightMm: centered - shiftMm,
  };
}

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
  /** Menor zona de silêncio depois do ajuste horizontal de 1,5 mm. */
  quietZoneMm: number;
  quietZoneLeftMm: number;
  quietZoneRightMm: number;
  fits: boolean;
  /** Motivo pelo qual o conteúdo não pode ser codificado em CODE128. */
  error?: string;
}

/** Mede o código no módulo travado e confere a zona de silêncio dos dois lados. */
export function measureBarcode(codigo: string): BarcodeFit {
  try {
    const { moduleCount } = encodeCode128(codigo);
    const widthMm = moduleCount * MODULE_MM;
    const { leftMm, rightMm } = barcodeQuietZonesMm(ART_WIDTH_MM, widthMm);
    const quietZoneMm = Math.min(leftMm, rightMm);
    return {
      moduleCount,
      widthMm,
      quietZoneMm,
      quietZoneLeftMm: leftMm,
      quietZoneRightMm: rightMm,
      fits: quietZoneMm >= QUIET_ZONE_MIN_MM,
    };
  } catch (error) {
    return {
      moduleCount: 0,
      widthMm: 0,
      quietZoneMm: 0,
      quietZoneLeftMm: 0,
      quietZoneRightMm: 0,
      fits: false,
      error: error instanceof Error ? error.message : 'Conteúdo inválido para CODE128.',
    };
  }
}

/** Posição do número impresso acima do CODE128, com o mesmo ajuste físico. */
export function productCodeOriginXMm(artOriginXMm: number): number {
  return artOriginXMm + LAYOUT.productCode.x + CODE_BLOCK_SHIFT_X_MM;
}

/**
 * Barra o PDF quando o código não cabe — em vez de imprimir milhares de
 * etiquetas com barra cortada, que só se descobre no leitor da loja.
 */
export function assertBarcodeFits(codigo: string): BarcodeFit {
  const fit = measureBarcode(codigo);
  if (fit.error) {
    throw new Error(`O código "${codigo}" é inválido para CODE128: ${fit.error}`);
  }
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
  /** Os dois modos usam o rolo de duas colunas 50×30; muda somente a repetição. */
  mode?: 'production' | 'graphic';
  /** Repete cada etiqueta pela `Qt. Solicitada` do pedido. Na produção, o padrão é repetir. */
  repeatByQuantity?: boolean;
  /** Etiquetas físicas por par quando a repetição por quantidade estiver ligada. */
  repeatMultiplier?: number;
  /** Medidas opcionais de uma faca/liner que não use o padrão 2 × 50 × 30 com vão 6 mm. */
  coucheProfile?: Partial<CoucheRollProfile>;
  /** PNG em data URI + proporção, pra compor a logomarca. Sem ele, sai sem logo. */
  logo?: { dataUrl: string; width: number; height: number } | null;
}

type PdfDoc = import('jspdf').jsPDF;

export interface BabyNalinSkuConflict {
  sku: string;
  referencia: string;
  cor: string;
  tamanho: string;
  codigosBarra: string[];
  codigosProduto: string[];
}

export interface BabyNalinSkuAnalysis {
  rows: BabyNalinRow[];
  conflicts: BabyNalinSkuConflict[];
}

function normalizeSkuPart(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** SKU do arquivo do cliente: referência + cor + tamanho. */
export function clientSkuKey(row: BabyNalinRow): string {
  return [row.referencia, row.cor, row.tamanho].map(normalizeSkuPart).join(' · ');
}

/**
 * Mantém uma arte por SKU na ordem da planilha. Duplicidade idêntica é
 * descartada; barcode ou código de produto divergente vira conflito porque os
 * dois campos participam da impressão.
 */
export function analyzeClientSkus(rows: BabyNalinRow[]): BabyNalinSkuAnalysis {
  const firstBySku = new Map<string, BabyNalinRow>();
  const barcodesBySku = new Map<string, Set<string>>();
  const productCodesBySku = new Map<string, Set<string>>();

  rows.forEach(row => {
    const sku = clientSkuKey(row);
    if (!firstBySku.has(sku)) firstBySku.set(sku, row);
    const barcodes = barcodesBySku.get(sku) ?? new Set<string>();
    barcodes.add(row.codigoBarra.trim());
    barcodesBySku.set(sku, barcodes);
    const productCodes = productCodesBySku.get(sku) ?? new Set<string>();
    productCodes.add(normalizeSkuPart(row.codProduto));
    productCodesBySku.set(sku, productCodes);
  });

  const conflicts = [...barcodesBySku.entries()]
    .filter(([sku, barcodes]) => barcodes.size > 1 || (productCodesBySku.get(sku)?.size ?? 0) > 1)
    .map(([sku, barcodes]) => {
      const row = firstBySku.get(sku)!;
      return {
        sku,
        referencia: row.referencia,
        cor: row.cor,
        tamanho: row.tamanho,
        codigosBarra: [...barcodes],
        codigosProduto: [...(productCodesBySku.get(sku) ?? [])],
      };
    });

  return { rows: [...firstBySku.values()], conflicts };
}

export function uniqueClientSkuRows(rows: BabyNalinRow[]): BabyNalinRow[] {
  const analysis = analyzeClientSkus(rows);
  if (analysis.conflicts.length > 0) {
    const first = analysis.conflicts[0];
    throw new Error(
      `O SKU ${first.referencia} / ${first.cor} / ${first.tamanho} possui dados de impressão conflitantes. ` +
        'Corrija a planilha antes de gerar o arquivo para a gráfica.',
    );
  }
  return analysis.rows;
}

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

interface LabelPlacement {
  xMm: number;
  yMm: number;
  barcodeTopYMm?: number;
}

export interface GraphicLabelPlacement extends LabelPlacement {
  pageIndex: number;
  column: number;
  row: BabyNalinRow;
}

export type ProductionLabelPlacement = GraphicLabelPlacement;

export interface CoucheRollGeometry extends CoucheRollProfile {
  pageWidthMm: number;
  pageHeightMm: number;
}

const MAX_COUCHE_PROFILE_VALUE_MM = 50;

/** Valida o perfil em vez de ajustar medidas silenciosamente. */
export function resolveCoucheRollGeometry(
  profile: Partial<CoucheRollProfile> = {},
): CoucheRollGeometry {
  const merged: CoucheRollProfile = { ...DEFAULT_COUCHE_ROLL_PROFILE, ...profile };
  for (const [field, value] of Object.entries(merged)) {
    if (!Number.isFinite(value) || value < 0 || value > MAX_COUCHE_PROFILE_VALUE_MM) {
      throw new Error(`Medida inválida no perfil do rolo (${field}): use um valor entre 0 e ${MAX_COUCHE_PROFILE_VALUE_MM} mm.`);
    }
  }
  return {
    ...merged,
    pageWidthMm:
      merged.leftMarginMm
      + COUCHE_LABEL_WIDTH_MM * COUCHE_COLUMNS
      + merged.columnGapMm * (COUCHE_COLUMNS - 1)
      + merged.rightMarginMm,
    pageHeightMm: merged.topMarginMm + COUCHE_LABEL_HEIGHT_MM + merged.bottomMarginMm,
  };
}

function couchePlacementAt(
  row: BabyNalinRow,
  index: number,
  geometry: CoucheRollGeometry,
): GraphicLabelPlacement {
  const column = index % COUCHE_COLUMNS;
  return {
    pageIndex: Math.floor(index / COUCHE_COLUMNS),
    column,
    xMm:
      geometry.leftMarginMm
      + column * (COUCHE_LABEL_WIDTH_MM + geometry.columnGapMm)
      + COUCHE_OFFSET_X_MM,
    yMm: geometry.topMarginMm + COUCHE_OFFSET_Y_MM,
    barcodeTopYMm: COUCHE_BARCODE_TOP_Y_MM,
    row,
  };
}

/**
 * Planeja a imposição couchê sem depender do jsPDF: esquerda, direita e então
 * a próxima página. A última página ímpar fica deliberadamente vazia à direita.
 */
export function planGraphicLabelPlacements(
  rows: BabyNalinRow[],
  profile: Partial<CoucheRollProfile> = {},
): GraphicLabelPlacement[] {
  const geometry = resolveCoucheRollGeometry(profile);
  return uniqueClientSkuRows(rows).map((row, index) => couchePlacementAt(row, index, geometry));
}

export function graphicPageCount(skuCount: number): number {
  return Math.ceil(Math.max(0, Math.trunc(skuCount)) / COUCHE_COLUMNS);
}

function drawLabel(
  doc: PdfDoc,
  row: BabyNalinRow,
  options: BabyNalinPdfOptions,
  placement: LabelPlacement,
): void {
  const ox = placement.xMm;
  const oy = placement.yMm;

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

  // Número e CODE128 avançam juntos 1,5 mm para reproduzir a mídia física.
  const productCodeX = productCodeOriginXMm(ox);
  const larguraCodigo = ART_WIDTH_MM - 2 * LAYOUT.productCode.x - CODE_BLOCK_SHIFT_X_MM;
  const codigo = fitText(doc, row.codProduto, LAYOUT.productCode.pt, larguraCodigo);
  doc.setFontSize(codigo.pt);
  doc.text(codigo.texto, productCodeX, oy + LAYOUT.productCode.y, { baseline: 'top' });

  const fit = assertBarcodeFits(row.codigoBarra);
  const x0 = barcodeOriginXMm(ox, ART_WIDTH_MM, fit.widthMm);
  const y0 = oy + (placement.barcodeTopYMm ?? LAYOUT.barcode.topY);
  doc.setFillColor(0, 0, 0);
  for (const barra of code128Bars(row.codigoBarra)) {
    doc.rect(x0 + barra.start * MODULE_MM, y0, barra.width * MODULE_MM, LAYOUT.barcode.heightMm, 'F');
  }
}

/** Limite e expansão da tiragem antes da imposição em duas colunas. */
export const MAX_PDF_LABELS = 20_000;

export function countExpandedRows(
  rows: BabyNalinRow[],
  repeatByQuantity: boolean,
  repeatMultiplier = 1,
): number {
  if (!repeatByQuantity) return rows.length;
  const multiplier = Math.min(100, Math.max(1, Math.trunc(Number(repeatMultiplier) || 1)));
  return rows.reduce((total, row) => {
    const quantidade = Math.max(1, Math.trunc(Number(row.quantidade) || 1));
    const next = total + quantidade * multiplier;
    return next > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : next;
  }, 0);
}

export function expandRows(rows: BabyNalinRow[], repeatByQuantity: boolean, repeatMultiplier = 1): BabyNalinRow[] {
  if (!repeatByQuantity) return rows;
  const total = countExpandedRows(rows, repeatByQuantity, repeatMultiplier);
  if (total > MAX_PDF_LABELS) {
    throw new Error(`A geração teria ${total.toLocaleString('pt-BR')} etiquetas. O limite seguro é ${MAX_PDF_LABELS.toLocaleString('pt-BR')} por PDF.`);
  }
  const multiplier = Math.min(100, Math.max(1, Math.trunc(Number(repeatMultiplier) || 1)));
  return rows.flatMap(r => Array.from({ length: Math.max(1, r.quantidade) * multiplier }, () => r));
}

/**
 * Distribui a tiragem da L42PRO pelas duas colunas do rolo. Ex.: 144 etiquetas
 * ocupam 72 carreiras; se a quantidade for ímpar, a última direita fica vazia.
 */
export function planProductionLabelPlacements(
  rows: BabyNalinRow[],
  profile: Partial<CoucheRollProfile> = {},
  repeatMultiplier = 1,
  repeatByQuantity = true,
): ProductionLabelPlacement[] {
  const total = countExpandedRows(rows, repeatByQuantity, repeatMultiplier);
  if (total > MAX_PDF_LABELS) {
    throw new Error(`A geração teria ${total.toLocaleString('pt-BR')} etiquetas. O limite seguro é ${MAX_PDF_LABELS.toLocaleString('pt-BR')} por PDF.`);
  }

  const geometry = resolveCoucheRollGeometry(profile);
  const multiplier = Math.min(100, Math.max(1, Math.trunc(Number(repeatMultiplier) || 1)));
  const placements: ProductionLabelPlacement[] = [];
  rows.forEach(row => {
    const copies = repeatByQuantity ? Math.max(1, Math.trunc(Number(row.quantidade) || 1)) * multiplier : 1;
    for (let copy = 0; copy < copies; copy++) {
      placements.push(couchePlacementAt(row, placements.length, geometry));
    }
  });
  return placements;
}

/** Monta o PDF 2-up 50×30 para a L42PRO ou a matriz sem repetição para gráfica. */
export async function buildBabyNalinPdf(
  rows: BabyNalinRow[],
  options: BabyNalinPdfOptions = {},
): Promise<PdfDoc> {
  if (rows.length === 0) throw new Error('Nada para gerar: nenhuma etiqueta selecionada.');

  const { jsPDF } = await import('jspdf');
  const graphicMode = options.mode === 'graphic';
  const coucheGeometry = resolveCoucheRollGeometry(options.coucheProfile);
  const pageWidth = coucheGeometry.pageWidthMm;
  const pageHeight = coucheGeometry.pageHeightMm;

  const doc = new jsPDF({
    unit: 'mm',
    format: [pageWidth, pageHeight],
    orientation: 'landscape',
    compress: true,
  });
  doc.setProperties({
    title: graphicMode
      ? `Etiquetas couche ${COUCHE_LABEL_WIDTH_MM}x${COUCHE_LABEL_HEIGHT_MM}mm 2 colunas ${BARCODE_FORMAT}`
      : `Etiquetas L42PRO 2x${COUCHE_LABEL_WIDTH_MM}x${COUCHE_LABEL_HEIGHT_MM}mm ${BARCODE_FORMAT}`,
  });

  const placements = graphicMode
    ? planGraphicLabelPlacements(rows, options.coucheProfile)
    : planProductionLabelPlacements(
        rows,
        options.coucheProfile,
        options.repeatMultiplier,
        options.repeatByQuantity ?? true,
      );
  placements.forEach(placement => {
    if (placement.pageIndex > 0 && placement.column === 0) {
      doc.addPage([pageWidth, pageHeight], 'landscape');
    }
    drawLabel(doc, placement.row, options, placement);
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

/** Nome do PDF vetorial couchê 2-up para envio à gráfica. */
export function graphicPdfFilename(origem: string): string {
  const base = origem.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `Artes_SKU_${base || 'pedido'}.pdf`;
}
