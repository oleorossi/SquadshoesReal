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
      try {
        // Worker empacotado pelo Vite como ASSET (`?url`): o pdfjs cria o Worker
        // (módulo ES) sozinho, do MESMO host — respeita o CSP (`worker-src 'self'`,
        // sem CDN) e funciona offline.
        //
        // ⚠ Antes usávamos `?worker` (`new worker.default()`), que faz o Vite
        // TRANSPILAR o worker ESM do pdfjs v6 pra um worker clássico. Esse worker
        // clássico estourava em runtime com "undefined is not a function" (iteração
        // `for…of` sobre valor indefinido no bundle) e derrubava a leitura inteira.
        // O `?url` entrega o `.mjs` intacto e deixa o pdfjs instanciar como module.
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      } catch {
        // Se o worker não puder ser configurado, o pdfjs cai no "fake worker"
        // (main thread): mais lento, porém não trava a leitura do boleto.
      }
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/** Extrai todo o texto de um PDF (concatenado por página). */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  // Só precisamos da CAMADA DE TEXTO — desligamos renderização de fontes e eval
  // (CSP-safe) pra reduzir superfície de features do pdfjs e evitar caminhos que
  // dependem de APIs de canvas/fonte que nem sempre existem no runtime do app.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
  });
  const doc = await loadingTask.promise;
  let text = '';
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      // Uma página ilegível (fonte/estrutura exótica) NÃO pode derrubar o lote —
      // isola por página e segue tentando as demais (a linha digitável costuma
      // aparecer repetida em várias vias do boleto).
      try {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const items = (content?.items ?? []) as Array<{ str?: unknown }>;
        const pageText = items
          .map((it) => (it && typeof it.str === 'string' ? it.str : ''))
          .join(' ');
        text += pageText + '\n';
      } catch {
        // pula a página problemática
      }
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
