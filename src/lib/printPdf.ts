import { toast } from 'sonner';

/**
 * Impressão via PDF gerado no servidor — caminho ÚNICO de etiquetas e fichas.
 *
 * Substitui o `window.open` + `print()` do navegador, que produzia resultado
 * DIFERENTE em cada aparelho. No celular o Chrome ignora o `@page{margin:0}` do
 * CSS: as etiquetas (288mm de conteúdo em folha de 297mm) transbordavam ~11mm e
 * geravam uma folha EM BRANCO depois de cada folha boa, além de carimbar URL e
 * "Página N de M" no papel. As fichas têm a mesma folga de 9mm
 * (`PaginatedSheet.PAGE_HEIGHT_MM = 288`) e o mesmo destino.
 *
 * Agora o desenho é sempre do mesmo Chromium, no servidor: o arquivo sai idêntico
 * no celular e no desktop.
 *
 * ⚠ NÃO existe plano B (decisão do dono, 10/08/2026): se a geração falhar, o app
 * avisa e NÃO imprime, em vez de cair no caminho antigo. Servidor fora do ar =
 * ninguém imprime até voltar — foi o preço aceito para nunca sair um documento
 * fora do padrão.
 */

/** Páginas por chamada. Assume o teto de ~10s do plano Hobby: um lote grande
 *  estoura o tempo e o operador leva um erro no meio do romaneio. */
export const PAGES_PER_BATCH = 40;

export interface PrintPdfOptions {
  /** Nome do arquivo, sem extensão (ex.: 'etiquetas-PV-00151'). */
  filename: string;
  /** Documentos em paisagem (cartões de lote 12/A4). */
  landscape?: boolean;
  /** Aba aberta ANTES de gerar — ver openPrintTab. */
  target?: Window | null;
}

/**
 * Abre a aba de destino. Tem que ser chamado DENTRO do clique, de forma síncrona:
 * abrir depois do `await` faz o celular tratar como pop-up e bloquear.
 * Este é o mesmo padrão que o código antigo já usava.
 */
export function openPrintTab(): Window | null {
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(
      '<!doctype html><meta charset="utf-8"><title>Gerando PDF…</title>' +
      '<body style="font-family:system-ui,sans-serif;padding:24px;color:#111">' +
      '<p>Gerando o PDF… pode levar alguns segundos.</p></body>',
    );
    w.document.close();
  }
  return w;
}

/**
 * Fatia o documento em lotes de páginas. Cada `.page`/`.pagi-page` é uma folha;
 * o lote reaproveita o mesmo `<head>` (estilos e fontes) do documento original.
 *
 * Exportada e pura pra ser testável: é a lógica que decide o que vai em cada
 * chamada, e errar aqui significa etiqueta faltando no meio do maço.
 */
export function splitHtmlIntoBatches(html: string, pagesPerBatch = PAGES_PER_BATCH): string[] {
  if (pagesPerBatch <= 0) return [html];

  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!headMatch || !bodyMatch) return [html];

  const head = headMatch[1];
  const body = bodyMatch[1];
  const bodyOpenTag = (html.match(/<body[^>]*>/i) || ['<body>'])[0];

  // Quebra no início de cada folha, preservando o que vem antes da primeira.
  const parts = body.split(/(?=<section class="page|<div class="pagi-page)/);
  const pages = parts.filter(p => /class="(page|pagi-page)/.test(p));
  if (pages.length <= pagesPerBatch) return [html];

  const preamble = parts.slice(0, parts.length - pages.length).join('');
  const batches: string[] = [];
  for (let i = 0; i < pages.length; i += pagesPerBatch) {
    const slice = pages.slice(i, i + pagesPerBatch).join('');
    batches.push(`<!doctype html><html><head>${head}</head>${bodyOpenTag}${preamble}${slice}</body></html>`);
  }
  return batches;
}

/**
 * Monta um documento HTML completo a partir de um pedaço da tela já renderizado.
 *
 * É assim que as FICHAS vão pro PDF sem reescrever layout nenhum: o
 * `PaginatedSheet` já mediu os blocos e o auto-ajuste de fonte já rodou no
 * navegador do usuário — aqui só empacotamos o resultado com os estilos do app
 * e mandamos o servidor imprimir.
 *
 * ⚠ `<base>` é obrigatório: as fotos dos produtos e o CSS vêm por caminho
 * relativo, e do lado do servidor não existe "mesma origem" pra resolver.
 */
export function serializeForPdf(el: HTMLElement, title = 'Documento'): string {
  const origin = window.location.origin;
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .map(l => `<link rel="stylesheet" href="${l.href}">`)
    .join('\n');
  const styles = Array.from(document.querySelectorAll<HTMLStyleElement>('style'))
    .map(s => `<style>${s.innerHTML}</style>`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<base href="${origin}/"><title>${title}</title>` +
    `${links}\n${styles}</head><body>${el.outerHTML}</body></html>`;
}

async function renderBatch(html: string, landscape: boolean): Promise<ArrayBuffer> {
  const res = await fetch('/api/render-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, landscape }),
  });
  if (!res.ok) {
    let detalhe = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) detalhe = j.error;
    } catch { /* resposta sem json */ }
    throw new Error(detalhe);
  }
  return res.arrayBuffer();
}

/** Junta os lotes num arquivo só. `pdf-lib` entra por import preguiçoso. */
async function mergePdfs(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  if (buffers.length === 1) return new Uint8Array(buffers[0]);
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const doc = await PDFDocument.load(buf);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  return out.save();
}

/**
 * Gera o PDF do HTML e mostra na aba. Devolve true quando imprimiu.
 *
 * Fluxo: a aba já foi aberta no clique (openPrintTab) → geramos em lotes →
 * juntamos → apontamos a aba pro arquivo.
 */
export async function printHtmlAsPdf(html: string, opts: PrintPdfOptions): Promise<boolean> {
  const { filename, landscape = false } = opts;
  const tab = opts.target ?? null;
  const batches = splitHtmlIntoBatches(html);
  const toastId = `pdf-${filename}`;

  try {
    if (batches.length > 1) {
      toast.loading(`Gerando PDF… (0 de ${batches.length} partes)`, { id: toastId });
    } else {
      toast.loading('Gerando PDF…', { id: toastId });
    }

    const buffers: ArrayBuffer[] = [];
    for (let i = 0; i < batches.length; i++) {
      buffers.push(await renderBatch(batches[i], landscape));
      if (batches.length > 1) {
        toast.loading(`Gerando PDF… (${i + 1} de ${batches.length} partes)`, { id: toastId });
      }
    }

    const merged = await mergePdfs(buffers);
    const blob = new Blob([merged as unknown as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    if (tab && !tab.closed) {
      tab.location.href = url;
    } else {
      // Aba bloqueada ou fechada pelo usuário: baixa o arquivo, que é o caminho
      // que sempre funciona. Some do padrão só a forma de ENTREGA, não o conteúdo.
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    // Revoga tarde: o visualizador da aba ainda está lendo o blob.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    toast.success('PDF pronto.', { id: toastId });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido';
    toast.error(`Não foi possível gerar o PDF: ${msg}`, { id: toastId, duration: 10_000 });
    if (tab && !tab.closed) {
      tab.document.body.innerHTML =
        `<p style="font-family:system-ui,sans-serif;padding:24px;color:#b00">` +
        `Falha ao gerar o PDF: ${msg}. Feche esta aba e tente de novo.</p>`;
    }
    return false;
  }
}
