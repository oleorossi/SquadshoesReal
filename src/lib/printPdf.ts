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
 * avisa e NÃO imprime, em vez de cair no caminho antigo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE É UM POST DE FORMULÁRIO E NÃO UM `fetch` (correção de 11/08/2026)
 * ────────────────────────────────────────────────────────────────────────────
 * A primeira versão fazia `fetch` → `Blob` → `URL.createObjectURL` → apontava a
 * aba pro `blob:`. No iPhone a aba ficava PARADA no "Gerando o PDF…" e o arquivo
 * nunca aparecia. Duas causas, ambas do desenho, e ambas invisíveis no desktop:
 *
 *   1. Ao abrir a aba nova, o Safari SUSPENDE a aba de origem — que é justamente
 *      quem estava esperando o `fetch`. A promessa nunca resolve, então nem o
 *      sucesso nem o `catch` (que escreveria o erro na aba) chegam a rodar. Daí
 *      a tela congelada na mensagem de espera, sem erro nenhum.
 *   2. O iOS trata navegação para `blob:` com restrição; o CSP do site também só
 *      libera `blob:` em `img-src`.
 *
 * Com um POST de formulário quem baixa e exibe é o NAVEGADOR, numa navegação
 * comum: não há promessa pendurada na aba suspensa, não há `blob:`, e o PDF
 * chega como resposta HTTP normal (`application/pdf`), que o visualizador do
 * aparelho abre sozinho. É também menos código do que antes.
 *
 * ⚠ A aba precisa ser aberta NO TOQUE (openPrintTab) e ter NOME: o `submit`
 * acontece depois do preparo assíncrono, quando o gesto do usuário já passou —
 * mirar numa janela que já existe é o que evita o bloqueio de pop-up.
 */

/** Nome da aba de destino. O formulário mira nele — ver openPrintTab. */
const PRINT_TAB_NAME = 'squad-pdf';

/**
 * Teto de bytes do documento.
 *
 * O corpo de uma requisição na Vercel é limitado a ~4,5MB. Etiqueta é leve — 120
 * rótulos medidos dão **24KB** —, mas a ficha é densa (tabelas com estilo
 * embutido em cada elemento). Acima disso a requisição é recusada, e como não há
 * plano B o usuário precisa saber ANTES, com uma mensagem que diz o que fazer.
 */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export interface PrintPdfOptions {
  /** Nome do arquivo, sem extensão (ex.: 'etiquetas-PV-00151'). */
  filename: string;
  /** Documentos em paisagem (cartões de lote 12/A4). */
  landscape?: boolean;
  /** Aba aberta ANTES de gerar — ver openPrintTab. */
  target?: Window | null;
}

/**
 * Abre a aba de destino, JÁ NOMEADA. Tem que ser chamado DENTRO do clique, de
 * forma síncrona: abrir depois de um `await` faz o celular tratar como pop-up.
 */
export function openPrintTab(): Window | null {
  const w = window.open('', PRINT_TAB_NAME);
  // ⚠ O try/catch NÃO é decorativo. Na SEGUNDA geração, `window.open` com o mesmo
  // nome devolve a aba que já existe — e ela está exibindo um PDF. Escrever num
  // documento PDF lança, e sem proteção o erro subia até a primeira linha do
  // handler de impressão, abortando tudo ANTES do primeiro await: sem toast, sem
  // erro na tela, sem arquivo. Era o "depois eu não consigo gerar o PDF".
  //
  // A aba segue sendo REUSADA (nome fixo) pra não multiplicar abas no celular.
  // Quando ela já tem um PDF, o usuário vê o arquivo antigo até o novo chegar —
  // melhor que a tela travar.
  try {
    w?.document.write(
      '<!doctype html><meta charset="utf-8"><title>Gerando PDF…</title>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="font-family:system-ui,sans-serif;padding:24px;color:#111">' +
      '<p>Gerando o PDF… pode levar alguns segundos.</p></body>',
    );
    w?.document.close();
  } catch { /* aba já exibindo um PDF — segue com ela mesmo assim */ }
  return w;
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

/** Escreve uma mensagem legível na aba de destino (erro antes de submeter). */
function avisarNaAba(tab: Window | null, msg: string) {
  if (!tab || tab.closed) return;
  try {
    tab.document.body.innerHTML =
      `<p style="font-family:system-ui,sans-serif;padding:24px;color:#b00;line-height:1.5">${msg}</p>`;
  } catch { /* aba já navegou pra outro lugar */ }
}

/**
 * Manda o HTML pro servidor e deixa o NAVEGADOR exibir o PDF na aba.
 *
 * Devolve `true` quando o envio foi disparado — o resultado em si aparece na
 * aba, porque quem conduz a navegação daqui em diante é o browser.
 */
export function printHtmlAsPdf(html: string, opts: PrintPdfOptions): boolean {
  const { filename, landscape = false } = opts;
  const tab = opts.target ?? null;

  const bytes = new Blob([html]).size;
  if (bytes > MAX_DOCUMENT_BYTES) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    const msg =
      `Documento grande demais pra gerar de uma vez (${mb}MB). ` +
      `Imprima em partes — por exemplo, menos setores ou menos OPs por vez.`;
    toast.error(msg, { duration: 12_000 });
    avisarNaAba(tab, msg);
    return false;
  }

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/render-pdf';
  form.target = PRINT_TAB_NAME;   // a aba já existe e é nossa: sem bloqueio de pop-up
  form.style.display = 'none';
  form.acceptCharset = 'UTF-8';

  const campo = (nome: string, valor: string) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = nome;
    input.value = valor;
    form.appendChild(input);
  };
  campo('html', html);
  campo('filename', filename);
  if (landscape) campo('landscape', '1');

  document.body.appendChild(form);
  try {
    form.submit();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro desconhecido';
    toast.error(`Não foi possível enviar o documento: ${msg}`, { duration: 10_000 });
    avisarNaAba(tab, `Falha ao enviar o documento: ${msg}`);
    return false;
  } finally {
    form.remove();
  }
  return true;
}
