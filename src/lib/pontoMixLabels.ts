/**
 * Etiqueta Ponto Mix 40×60 mm — L42PRO FULL (203 dpi).
 *
 * A arte NÃO é invenção nossa: foi medida dot a dot na etiqueta impressa pela
 * cliente. A 203 dpi, 40×60 mm = 320×480 dots, e a foto de referência estava
 * exatamente nessa escala — por isso a grade abaixo é em DOTS, não em mm.
 *
 * Ordem: faixa preta + logo → 3 linhas (descrição literal do arquivo) →
 * caixa do tamanho → CODE128 + dígitos → faixa preta com o preço.
 */
import pontoMixLogoKnockout from '@/assets/ponto-mix/logo-ponto-mix-knockout.png';
import robotoCondensedBoldUrl from '@/assets/ponto-mix/fonts/RobotoCondensed-Bold.ttf?url';
import { code128Bars } from './code128';
import { decodeOrderBytes } from './babyNalinLabels';
import {
  PONTO_MIX_DEFAULT_GEOMETRY,
  PONTO_MIX_DEFAULT_PRICE_FORMAT,
  PONTO_MIX_DEFAULT_TEMPLATES,
  type ClientLabelFileMapping,
  type ClientLabelGeometry,
  type ClientLabelLineTemplates,
  type ClientLabelPriceFormat,
  type ClientOrderLine,
} from './clientLabelPattern';

export const PONTO_MIX_DPI = 203;
export const MAX_PONTO_MIX_PDF_LABELS = 20_000;

/**
 * Marca extraída do próprio `Etiqueta_com_logo.btw` da cliente: branca com
 * fundo transparente, já recortada na tinta. Vai sobre a faixa preta.
 */
export const PONTO_MIX_BUNDLED_LOGO_URL = pontoMixLogoKnockout as string;

/** Nome registrado no jsPDF (Roboto Condensed Bold embutida). */
export const PONTO_MIX_PDF_FONT = 'PontoMixSans';

/** Altura de caixa-alta ÷ em da Roboto Condensed Bold (capHeight 1456 / upem 2048). */
const CAP_RATIO = 0.7109;

/**
 * Grade de projeto em DOTS a 203 dpi (40×60 mm = 320×480). Todo valor aqui foi
 * medido na etiqueta impressa da cliente — não arredondar "para ficar redondo".
 */
export const PONTO_MIX_ART_DOTS = {
  gridW: 320,
  gridH: 480,
  /** Faixa preta do topo. */
  headerBand: { x: 35, y: 13, w: 254, h: 82 },
  /** Área útil da marca dentro da faixa (tinta medida: 231×56). */
  logoBox: { x: 47, y: 27, w: 231, h: 56 },
  /** 3 linhas da descrição: topo da caixa-alta de cada uma. */
  text: { x: 31, firstTop: 131, step: 23, capH: 17, maxW: 264 },
  /** Caixa do tamanho: traço de 3 dots, dígitos com 22 de caixa-alta. */
  sizeBox: { x: 97, y: 250, w: 150, h: 44, stroke: 3, capH: 22 },
  /**
   * Código de barras: módulo de 2 dots (padrão térmico) e altura 59.
   * `x` = 64 (8 mm) — a cliente imprime em 35, o dono pediu um pouco mais ao centro.
   */
  barcode: { x: 64, y: 298, h: 59, module: 2 },
  /** Dígitos legíveis, centrados sob o código. */
  hri: { top: 364, capH: 13 },
  /** Faixa preta do preço + caixa-alta dos dígitos (o "R$" transborda um pouco). */
  priceBand: { x: 17, y: 397, w: 269, h: 57, capH: 39 },
} as const;

type PdfDoc = import('jspdf').jsPDF;

export type PontoMixLogo = { dataUrl: string; width: number; height: number } | null;

export interface PontoMixPdfOptions {
  geometry?: Partial<ClientLabelGeometry>;
  templates?: Partial<ClientLabelLineTemplates>;
  priceFormat?: Partial<ClientLabelPriceFormat>;
  repeatByQuantity?: boolean;
  logo?: PontoMixLogo;
}

const FIELD_ALIASES: Record<keyof ClientLabelFileMapping['columns'], string[]> = {
  descricao: [
    'descricao',
    'descricao produto',
    'descricao completa',
    'produto',
    'nome',
    'sandalia',
    'desc',
  ],
  referencia: ['referencia', 'ref', 'modelo', 'sku', 'referencia produto'],
  // `gradex`/`gradey` são as colunas de cor e numeração do Padrao.txt da Ponto Mix.
  cor: ['cor', 'color', 'cores', 'gradex'],
  tamanho: ['tamanho', 'tam', 'size', 'numeracao', 'num', 'nro', 'numero', 'nr', 'gradey'],
  codigoBarra: [
    'codigo barra',
    'codigo de barras',
    'codigo barras',
    'codigobarras',
    'cod barras',
    'codbarra',
    'cod barra',
    'ean',
    'barcode',
    'barras',
    'gtin',
    'codigo',
  ],
  preco: [
    'preco',
    'preco venda',
    'preco varejo',
    'valor',
    'valor unitario',
    'vlr',
    'vlr unit',
    'unitario',
    'price',
    'rs',
  ],
  quantidade: ['quantidade', 'qtd', 'qty', 'qtde', 'qtde etiquetas', 'pares'],
  codProduto: ['cod produto', 'codigo produto', 'produto id', 'id', 'cod'],
};

/** Ordem posicional usada quando Padrao.txt/BarTender vem sem cabeçalho reconhecível. */
export const PONTO_MIX_POSITIONAL_COLUMNS: (keyof ClientLabelFileMapping['columns'])[] = [
  'descricao',
  'referencia',
  'cor',
  'tamanho',
  'codigoBarra',
  'preco',
  'quantidade',
];

function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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

/** Escolhe o delimitador mais frequente entre tab, pipe, ponto-e-vírgula e vírgula. */
export function detectPontoMixDelimiter(line: string): string {
  const counts: Array<{ delim: string; n: number }> = [
    { delim: '\t', n: (line.match(/\t/g) ?? []).length },
    { delim: '|', n: (line.match(/\|/g) ?? []).length },
    { delim: ';', n: (line.match(/;/g) ?? []).length },
    { delim: ',', n: (line.match(/,/g) ?? []).length },
  ];
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.delim : ';';
}

function isBartenderCommandLine(line: string): boolean {
  const t = line.trim().toUpperCase();
  return t.startsWith('%BTW%') || t.startsWith('%END%') || t.startsWith('%PAC%');
}

function looksLikeShoeSize(raw: string): boolean {
  const n = Number(String(raw).replace(',', '.').trim());
  return Number.isFinite(n) && n >= 15 && n <= 48 && Number.isInteger(n);
}

function looksLikePrice(raw: string): boolean {
  const t = String(raw).trim();
  if (!t) return false;
  if (/r\$/i.test(t)) return true;
  // Inteiro puro não é preço (bate com qtd/tamanho); exige decimal.
  if (/^\d+$/.test(t)) return false;
  const cleaned = t
    .replace(/r\$\s*/i, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 && n < 10_000;
}

function looksLikeBarcode(raw: string): boolean {
  const t = String(raw).trim();
  return /^\d{4,14}$/.test(t);
}

/**
 * Infere índices de coluna a partir das linhas de dados quando o cabeçalho
 * não casa com os aliases (caso típico do Padrao.txt do BarTender).
 */
export function inferPontoMixColumnIndexes(
  dataRows: string[][],
): Partial<Record<keyof ClientLabelFileMapping['columns'], number>> {
  if (dataRows.length === 0) return {};
  const width = Math.max(...dataRows.map(r => r.length));
  const result: Partial<Record<keyof ClientLabelFileMapping['columns'], number>> = {};
  const taken = new Set<number>();

  const score = (col: number, pred: (v: string) => boolean) =>
    dataRows.reduce((acc, row) => acc + (pred(row[col] ?? '') ? 1 : 0), 0);

  const pickBest = (
    field: keyof ClientLabelFileMapping['columns'],
    pred: (v: string) => boolean,
    minHits: number,
  ) => {
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < width; c++) {
      if (taken.has(c)) continue;
      const s = score(c, pred);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best >= 0 && bestScore >= minHits) {
      result[field] = best;
      taken.add(best);
    }
  };

  const minHits = Math.max(1, Math.ceil(dataRows.length * 0.5));
  pickBest('tamanho', looksLikeShoeSize, minHits);
  pickBest('codigoBarra', looksLikeBarcode, minHits);
  pickBest('preco', looksLikePrice, minHits);
  pickBest('quantidade', v => {
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n <= 50_000 && !looksLikePrice(v);
  }, minHits);

  // Texto longo → descrição; próximo texto → referência/cor.
  const textScores = Array.from({ length: width }, (_, c) => {
    if (taken.has(c)) return { c, avg: 0 };
    const avg =
      dataRows.reduce((acc, row) => acc + String(row[c] ?? '').trim().length, 0) /
      dataRows.length;
    return { c, avg };
  })
    .filter(x => x.avg >= 2)
    .sort((a, b) => b.avg - a.avg);

  if (textScores[0] && result.descricao == null) {
    result.descricao = textScores[0].c;
    taken.add(textScores[0].c);
  }
  if (textScores[1] && result.referencia == null) {
    result.referencia = textScores[1].c;
    taken.add(textScores[1].c);
  }
  if (textScores[2] && result.cor == null) {
    result.cor = textScores[2].c;
    taken.add(textScores[2].c);
  }

  return result;
}

function indexOfMappedOrAlias(
  headers: string[],
  field: keyof ClientLabelFileMapping['columns'],
  mapping?: ClientLabelFileMapping,
): number {
  const configured = mapping?.columns?.[field]?.trim();
  if (configured) {
    const want = normalizeHeader(configured);
    const hit = headers.findIndex(h => h === want);
    if (hit >= 0) return hit;
  }
  for (const alias of FIELD_ALIASES[field] ?? []) {
    const i = headers.indexOf(alias);
    if (i >= 0) return i;
  }
  return -1;
}

export function isPontoMixOrderHeader(
  headerCells: string[],
  mapping?: ClientLabelFileMapping,
): boolean {
  const normalized = headerCells.map(normalizeHeader);
  const hasCode =
    indexOfMappedOrAlias(normalized, 'codigoBarra', mapping) >= 0 ||
    indexOfMappedOrAlias(normalized, 'codProduto', mapping) >= 0;
  const hasSize = indexOfMappedOrAlias(normalized, 'tamanho', mapping) >= 0;
  const hasPrice = indexOfMappedOrAlias(normalized, 'preco', mapping) >= 0;
  // Preço distingue do Nalin (Codigo Barra + Tamanho sem preço de etiqueta).
  return hasCode && hasSize && hasPrice;
}

function parseQuantity(raw: string): number {
  const cleaned = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
}

function buildRows(
  header: string[],
  linhas: string[][],
  mapping: ClientLabelFileMapping | undefined,
  sourceFile?: string,
  inferred?: Partial<Record<keyof ClientLabelFileMapping['columns'], number>>,
): ClientOrderLine[] {
  const normalized = header.map(normalizeHeader);
  const pick = (linha: string[], field: keyof ClientLabelFileMapping['columns']) => {
    const mapped = indexOfMappedOrAlias(normalized, field, mapping);
    if (mapped >= 0) return (linha[mapped] ?? '').trim();
    const inferredIdx = inferred?.[field];
    if (inferredIdx != null && inferredIdx >= 0) return (linha[inferredIdx] ?? '').trim();
    return '';
  };

  const rows: ClientOrderLine[] = [];
  for (const linha of linhas) {
    const codigoBarra = pick(linha, 'codigoBarra') || pick(linha, 'codProduto');
    const tamanho = pick(linha, 'tamanho').toUpperCase();
    if (!codigoBarra && !tamanho) continue;
    const referencia = (pick(linha, 'referencia') || pick(linha, 'codProduto') || codigoBarra).toUpperCase();
    rows.push({
      tamanho,
      cor: pick(linha, 'cor').toUpperCase(),
      referencia,
      codProduto: pick(linha, 'codProduto') || codigoBarra,
      codigoBarra: codigoBarra || referencia,
      quantidade: parseQuantity(pick(linha, 'quantidade')),
      descricao: pick(linha, 'descricao').toUpperCase(),
      valor: pick(linha, 'preco'),
      sourceFile,
    });
  }
  if (rows.length === 0) {
    throw new Error('Nenhuma linha válida no arquivo Ponto Mix (código/tamanho).');
  }
  return rows;
}

function buildRowsPositional(
  linhas: string[][],
  sourceFile?: string,
): ClientOrderLine[] {
  const inferred = inferPontoMixColumnIndexes(linhas);
  const hasUseful =
    inferred.codigoBarra != null || inferred.tamanho != null || inferred.preco != null;
  if (!hasUseful) {
    // Fallback: ordem canônica do esqueleto (arte Ponto Mix).
    const rows: ClientOrderLine[] = [];
    for (const linha of linhas) {
      const get = (field: keyof ClientLabelFileMapping['columns']) => {
        const i = PONTO_MIX_POSITIONAL_COLUMNS.indexOf(field);
        return i >= 0 ? (linha[i] ?? '').trim() : '';
      };
      const codigoBarra = get('codigoBarra') || get('codProduto');
      const tamanho = get('tamanho').toUpperCase();
      if (!codigoBarra && !tamanho) continue;
      rows.push({
        tamanho,
        cor: get('cor').toUpperCase(),
        referencia: (get('referencia') || codigoBarra).toUpperCase(),
        codProduto: get('codProduto') || codigoBarra,
        codigoBarra: codigoBarra || get('referencia'),
        quantidade: parseQuantity(get('quantidade')),
        descricao: get('descricao').toUpperCase(),
        valor: get('preco'),
        sourceFile,
      });
    }
    if (rows.length === 0) {
      throw new Error(
        'Não reconheci as colunas do Padrao.txt. Confira se há código, tamanho e preço (separados por ; , tab ou |).',
      );
    }
    return rows;
  }
  return buildRows([], linhas, undefined, sourceFile, inferred);
}

export function parsePontoMixOrderCsv(
  texto: string,
  mapping?: ClientLabelFileMapping,
  sourceFile?: string,
): ClientOrderLine[] {
  const linhasBrutas = texto
    .split(/\r?\n/)
    .map(l => l.replace(/^\uFEFF/, ''))
    .filter(l => l.trim().length > 0 && !isBartenderCommandLine(l));
  if (linhasBrutas.length === 0) {
    throw new Error('Arquivo Ponto Mix vazio ou sem linhas de dados.');
  }

  const delimitador = detectPontoMixDelimiter(linhasBrutas[0]!);
  const matriz = linhasBrutas.map(l => splitDelimited(l, delimitador));

  // Procura a primeira linha que pareça cabeçalho Ponto Mix (pula título "Padrao" etc.).
  let headerIdx = matriz.findIndex(cells => isPontoMixOrderHeader(cells, mapping));
  if (headerIdx >= 0) {
    return buildRows(matriz[headerIdx]!, matriz.slice(headerIdx + 1), mapping, sourceFile);
  }

  // Cabeçalho parcial (código+tamanho sem preço, ou só com mapping): ainda tenta.
  headerIdx = matriz.findIndex(cells => {
    const normalized = cells.map(normalizeHeader);
    const hasCode =
      indexOfMappedOrAlias(normalized, 'codigoBarra', mapping) >= 0 ||
      indexOfMappedOrAlias(normalized, 'codProduto', mapping) >= 0;
    const hasSize = indexOfMappedOrAlias(normalized, 'tamanho', mapping) >= 0;
    return hasCode && hasSize;
  });
  if (headerIdx >= 0) {
    const data = matriz.slice(headerIdx + 1);
    const inferred = inferPontoMixColumnIndexes(data);
    return buildRows(matriz[headerIdx]!, data, mapping, sourceFile, inferred);
  }

  // Padrao.txt / BarTender sem cabeçalho reconhecível → inferência pelas células.
  if (matriz.length >= 1 && matriz.some(r => r.length >= 2)) {
    const first = matriz[0]!;
    const firstLooksLikeData =
      first.some(looksLikeBarcode) || first.some(looksLikeShoeSize) || first.some(looksLikePrice);
    const dataOnly = firstLooksLikeData ? matriz : matriz.slice(1);
    if (dataOnly.length === 0) {
      throw new Error(
        'Arquivo Ponto Mix só tem cabeçalho — falta linha de dados (código/tamanho/preço).',
      );
    }
    return buildRowsPositional(dataOnly, sourceFile);
  }

  throw new Error(
    'Cabeçalho não parece pedido Ponto Mix (precisa de código, tamanho e preço — ou um Padrao.txt com esses dados).',
  );
}

/** Modelo BarTender (.btw) — é o layout da etiqueta, não o arquivo de pedido. */
export function isBartenderTemplateFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.btw');
}

export const BARTENDER_TEMPLATE_UPLOAD_MESSAGE =
  'Etiqueta_com_logo.btw é o modelo BarTender da arte (já recriado no esqueleto Ponto Mix). Para gerar etiquetas, envie o Padrao.txt ou a planilha/CSV do pedido.';

export async function parsePontoMixOrderFile(
  file: File,
  mapping?: ClientLabelFileMapping,
): Promise<ClientOrderLine[]> {
  if (isBartenderTemplateFile(file)) {
    throw new Error(BARTENDER_TEMPLATE_UPLOAD_MESSAGE);
  }
  const nome = file.name.toLowerCase();
  if (nome.endsWith('.xlsx') || nome.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'array' });
    const aba = wb.Sheets[wb.SheetNames[0]!];
    if (!aba) throw new Error('Planilha Ponto Mix sem abas.');
    const matriz = XLSX.utils.sheet_to_json<string[]>(aba, {
      header: 1,
      raw: false,
      defval: '',
    });
    const headerRow = matriz.find(l => l.some(c => String(c ?? '').trim()));
    if (!headerRow) throw new Error('Planilha Ponto Mix sem cabeçalho.');
    const header = headerRow.map(String);
    const data = matriz
      .slice(matriz.indexOf(headerRow) + 1)
      .filter(l => l.some(c => String(c ?? '').trim()))
      .map(l => l.map(c => String(c ?? '')));
    if (isPontoMixOrderHeader(header, mapping)) {
      return buildRows(header, data, mapping, file.name);
    }
    const normalized = header.map(normalizeHeader);
    const hasCode =
      indexOfMappedOrAlias(normalized, 'codigoBarra', mapping) >= 0 ||
      indexOfMappedOrAlias(normalized, 'codProduto', mapping) >= 0;
    const hasSize = indexOfMappedOrAlias(normalized, 'tamanho', mapping) >= 0;
    if (hasCode && hasSize) {
      return buildRows(header, data, mapping, file.name, inferPontoMixColumnIndexes(data));
    }
    if (data.length > 0) {
      return buildRowsPositional(
        [header, ...data].filter(r => r.some(c => String(c).trim())),
        file.name,
      );
    }
    throw new Error(
      'Cabeçalho não parece pedido Ponto Mix (precisa de código, tamanho e preço).',
    );
  }
  const texto = decodeOrderBytes(await file.arrayBuffer());
  return parsePontoMixOrderCsv(texto, mapping, file.name);
}

/** Placeholders `{campo}` → valor da linha (vazio se ausente). */
export function renderPontoMixTemplate(template: string, row: ClientOrderLine): string {
  const values: Record<string, string> = {
    descricao: (row.descricao ?? '').trim(),
    referencia: (row.referencia ?? '').trim(),
    cor: (row.cor ?? '').trim(),
    tamanho: (row.tamanho ?? '').trim(),
    codigoBarra: (row.codigoBarra ?? '').trim(),
    codProduto: (row.codProduto ?? '').trim(),
    preco: (row.valor ?? '').trim(),
    quantidade: String(row.quantidade ?? ''),
    tipo: (row.tipo ?? '').trim(),
    categoria: (row.categoria ?? '').trim(),
    grupo: (row.grupo ?? '').trim(),
  };
  return template
    .replace(/\{([a-zA-Z_]+)\}/g, (_, key: string) => values[key] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(code[12]);
}

/** Code 128 para o exemplo `105742`; EAN-13 só quando o valor já é EAN-13 válido. */
export function resolvePontoMixBarcodeSymbology(code: string): 'ean13' | 'code128' {
  return isValidEan13(code.trim()) ? 'ean13' : 'code128';
}

export function formatPontoMixPrice(
  raw: string | undefined,
  format: ClientLabelPriceFormat = PONTO_MIX_DEFAULT_PRICE_FORMAT,
): string {
  const cleaned = (raw ?? '').replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return `${format.prefix}0${format.decimalSeparator}00`;
  let n: number;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  } else if (cleaned.includes(',')) {
    n = Number(cleaned.replace(',', '.'));
  } else {
    n = Number(cleaned);
  }
  if (!Number.isFinite(n)) return `${format.prefix}${cleaned}`;
  const fixed = Math.abs(n).toFixed(2);
  const [intPart, dec] = fixed.split('.') as [string, string];
  return `${format.prefix}${intPart}${format.decimalSeparator}${dec}`;
}

export interface PontoMixLabelCopy {
  line1: string;
  line2: string;
  line3: string;
  /** Texto corrido antes da quebra — quem desenha requebra com a métrica real. */
  textSource: string;
  tamanho: string;
  codigoBarra: string;
  priceText: string;
  barcodeSymbology: 'ean13' | 'code128';
}

/**
 * Caracteres por linha na largura útil. Medido na etiqueta da cliente:
 * `SANDALIA CALCADOS  FEM` = 22 caracteres ocupando os 264 dots de texto.
 */
export const PONTO_MIX_TEXT_CHARS = 22;

/**
 * SKU interno (ex.: `64841968-00-0000000`) — não é a linha comercial da arte
 * (`SQUARD SHOES SP201`). Se for parar em line2, a etiqueta diverge do PDF correto.
 */
export function isPontoMixInternalSku(value: string | undefined | null): boolean {
  const t = String(value ?? '').trim();
  if (!t) return false;
  const digits = (t.match(/\d/g) ?? []).length;
  const letters = (t.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  if (digits >= 6 && letters <= 2) return true;
  if (/^\d{5,}[-/.\s]\d/.test(t) && letters <= 2) return true;
  return false;
}

/**
 * Texto que vai nas 3 linhas. No arquivo da cliente a `descricao` já traz tudo
 * (`SANDALIA CALCADOS  FEM SQUARD SHOES SP201 PRETO 34  34`) e o BarTender só
 * quebra por largura — inclusive preservando os espaços duplos. Então a
 * descrição é usada LITERAL; só completamos com os campos que faltarem nela.
 *
 * O NCM (`64041900-00-0000000`) nunca entra: é código fiscal, não linha de arte.
 */
export function buildPontoMixTextSource(
  row: ClientOrderLine,
  templates: ClientLabelLineTemplates = PONTO_MIX_DEFAULT_TEMPLATES,
): string {
  const desc = (row.descricao ?? '').replace(/[\r\n\t]+/g, ' ').trimEnd();
  if (!desc.trim()) {
    return [
      renderPontoMixTemplate(templates.line1, row),
      renderPontoMixTemplate(templates.line2, row),
      renderPontoMixTemplate(templates.line3, row),
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  const upper = desc.toUpperCase();
  const has = (value: string) =>
    !value || upper.includes(value.trim().toUpperCase());

  let out = desc;
  const referencia = (row.referencia ?? '').trim();
  if (referencia && !isPontoMixInternalSku(referencia) && !has(referencia)) {
    out += ` ${referencia}`;
  }
  const cor = (row.cor ?? '').trim();
  if (cor && !has(cor)) out += ` ${cor}`;
  const tamanho = (row.tamanho ?? '').trim();
  if (tamanho && !new RegExp(`(^|\\s)${tamanho.toUpperCase()}(\\s|$)`).test(upper)) {
    out += ` ${tamanho}`;
  }
  return out.toUpperCase();
}

/**
 * Quebra por largura preservando os espaços internos (o dobro-espaço da
 * cliente é conteúdo, não sujeira). `measure` devolve a largura do texto na
 * unidade do chamador; `maxLines` corta o excedente com reticências.
 */
export function wrapPontoMixText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines = 3,
): string[] {
  const tokens = text.match(/\s+|\S+/g) ?? [];
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const isSpace = /^\s+$/.test(token);
    const candidate = current + token;
    if (current && !isSpace && measure(candidate) > maxWidth) {
      lines.push(current.trimEnd());
      if (lines.length === maxLines) return lines;
      current = token;
      continue;
    }
    if (!current && isSpace) continue;
    current = candidate;
  }
  if (current.trim()) lines.push(current.trimEnd());
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]!}…`;
  return kept;
}

export function composePontoMixLabelCopy(
  row: ClientOrderLine,
  templates: ClientLabelLineTemplates = PONTO_MIX_DEFAULT_TEMPLATES,
  priceFormat: ClientLabelPriceFormat = PONTO_MIX_DEFAULT_PRICE_FORMAT,
): PontoMixLabelCopy {
  const codigoBarra = (row.codigoBarra || row.codProduto).trim();
  const textSource = buildPontoMixTextSource(row, templates);
  // Sem métrica de fonte aqui: quebra por contagem de caracteres calibrada na
  // etiqueta da cliente (22 caracteres na largura útil). Quem desenha refaz a
  // quebra com a métrica real; isto serve para ZPL, testes e depuração.
  const lines = wrapPontoMixText(textSource, PONTO_MIX_TEXT_CHARS, s => s.length);
  return {
    line1: lines[0] ?? '',
    line2: lines[1] ?? '',
    line3: lines[2] ?? '',
    textSource,
    tamanho: (row.tamanho || '-').trim() || '-',
    codigoBarra,
    priceText: formatPontoMixPrice(row.valor, priceFormat),
    barcodeSymbology: resolvePontoMixBarcodeSymbology(codigoBarra),
  };
}

function mergeGeometry(partial?: Partial<ClientLabelGeometry>): ClientLabelGeometry {
  return { ...PONTO_MIX_DEFAULT_GEOMETRY, ...partial };
}

function mergeTemplates(partial?: Partial<ClientLabelLineTemplates>): ClientLabelLineTemplates {
  return { ...PONTO_MIX_DEFAULT_TEMPLATES, ...partial };
}

function mergePriceFormat(partial?: Partial<ClientLabelPriceFormat>): ClientLabelPriceFormat {
  return {
    ...PONTO_MIX_DEFAULT_PRICE_FORMAT,
    ...partial,
    decimalSeparator: partial?.decimalSeparator === ',' ? ',' : '.',
  };
}

function expandLines(rows: ClientOrderLine[], repeatByQuantity: boolean): ClientOrderLine[] {
  if (!repeatByQuantity) return rows;
  const total = rows.reduce((sum, row) => sum + Math.max(1, Math.trunc(row.quantidade) || 1), 0);
  if (total > MAX_PONTO_MIX_PDF_LABELS) {
    throw new Error(
      `A geração teria ${total.toLocaleString('pt-BR')} etiquetas. O limite seguro é ${MAX_PONTO_MIX_PDF_LABELS.toLocaleString('pt-BR')} por PDF.`,
    );
  }
  return rows.flatMap(row =>
    Array.from({ length: Math.max(1, Math.trunc(row.quantidade) || 1) }, () => row),
  );
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')
    ? 'JPEG'
    : 'PNG';
}

function mmToDots(mm: number, dpi = PONTO_MIX_DPI): number {
  return Math.max(1, Math.round((mm / 25.4) * dpi));
}

function zplField(text: string, maxLen: number): string {
  return text
    .replace(/[\^~]/g, ' ')
    .slice(0, maxLen)
    .trim();
}

function setDocFont(doc: PdfDoc, style: 'normal' | 'bold' = 'bold'): void {
  try {
    doc.setFont(PONTO_MIX_PDF_FONT, style);
  } catch {
    doc.setFont('helvetica', style === 'normal' ? 'normal' : 'bold');
  }
}

/** Corpo em pt que dá exatamente `capMm` de altura de caixa-alta. */
function fontPtForCapHeight(capMm: number): number {
  return (capMm / CAP_RATIO) * (72 / 25.4);
}

/**
 * Maior corpo ≤ `basePt` em que TODAS as linhas cabem em `maxWidth`.
 * Só encolhe: a etiqueta da cliente é o teto, não o piso.
 */
export function fitFontPtToWidth(
  lines: string[],
  maxWidth: number,
  basePt: number,
  measure: (text: string, pt: number) => number,
): number {
  const widest = lines.filter(Boolean).reduce((max, line) => {
    const w = measure(line, basePt);
    return w > max ? w : max;
  }, 0);
  if (widest <= maxWidth || widest <= 0) return basePt;
  return basePt * (maxWidth / widest);
}

let cachedFontBase64: string | null = null;

async function loadPontoMixFontBase64(): Promise<string> {
  if (cachedFontBase64) return cachedFontBase64;
  const res = await fetch(robotoCondensedBoldUrl);
  if (!res.ok) throw new Error(`Falha ao carregar fonte Ponto Mix (${res.status}).`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  cachedFontBase64 = btoa(binary);
  return cachedFontBase64;
}

/** Registra Roboto Condensed Bold no doc (idempotente por instância). */
export async function ensurePontoMixPdfFont(doc: PdfDoc): Promise<void> {
  const fonts = doc.getFontList?.() ?? {};
  if (fonts[PONTO_MIX_PDF_FONT]) return;
  const base64 = await loadPontoMixFontBase64();
  doc.addFileToVFS('RobotoCondensed-Bold.ttf', base64);
  doc.addFont('RobotoCondensed-Bold.ttf', PONTO_MIX_PDF_FONT, 'normal');
  doc.addFont('RobotoCondensed-Bold.ttf', PONTO_MIX_PDF_FONT, 'bold');
}

async function ensurePontoMixCanvasFont(): Promise<string> {
  const family = 'PontoMixSansCanvas';
  if (typeof document === 'undefined') return 'Arial Narrow, Helvetica, Arial, sans-serif';
  try {
    const face = new FontFace(family, `url(${robotoCondensedBoldUrl})`, { weight: '700' });
    await face.load();
    document.fonts.add(face);
    await document.fonts.load(`700 12px ${family}`);
    return family;
  } catch {
    return 'Arial Narrow, Helvetica, Arial, sans-serif';
  }
}

/** Fallback quando a imagem da marca falha: alvo à esquerda + PONTO MIX. */
function drawWordmarkFallback(
  doc: PdfDoc,
  x: number,
  y: number,
  bandW: number,
  bandH: number,
): void {
  const cy = y + bandH / 2;
  const markR = Math.min(bandH * 0.32, 2.6);
  doc.setTextColor(255, 255, 255);
  setDocFont(doc, 'bold');
  const fontPt = Math.max(6.5, Math.min(12, bandH * 1.05));
  doc.setFontSize(fontPt);
  const word = 'PONTO MIX';
  const markGap = markR * 0.85;
  const wordW = doc.getTextWidth(word);
  const totalW = markR * 2 + markGap + wordW;
  const startX = x + (bandW - totalW) / 2;
  const markCx = startX + markR;
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(Math.max(0.18, markR * 0.22));
  doc.circle(markCx, cy, markR, 'S');
  doc.setLineWidth(Math.max(0.12, markR * 0.12));
  doc.circle(markCx, cy, markR * 0.55, 'S');
  doc.setFillColor(255, 255, 255);
  doc.circle(markCx, cy, markR * 0.22, 'F');
  doc.text(word, startX + markR * 2 + markGap, cy, { baseline: 'middle' });
  doc.setTextColor(0, 0, 0);
}

function drawLogoOnBlackBand(
  doc: PdfDoc,
  logo: PontoMixLogo,
  x: number,
  y: number,
  bandW: number,
  bandH: number,
  boxW: number,
  boxH: number,
): void {
  doc.setFillColor(0, 0, 0);
  doc.rect(x, y, bandW, bandH, 'F');
  if (logo && logo.width > 0 && logo.height > 0) {
    const scale = Math.min(boxW / logo.width, boxH / logo.height);
    const drawW = logo.width * scale;
    const drawH = logo.height * scale;
    const ox = x + (bandW - drawW) / 2;
    const oy = y + (bandH - drawH) / 2;
    try {
      doc.addImage(logo.dataUrl, imageFormat(logo.dataUrl), ox, oy, drawW, drawH);
      return;
    } catch {
      /* fallback wordmark */
    }
  }
  drawWordmarkFallback(doc, x, y, bandW, bandH);
}

/**
 * Converte a grade de dots (203 dpi) para as medidas da etiqueta configurada.
 * Em 40×60 mm o fator é exatamente 0,125 mm/dot — igual à etiqueta da cliente.
 */
function artSlots(geometry: ClientLabelGeometry) {
  const D = PONTO_MIX_ART_DOTS;
  const w = geometry.labelWidthMm;
  const h = geometry.labelHeightMm;
  const sx = w / D.gridW;
  const sy = h / D.gridH;
  const box = (b: { x: number; y: number; w: number; h: number }) => ({
    x: b.x * sx,
    y: b.y * sy,
    w: b.w * sx,
    h: b.h * sy,
  });
  return {
    w,
    h,
    sx,
    sy,
    headerBand: box(D.headerBand),
    logoBox: box(D.logoBox),
    text: {
      x: D.text.x * sx,
      firstTop: D.text.firstTop * sy,
      /** Linha de base da 1ª linha: topo da caixa-alta + a própria caixa-alta. */
      firstBaseline: (D.text.firstTop + D.text.capH) * sy,
      step: D.text.step * sy,
      maxW: D.text.maxW * sx,
      fontPt: fontPtForCapHeight(D.text.capH * sy),
    },
    sizeBox: { ...box(D.sizeBox), stroke: D.sizeBox.stroke * sx, fontPt: fontPtForCapHeight(D.sizeBox.capH * sy) },
    barcode: {
      x: D.barcode.x * sx,
      y: D.barcode.y * sy,
      h: D.barcode.h * sy,
      module: D.barcode.module * sx,
    },
    hri: {
      top: D.hri.top * sy,
      baseline: (D.hri.top + D.hri.capH) * sy,
      fontPt: fontPtForCapHeight(D.hri.capH * sy),
    },
    priceBand: { ...box(D.priceBand), fontPt: fontPtForCapHeight(D.priceBand.capH * sy) },
  };
}

function drawPontoMixLabel(
  doc: PdfDoc,
  row: ClientOrderLine,
  geometry: ClientLabelGeometry,
  templates: ClientLabelLineTemplates,
  priceFormat: ClientLabelPriceFormat,
  logo: PontoMixLogo,
): void {
  const copy = composePontoMixLabelCopy(row, templates, priceFormat);
  const slots = artSlots(geometry);

  const band = slots.headerBand;
  drawLogoOnBlackBand(doc, logo, band.x, band.y, band.w, band.h, slots.logoBox.w, slots.logoBox.h);

  // As quebras são as da cliente (orçamento de caracteres); o corpo encolhe até
  // a linha mais larga caber. Requebrar pela métrica da nossa fonte mudaria os
  // pontos de quebra — foi o que jogou "FEM" para a segunda linha.
  doc.setTextColor(0, 0, 0);
  setDocFont(doc, 'bold');
  const lines = [copy.line1, copy.line2, copy.line3].filter(Boolean);
  const fontPt = fitFontPtToWidth(
    lines,
    slots.text.maxW,
    slots.text.fontPt,
    (s, pt) => {
      doc.setFontSize(pt);
      return doc.getTextWidth(s);
    },
  );
  doc.setFontSize(fontPt);
  lines.forEach((line, i) => {
    doc.text(line, slots.text.x, slots.text.firstBaseline + slots.text.step * i, {
      baseline: 'alphabetic',
    });
  });

  const sbox = slots.sizeBox;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(sbox.stroke);
  doc.rect(sbox.x + sbox.stroke / 2, sbox.y + sbox.stroke / 2, sbox.w - sbox.stroke, sbox.h - sbox.stroke, 'S');
  setDocFont(doc, 'bold');
  doc.setFontSize(sbox.fontPt);
  doc.text(copy.tamanho, sbox.x + sbox.w / 2, sbox.y + sbox.h / 2, {
    align: 'center',
    baseline: 'middle',
  });

  if (copy.codigoBarra) {
    try {
      const bars = code128Bars(copy.codigoBarra);
      const moduleCount = bars.reduce((max, b) => Math.max(max, b.start + b.width), 0);
      // Módulo fixo de 2 dots (padrão térmico); só encolhe se o código não couber.
      const available = slots.w - slots.barcode.x - slots.text.x;
      const module = Math.min(slots.barcode.module, available / Math.max(moduleCount, 1));
      const totalW = moduleCount * module;
      const barX = slots.barcode.x;
      doc.setFillColor(0, 0, 0);
      for (const barra of bars) {
        doc.rect(barX + barra.start * module, slots.barcode.y, barra.width * module, slots.barcode.h, 'F');
      }
      setDocFont(doc, 'bold');
      doc.setFontSize(slots.hri.fontPt);
      doc.text(copy.codigoBarra, barX + totalW / 2, slots.hri.baseline, {
        align: 'center',
        baseline: 'alphabetic',
      });
    } catch {
      doc.setFontSize(6);
      doc.text('(código inválido)', slots.w / 2, slots.barcode.y + 4, { align: 'center' });
    }
  }

  const pb = slots.priceBand;
  doc.setFillColor(0, 0, 0);
  doc.rect(pb.x, pb.y, pb.w, pb.h, 'F');
  doc.setTextColor(255, 255, 255);
  setDocFont(doc, 'bold');
  doc.setFontSize(pb.fontPt);
  doc.text(copy.priceText, pb.x + pb.w / 2, pb.y + pb.h / 2, {
    align: 'center',
    baseline: 'middle',
  });
  doc.setTextColor(0, 0, 0);
}

export async function buildPontoMixPdf(
  rows: ClientOrderLine[],
  options: PontoMixPdfOptions = {},
): Promise<Blob> {
  const geometry = mergeGeometry(options.geometry);
  const templates = mergeTemplates(options.templates);
  const priceFormat = mergePriceFormat(options.priceFormat);
  const expanded = expandLines(rows, options.repeatByQuantity !== false);
  if (expanded.length === 0) throw new Error('Nenhuma etiqueta para gerar.');

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [geometry.labelWidthMm, geometry.labelHeightMm],
  });
  try {
    await ensurePontoMixPdfFont(doc);
  } catch {
    /* Helvetica fallback via setDocFont */
  }

  expanded.forEach((row, index) => {
    if (index > 0) doc.addPage([geometry.labelWidthMm, geometry.labelHeightMm], 'portrait');
    drawPontoMixLabel(doc, row, geometry, templates, priceFormat, options.logo ?? null);
  });

  return doc.output('blob');
}

export function pontoMixPdfFilename(mode: 'producao' | 'grafico' = 'producao'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return mode === 'grafico'
    ? `ponto-mix-grafico-${stamp}.pdf`
    : `ponto-mix-producao-${stamp}.pdf`;
}

export function countPontoMixLabels(rows: ClientOrderLine[], repeatByQuantity: boolean): number {
  if (!repeatByQuantity) return rows.length;
  return rows.reduce((sum, row) => sum + Math.max(1, Math.trunc(row.quantidade) || 1), 0);
}

/**
 * ZPL 203 dpi — mesmas proporções do PDF (header + linhas + caixa + barcode + preço).
 * Logo PNG omitida no ZPL textual; wordmark aproximado no header.
 */
export function buildPontoMixZpl(
  rows: ClientOrderLine[],
  options: {
    geometry?: Partial<ClientLabelGeometry>;
    templates?: Partial<ClientLabelLineTemplates>;
    priceFormat?: Partial<ClientLabelPriceFormat>;
    repeatByQuantity?: boolean;
  } = {},
): string {
  const geometry = mergeGeometry(options.geometry);
  const templates = mergeTemplates(options.templates);
  const priceFormat = mergePriceFormat(options.priceFormat);
  const expanded = expandLines(rows, options.repeatByQuantity !== false);
  const D = PONTO_MIX_ART_DOTS;

  // A grade JÁ é em dots a 203 dpi; só reescala se a etiqueta não for 40×60.
  const W = mmToDots(geometry.labelWidthMm);
  const H = mmToDots(geometry.labelHeightMm);
  const kx = W / D.gridW;
  const ky = H / D.gridH;
  const dx = (v: number) => Math.round(v * kx);
  const dy = (v: number) => Math.round(v * ky);

  const blocks = expanded.map(row => {
    const copy = composePontoMixLabelCopy(row, templates, priceFormat);
    const lines = [copy.line1, copy.line2, copy.line3].map(l => zplField(l, 40));
    const sizeVal = zplField(copy.tamanho, 6);
    const price = zplField(copy.priceText, 24);
    const barcode = copy.codigoBarra.replace(/[^A-Za-z0-9 ._/-]/g, '').slice(0, 50);

    const band = { x: dx(D.headerBand.x), y: dy(D.headerBand.y), w: dx(D.headerBand.w), h: dy(D.headerBand.h) };
    const textX = dx(D.text.x);
    const textY = dy(D.text.firstTop);
    const lineStep = dy(D.text.step);
    // ^A0N é medido pela ALTURA do caractere; caixa-alta ≈ 0,71 do corpo.
    const lineFont = Math.max(8, Math.round(dy(D.text.capH) / CAP_RATIO));
    const sizeFont = Math.max(10, Math.round(dy(D.sizeBox.capH) / CAP_RATIO));
    const hriFont = Math.max(8, Math.round(dy(D.hri.capH) / CAP_RATIO));
    const priceFont = Math.max(12, Math.round(dy(D.priceBand.capH) / CAP_RATIO));
    const sbox = { x: dx(D.sizeBox.x), y: dy(D.sizeBox.y), w: dx(D.sizeBox.w), h: dy(D.sizeBox.h) };
    const stroke = Math.max(1, dx(D.sizeBox.stroke));
    const bc = { x: dx(D.barcode.x), y: dy(D.barcode.y), h: dy(D.barcode.h), module: Math.max(1, dx(D.barcode.module)) };
    const pb = { x: dx(D.priceBand.x), y: dy(D.priceBand.y), w: dx(D.priceBand.w), h: dy(D.priceBand.h) };

    const barcodeCmd = barcode
      ? [
          `^BY${bc.module},2.0,${bc.h}`,
          `^FO${bc.x},${bc.y}`,
          copy.barcodeSymbology === 'ean13' ? `^BEN,${bc.h},N,N` : `^BCN,${bc.h},N,N,N`,
          `^FD${barcode}^FS`,
          // HRI desenhado como texto para controlar fonte e centro (o ^BC embutido não deixa).
          `^FO${bc.x},${dy(D.hri.top)}^A0N,${hriFont},${hriFont}^FB${dx(D.gridW - D.barcode.x * 2)},1,0,C^FD${barcode}^FS`,
        ].join('\n')
      : '';

    // A marca é imagem: no ZPL textual fica o wordmark aproximado dentro da faixa.
    const markCx = band.x + Math.round(band.w * 0.18);
    const markCy = band.y + Math.round(band.h / 2);
    const markR = Math.round(band.h * 0.28);

    return [
      '^XA',
      `^PW${W}`,
      `^LL${H}`,
      '^LH0,0',
      '^CI28',
      `^FO${band.x},${band.y}^GB${band.w},${band.h},${band.h},B^FS`,
      `^FO${markCx - markR},${markCy - markR}^GC${markR * 2},${Math.max(1, Math.round(markR * 0.18))},B^FS`,
      `^FO${markCx - Math.round(markR * 0.55)},${markCy - Math.round(markR * 0.55)}^GC${Math.round(markR * 1.1)},${Math.max(1, Math.round(markR * 0.1))},B^FS`,
      `^FO${band.x + Math.round(band.w * 0.3)},${band.y + Math.round(band.h * 0.26)}^A0N,${Math.round(band.h * 0.5)},${Math.round(band.h * 0.5)}^FR^FD${zplField('PONTO MIX', 20)}^FS`,
      ...lines.map((l, i) => (l ? `^FO${textX},${textY + lineStep * i}^A0N,${lineFont},${lineFont}^FD${l}^FS` : '')),
      `^FO${sbox.x},${sbox.y}^GB${sbox.w},${sbox.h},${stroke},B^FS`,
      `^FO${sbox.x},${sbox.y + Math.round((sbox.h - sizeFont) / 2)}^A0N,${sizeFont},${sizeFont}^FB${sbox.w},1,0,C^FD${sizeVal}^FS`,
      barcodeCmd,
      `^FO${pb.x},${pb.y}^GB${pb.w},${pb.h},${pb.h},B^FS`,
      `^FO${pb.x},${pb.y + Math.round((pb.h - priceFont) / 2)}^A0N,${priceFont},${priceFont}^FB${pb.w},1,0,C^FR^FD${price}^FS`,
      '^XZ',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return blocks.join('\n\n');
}

export function pontoMixZplFilename(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `ponto-mix-l42pro-${stamp}.zpl`;
}

/** Preview PNG data-URL da primeira etiqueta (canvas) — mesma geometria/fonte do PDF. */
export async function renderPontoMixPreviewDataUrl(
  row: ClientOrderLine,
  options: PontoMixPdfOptions = {},
): Promise<string> {
  const geometry = mergeGeometry(options.geometry);
  const templates = mergeTemplates(options.templates);
  const priceFormat = mergePriceFormat(options.priceFormat);
  const copy = composePontoMixLabelCopy(row, templates, priceFormat);
  const slots = artSlots(geometry);
  const fontFamily = await ensurePontoMixCanvasFont();
  const scale = 8;
  const px = (mm: number) => mm * scale;
  // Canvas mede o corpo da fonte; o alvo é a caixa-alta (mesma regra do PDF).
  const fontForCap = (capMm: number) => `700 ${(capMm / CAP_RATIO) * scale}px ${fontFamily}`;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(px(slots.w));
  canvas.height = Math.round(px(slots.h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível para preview.');
  const D = PONTO_MIX_ART_DOTS;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const band = slots.headerBand;
  ctx.fillStyle = '#000000';
  ctx.fillRect(px(band.x), px(band.y), px(band.w), px(band.h));

  let logoDrawn = false;
  if (options.logo?.dataUrl) {
    try {
      const img = await loadImage(options.logo.dataUrl);
      const boxW = px(slots.logoBox.w);
      const boxH = px(slots.logoBox.h);
      const s = Math.min(boxW / img.width, boxH / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      ctx.drawImage(img, px(band.x) + (px(band.w) - dw) / 2, px(band.y) + (px(band.h) - dh) / 2, dw, dh);
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fontForCap(band.h * 0.4);
    ctx.fillText('PONTO MIX', px(band.x + band.w / 2), px(band.y + band.h / 2));
  }

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const lines = [copy.line1, copy.line2, copy.line3].filter(Boolean);
  const basePx = ((D.text.capH * slots.sy) / CAP_RATIO) * scale;
  const textPx = fitFontPtToWidth(lines, px(slots.text.maxW), basePx, (s, size) => {
    ctx.font = `700 ${size}px ${fontFamily}`;
    return ctx.measureText(s).width;
  });
  ctx.font = `700 ${textPx}px ${fontFamily}`;
  lines.forEach((line, i) => {
    ctx.fillText(line, px(slots.text.x), px(slots.text.firstBaseline + slots.text.step * i));
  });

  const sbox = slots.sizeBox;
  ctx.lineWidth = px(sbox.stroke);
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(
    px(sbox.x) + px(sbox.stroke) / 2,
    px(sbox.y) + px(sbox.stroke) / 2,
    px(sbox.w) - px(sbox.stroke),
    px(sbox.h) - px(sbox.stroke),
  );
  ctx.font = fontForCap(D.sizeBox.capH * slots.sy);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(copy.tamanho, px(sbox.x + sbox.w / 2), px(sbox.y + sbox.h / 2));

  if (copy.codigoBarra) {
    try {
      const bars = code128Bars(copy.codigoBarra);
      const moduleCount = bars.reduce((max, b) => Math.max(max, b.start + b.width), 0);
      const available = px(slots.w - slots.barcode.x - slots.text.x);
      const module = Math.min(px(slots.barcode.module), available / Math.max(moduleCount, 1));
      const barX = px(slots.barcode.x);
      for (const barra of bars) {
        ctx.fillRect(barX + barra.start * module, px(slots.barcode.y), barra.width * module, px(slots.barcode.h));
      }
      ctx.font = fontForCap(D.hri.capH * slots.sy);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(copy.codigoBarra, barX + (moduleCount * module) / 2, px(slots.hri.baseline));
    } catch {
      /* ignore */
    }
  }

  const pb = slots.priceBand;
  ctx.fillStyle = '#000000';
  ctx.fillRect(px(pb.x), px(pb.y), px(pb.w), px(pb.h));
  ctx.fillStyle = '#ffffff';
  ctx.font = fontForCap(D.priceBand.capH * slots.sy);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(copy.priceText, px(pb.x + pb.w / 2), px(pb.y + pb.h / 2));

  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui carregar a logomarca para o preview.'));
    img.src = src;
  });
}

export async function loadPontoMixLogoDataUrl(url: string | null | undefined): Promise<PontoMixLogo> {
  if (!url) return null;
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width <= 0 || canvas.height <= 0) return null;
    ctx.drawImage(img, 0, 0);
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return null;
  }
}

/**
 * Marca do `.btw` da cliente, já branca sobre transparente — vai direto na faixa.
 * Upload do cliente é ignorado: a arte Ponto Mix é fixa.
 *
 * ⚠ Sem branqueamento em runtime. O asset anterior (`logo-ponto-mix-white.png`)
 * saiu de um branqueamento assim e tinha 79 pixels opacos em 13.246 — a faixa
 * preta imprimia vazia e ninguém via o erro até comparar com a etiqueta impressa.
 */
export async function resolvePontoMixLogo(_url?: string | null): Promise<PontoMixLogo> {
  void _url;
  return loadPontoMixLogoDataUrl(PONTO_MIX_BUNDLED_LOGO_URL);
}
