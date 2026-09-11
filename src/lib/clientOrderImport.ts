/**
 * Importação multiarquivo da Etiquetagem Cliente.
 * Detecta Nalin (Codigo Barra) vs Objetiva (SKU + TAMANHOS) e concatena linhas.
 */
import {
  decodeOrderBytes,
  parseClientOrderFile,
  parseOrderCsv,
  type BabyNalinRow,
} from './babyNalinLabels';
import {
  clientOrderLineSkuKey,
  type ClientLabelPatternKey,
  type ClientOrderLine,
} from './clientLabelPattern';
import {
  isObjetivaOrderHeader,
  parseObjetivaOrderFile,
} from './objetivaLabels';

export type ClientOrderFormat = ClientLabelPatternKey;

/** Extensões aceitas no `<input type="file" multiple>`. */
export const ACCEPT_CLIENT_ORDER_FILES = '.csv,.txt,.xlsx,.xls';

export interface ClientOrderFileError {
  fileName: string;
  message: string;
}

export interface ClientOrderImportResult {
  rows: ClientOrderLine[];
  fileNames: string[];
  format: ClientOrderFormat;
  errors: ClientOrderFileError[];
}

function babyToLine(row: BabyNalinRow, sourceFile?: string): ClientOrderLine {
  return {
    tamanho: row.tamanho,
    cor: row.cor,
    referencia: row.referencia,
    codProduto: row.codProduto,
    codigoBarra: row.codigoBarra,
    quantidade: row.quantidade,
    sourceFile,
  };
}

function firstDataLine(texto: string): string {
  return texto.split(/\r?\n/).find(l => l.trim().length > 0) ?? '';
}

function splitHeader(line: string): string[] {
  const delimitador = (line.match(/;/g) ?? []).length >= (line.match(/,/g) ?? []).length ? ';' : ',';
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
    } else if (ch === delimitador && !emAspas) {
      out.push(atual);
      atual = '';
    } else {
      atual += ch;
    }
  }
  out.push(atual);
  return out.map(c => c.trim());
}

export function detectClientOrderFormatFromHeader(headerLine: string): ClientOrderFormat | null {
  const cells = splitHeader(headerLine);
  if (isObjetivaOrderHeader(cells)) return 'objetiva';
  const normalized = cells.map(c =>
    c.replace(/^\uFEFF/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim(),
  );
  if (normalized.some(h => h.includes('codigo barra') || h === 'ean')) return 'baby_nalin';
  return null;
}

async function detectFileFormat(file: File): Promise<ClientOrderFormat | null> {
  const nome = file.name.toLowerCase();
  if (nome.endsWith('.xlsx') || nome.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'array' });
    const aba = wb.Sheets[wb.SheetNames[0]];
    if (!aba) return null;
    const matriz = XLSX.utils.sheet_to_json<string[]>(aba, { header: 1, raw: false, defval: '' });
    const header = (matriz.find(l => l.some(c => String(c ?? '').trim())) ?? []).map(String);
    if (isObjetivaOrderHeader(header)) return 'objetiva';
    return detectClientOrderFormatFromHeader(header.join(';'));
  }
  const texto = decodeOrderBytes(await file.arrayBuffer());
  return detectClientOrderFormatFromHeader(firstDataLine(texto));
}

async function parseOneFile(file: File, expected: ClientOrderFormat): Promise<ClientOrderLine[]> {
  const detected = await detectFileFormat(file);
  if (detected && detected !== expected) {
    throw new Error(
      `Arquivo parece formato ${detected === 'objetiva' ? 'Objetiva' : 'Nalin'}, mas o padrão do cliente é ${expected === 'objetiva' ? 'Objetiva' : 'Nalin'}.`,
    );
  }

  if (expected === 'objetiva') {
    return parseObjetivaOrderFile(file);
  }

  const rows = await parseClientOrderFile(file);
  return rows.map(row => babyToLine(row, file.name));
}

/**
 * Lê 1..N arquivos em paralelo, exige o formato do padrão do cliente
 * e concatena as linhas. Falhas parciais vão em `errors` sem abortar o lote.
 */
export async function parseClientOrderFiles(
  files: File[],
  patternKey: ClientLabelPatternKey,
): Promise<ClientOrderImportResult> {
  if (files.length === 0) {
    throw new Error('Selecione ao menos um arquivo.');
  }

  const settled = await Promise.all(
    files.map(async file => {
      try {
        const rows = await parseOneFile(file, patternKey);
        return { ok: true as const, fileName: file.name, rows };
      } catch (error) {
        return {
          ok: false as const,
          fileName: file.name,
          message: error instanceof Error ? error.message : 'Falha ao ler o arquivo.',
        };
      }
    }),
  );

  const rows: ClientOrderLine[] = [];
  const fileNames: string[] = [];
  const errors: ClientOrderFileError[] = [];

  for (const item of settled) {
    if (item.ok) {
      rows.push(...item.rows);
      fileNames.push(item.fileName);
    } else {
      errors.push({ fileName: item.fileName, message: item.message });
    }
  }

  if (rows.length === 0) {
    const detail = errors.map(e => `${e.fileName}: ${e.message}`).join(' · ');
    throw new Error(detail || 'Nenhuma linha válida nos arquivos.');
  }

  return { rows, fileNames, format: patternKey, errors };
}

export function summarizeImport(result: ClientOrderImportResult): string {
  const skuCount = new Set(result.rows.map(clientOrderLineSkuKey)).size;
  const files = result.fileNames.length;
  const base = `${result.rows.length} linha(s) · ${skuCount} SKU(s) · ${files} arquivo(s)`;
  if (result.errors.length === 0) return base;
  return `${base} · ${result.errors.length} arquivo(s) com erro`;
}

export function parseBabyNalinCsvToLines(texto: string, sourceFile?: string): ClientOrderLine[] {
  return parseOrderCsv(texto).map(row => babyToLine(row, sourceFile));
}
