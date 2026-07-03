/**
 * Extração de dados de boleto a partir de arquivos PDF, 100% no cliente.
 *
 * Usa `pdfjs-dist` (lazy-loaded) pra ler a **camada de texto** do PDF e então o
 * `boletoParser` pra decodificar a linha digitável. Boletos gerados por bancos
 * e ERPs quase sempre têm camada de texto com a linha digitável — nesses casos
 * o preenchimento é automático. PDFs que são só imagem escaneada (sem texto)
 * não podem ser lidos aqui: retornamos `parsed = null` pra que o usuário
 * preencha manualmente na tela de conferência.
 */

import { extractDigitableLine, parseDigitableLine, type ParsedBoleto } from './boletoParser';

export interface BoletoPdfResult {
  fileName: string;
  /** Texto bruto extraído do PDF (usado como fallback/diagnóstico). */
  rawText: string;
  /** Dados decodificados da linha digitável; null se não achou/decodificou. */
  parsed: ParsedBoleto | null;
  /** Mensagem de erro amigável quando a leitura falhou. */
  error: string | null;
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

/** Carrega o pdfjs uma única vez e configura o worker (bundle local, sem CDN). */
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      // Worker empacotado pelo Vite a partir do próprio node_modules — respeita
      // o CSP (nada de CDN externo) e funciona offline.
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker');
      pdfjs.GlobalWorkerOptions.workerPort = new worker.default();
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/** Extrai todo o texto de um PDF (concatenado por página). */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;
  let text = '';
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((it) => ('str' in it ? (it as { str: string }).str : ''))
        .join(' ');
      text += pageText + '\n';
    }
  } finally {
    // Libera worker + recursos (destroy vive no loading task, não no doc).
    await loadingTask.destroy();
  }
  return text;
}

/**
 * Lê um único PDF de boleto e retorna os dados decodificados (ou o erro).
 * Nunca lança — encapsula qualquer falha em `error` pra não travar o lote.
 */
export async function readBoletoPdf(file: File): Promise<BoletoPdfResult> {
  const base: BoletoPdfResult = { fileName: file.name, rawText: '', parsed: null, error: null };
  try {
    const rawText = await extractPdfText(file);
    base.rawText = rawText;

    const line = extractDigitableLine(rawText);
    if (!line) {
      base.error = 'Linha digitável não encontrada (PDF pode ser imagem escaneada). Preencha manualmente.';
      return base;
    }

    try {
      base.parsed = parseDigitableLine(line);
    } catch {
      base.error = 'Linha digitável encontrada mas inválida. Confira os dados.';
    }
    return base;
  } catch (e) {
    base.error = `Não foi possível ler o PDF: ${(e as Error).message || 'erro desconhecido'}.`;
    return base;
  }
}

/** Lê vários PDFs em paralelo, preservando a ordem dos arquivos. */
export async function readBoletoPdfs(files: File[]): Promise<BoletoPdfResult[]> {
  return Promise.all(files.map((f) => readBoletoPdf(f)));
}
