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

/**
 * Teto de bytes por chamada. O corte é por TAMANHO, não por contagem de páginas.
 *
 * MEDIDO em 10/08/2026, contra a função em produção:
 *   2 páginas sem foto ....... 2,2s
 *   40 páginas sem foto ...... 2,0s   ← renderizar página é quase de graça
 *   40 páginas com 40 fotos .. 6,0s
 * Ou seja: o custo é FIXO (~2s pra subir o Chromium), não por página.
 *
 * A primeira versão cortava a cada 40 páginas — o que fazia um lote de 120
 * etiquetas pagar os 2s TRÊS vezes sem necessidade, porque o HTML de um rótulo
 * tem ~2,8KB e 120 deles dão ~350KB: cabem numa requisição só, muito longe do
 * limite de ~4,5MB do corpo da requisição.
 *
 * Quem realmente aperta o limite é a FICHA (80+ páginas de tabela com estilo
 * embutido em cada elemento) — e é só por causa dela que o fatiamento existe.
 * Estourar o limite = requisição recusada = ninguém imprime, já que não há plano
 * B por decisão do dono.
 *
 * 3MB deixa folga pro JSON.stringify e pros cabeçalhos por cima do HTML cru.
 */
export const MAX_BATCH_BYTES = 3 * 1024 * 1024;

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
export function splitHtmlIntoBatches(html: string, maxBytes = MAX_BATCH_BYTES): string[] {
  // Cabe inteiro? Vai numa chamada só — é o caso NORMAL das etiquetas, e é o que
  // evita pagar a partida do Chromium mais de uma vez.
  if (maxBytes <= 0 || html.length <= maxBytes) return [html];

  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!headMatch || !bodyMatch) return [html];

  const head = headMatch[1];
  const body = bodyMatch[1];
  const bodyOpenTag = (html.match(/<body[^>]*>/i) || ['<body>'])[0];

  // Quebra no início de cada folha, preservando o que vem antes da primeira.
  const parts = body.split(/(?=<section class="page|<div class="pagi-page)/);
  const pages = parts.filter(p => /class="(page|pagi-page)/.test(p));
  if (pages.length <= 1) return [html]; // nada a fatiar sem picar uma folha ao meio

  const preamble = parts.slice(0, parts.length - pages.length).join('');
  // Todo lote repete <head> + preâmbulo; esse peso conta contra o teto.
  const overhead = head.length + preamble.length + bodyOpenTag.length + 40;
  const montar = (fatia: string[]) =>
    `<!doctype html><html><head>${head}</head>${bodyOpenTag}${preamble}${fatia.join('')}</body></html>`;

  const batches: string[] = [];
  let atual: string[] = [];
  let tamanho = overhead;
  for (const pagina of pages) {
    // Folha sozinha maior que o teto: vai assim mesmo. Picar uma folha ao meio
    // produziria etiqueta cortada, que é pior que uma requisição grande.
    if (atual.length > 0 && tamanho + pagina.length > maxBytes) {
      batches.push(montar(atual));
      atual = [];
      tamanho = overhead;
    }
    atual.push(pagina);
    tamanho += pagina.length;
  }
  if (atual.length > 0) batches.push(montar(atual));
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

    // Lotes em PARALELO. Antes era um `for` com await: cada parte esperava a
    // anterior e pagava de novo os ~2s de partida do Chromium, somando o tempo
    // em fila. Como cada chamada é independente, o relógio passa a ser o do lote
    // mais lento, não a soma. `Promise.all` preserva a ORDEM do array — o que é
    // load-bearing aqui, senão o maço sai com as folhas embaralhadas.
    let prontos = 0;
    const buffers = await Promise.all(
      batches.map(lote =>
        renderBatch(lote, landscape).then(buf => {
          prontos += 1;
          if (batches.length > 1) {
            toast.loading(`Gerando PDF… (${prontos} de ${batches.length} partes)`, { id: toastId });
          }
          return buf;
        }),
      ),
    );

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
