import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

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

export type PrintWaitStage = 'preparing' | 'sending';

const WAIT_STAGE_TEXT: Record<PrintWaitStage, string> = {
  preparing: 'Preparando o documento…',
  sending: 'Enviando para o servidor…',
};

/**
 * Tela de espera da aba `about:blank`. Inline de propósito: a aba não herda
 * o CSS do app. Cores = Industrial Editorial Pro (PAPER / INK / Squad red).
 * Sem Google Fonts — a espera tem que pintar no primeiro frame.
 */
export function printWaitHtml(stage: PrintWaitStage = 'preparing', error?: string): string {
  const heading = error ? 'Não foi possível gerar o PDF' : 'Gerando PDF…';
  const stageText = error || WAIT_STAGE_TEXT[stage];
  const stageColor = error ? '#B00020' : '#0A0A0A';
  const spinner = error ? '' : `
    <div class="spin" aria-hidden="true"></div>`;
  const hint = error
    ? '<p class="hint">Feche esta aba e tente de novo.</p>'
    : '<p class="hint">Não feche esta aba. O arquivo abre aqui quando ficar pronto.</p>';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<title>Gerando PDF…</title>` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>
      :root { color-scheme: light; }
      html,body { height:100%; margin:0; background:#FAFAF7; color:#0A0A0A; }
      body { font-family: "Fira Sans", "Segoe UI", system-ui, sans-serif;
        display:flex; align-items:center; justify-content:center; padding:32px 20px; }
      .card { width:min(420px,100%); text-align:center; }
      .mark { width:36px; height:36px; margin:0 auto 20px; background:#D9264E;
        display:grid; place-items:center; }
      .mark span { font-family: Anton, Impact, sans-serif; color:#FAFAF7;
        font-size:22px; line-height:1; letter-spacing:.02em; }
      .kicker { font-family: "Fira Code", ui-monospace, monospace; font-size:10px;
        letter-spacing:.16em; text-transform:uppercase; color:#6B6560; margin:0 0 8px; }
      h1 { font-family: Anton, Impact, sans-serif; font-size:28px; line-height:1;
        text-transform:uppercase; letter-spacing:.02em; margin:0 0 12px; font-weight:400; }
      #pdf-wait-stage { font-size:15px; line-height:1.4; margin:0 0 8px; color:${stageColor}; }
      .hint { font-size:13px; line-height:1.45; color:#6B6560; margin:16px 0 0; }
      .spin { width:28px; height:28px; margin:20px auto 0; border:2.5px solid #E6E1DA;
        border-top-color:#D9264E; border-radius:50%; animation:spin .7s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style></head><body>
    <div class="card">
      <div class="mark" aria-hidden="true"><span>S</span></div>
      <p class="kicker">Squad Shoes</p>
      <h1>${heading}</h1>
      <p id="pdf-wait-stage">${stageText}</p>
      ${hint}${spinner}
    </div></body></html>`;
}

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
  /** Job criado antes do envio. Aceita Promise pra correr em paralelo com a sessão. */
  jobId?: string | Promise<string>;
}

type SessionResult = Awaited<ReturnType<typeof supabase.auth.getSession>>;
let sessionPrefetch: Promise<SessionResult> | null = null;

function prefetchPrintSession() {
  sessionPrefetch = supabase.auth.getSession();
  return sessionPrefetch;
}

/**
 * Atualiza o estágio da aba de espera. Só funciona enquanto ela ainda é HTML
 * (antes do POST). Depois do submit o navegador conduz a navegação.
 */
export function setPrintTabStage(tab: Window | null, stage: PrintWaitStage, error?: string) {
  if (!tab || tab.closed) return;
  try {
    if (error) {
      tab.document.open();
      tab.document.write(printWaitHtml(stage, error));
      tab.document.close();
      return;
    }
    const el = tab.document.getElementById('pdf-wait-stage');
    if (el) {
      el.textContent = WAIT_STAGE_TEXT[stage];
      return;
    }
    tab.document.open();
    tab.document.write(printWaitHtml(stage));
    tab.document.close();
  } catch { /* aba já exibindo um PDF ou navegou */ }
}

/**
 * Abre a aba de destino, JÁ NOMEADA. Tem que ser chamado DENTRO do clique, de
 * forma síncrona: abrir depois de um `await` faz o celular tratar como pop-up.
 *
 * Já dispara `getSession()` — o HTML ainda vai ser montado, e a sessão fica
 * pronta quando `printHtmlAsPdf` precisar dela.
 */
export function openPrintTab(): Window | null {
  prefetchPrintSession();
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
    w?.document.write(printWaitHtml('preparing'));
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
  setPrintTabStage(tab, 'preparing', msg);
}

/**
 * Manda o HTML pro servidor e deixa o NAVEGADOR exibir o PDF na aba.
 *
 * Devolve `true` quando o envio foi disparado — o resultado em si aparece na
 * aba, porque quem conduz a navegação daqui em diante é o browser.
 */
export async function printHtmlAsPdf(html: string, opts: PrintPdfOptions): Promise<boolean> {
  const { filename, landscape = false } = opts;
  const tab = opts.target ?? null;
  const sessionPromise = sessionPrefetch ?? supabase.auth.getSession();
  sessionPrefetch = null;
  const jobPromise = Promise.resolve(opts.jobId);

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

  setPrintTabStage(tab, 'sending');

  const [{ data: { session }, error: sessionError }, jobId] = await Promise.all([
    sessionPromise,
    jobPromise,
  ]);
  if (sessionError || !session?.access_token) {
    const msg = 'Sua sessão expirou. Entre novamente antes de gerar o PDF.';
    toast.error(msg, { duration: 10_000 });
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
  campo('access_token', session.access_token);
  if (jobId) campo('job_id', jobId);
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
  toast('O PDF abre na outra aba.', { duration: 4_000 });
  return true;
}
