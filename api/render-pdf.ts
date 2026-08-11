import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Renderiza HTML em PDF com Chromium headless.
 *
 * POR QUE ISTO EXISTE (10/08/2026): imprimir pelo navegador do CELULAR gerava uma
 * folha EM BRANCO depois de cada folha de etiquetas, e ainda carimbava o
 * cabeçalho do navegador (URL, data, "Página N de M") no papel.
 *
 * A causa é geométrica: a folha de rótulos soma 288mm (9 + 132 + 6 + 132 + 9) e o
 * A4 tem 297mm — 9mm de folga, que só existem porque o CSS pede
 * `@page{size:A4;margin:0}`. O Chrome do Android IGNORA esse @page e aplica as
 * margens dele (~10mm por lado): a área útil cai pra ~277mm, os 288mm não cabem, e
 * o padding branco de baixo transborda pra folha seguinte. As fichas de produção
 * têm exatamente a mesma folga de 9mm (PaginatedSheet: PAGE_HEIGHT_MM = 288), então
 * estavam armadas com o mesmo defeito.
 *
 * Aqui QUEM manda na geometria somos nós: `preferCSSPageSize` honra o @page do CSS,
 * `margin: 0` não inventa margem, e o cabeçalho/rodapé simplesmente não existe
 * (`displayHeaderFooter` é false por padrão). O mesmo HTML sai idêntico no celular,
 * no desktop e em qualquer impressora — que era o pedido do dono.
 *
 * ⚠ Esta função é BURRA de propósito: recebe HTML e devolve PDF. Ela não sabe o que
 * é um PV, não fala com o banco e não tem sessão. Fazer o Chromium abrir a página do
 * app exigiria carregar login e permissões aqui dentro, e qualquer mudança de rota
 * quebraria a impressão.
 */

/** Teto do corpo da requisição. O cliente manda HTML com as fotos por URL (não
 *  embutidas em base64) justamente pra caber com folga. */
export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
  // 300s é o padrão da plataforma (vale até no Hobby). Chromium + 40 páginas
  // resolve em segundos; o teto existe só como rede contra render travado.
  maxDuration: 300,
};

const MAX_HTML_BYTES = 4 * 1024 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  // O app manda POST de FORMULÁRIO (o navegador conduz a navegação e exibe o PDF
  // sozinho — ver o cabeçalho de src/lib/printPdf.ts). JSON continua aceito pra
  // teste por linha de comando.
  const body = (req.body || {}) as { html?: string; landscape?: unknown; filename?: string };
  const html = body.html;
  const landscape = body.landscape === true || body.landscape === '1';
  const filename = sanitizeFilename(body.filename) || 'documento';
  // Requisição vinda de formulário = quem lê a resposta é uma PESSOA numa aba.
  // Erro em JSON ali é lixo na tela; devolvemos HTML legível.
  const querHtml = String(req.headers.accept || '').includes('text/html');

  if (typeof html !== 'string' || html.trim().length === 0) {
    return fail(res, querHtml, 400, 'Documento vazio — nada para imprimir.');
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return fail(res, querHtml, 413,
      'Documento grande demais para gerar de uma vez. Imprima em partes.');
  }

  let page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['newPage']>> | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // `networkidle0` cobre as fotos dos produtos e o CSS do app, que vêm por URL.
    await page.setContent(html, { waitUntil: ['load', 'networkidle0'], timeout: 45_000 });

    // Sem isto o PDF sai com o CSS de TELA — e as fichas dependem do @media print
    // pra soltar a altura fixa das páginas.
    await page.emulateMediaType('print');

    // Fonte que não chegou = texto no fallback, e a etiqueta perde a identidade
    // (Anton no número da OP). Melhor esperar um pouco do que imprimir errado.
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);

    const pdf = await page.pdf({
      printBackground: true,   // faixas pretas e o vermelho #C00000 do destaque
      preferCSSPageSize: true, // manda o @page{size:A4;margin:0} do CSS valer
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      landscape: landscape === true,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Cache-Control', 'no-store');
    // `inline` faz o visualizador do aparelho ABRIR o PDF em vez de só baixar —
    // e o filename é o que aparece ao salvar ou compartilhar.
    res.setHeader('Content-Disposition', `inline; filename="${filename}.pdf"`);
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    console.error('[render-pdf] falhou:', message);
    // Sem plano B por decisão do dono: mostramos o erro em vez de cair no modo
    // antigo, pra nunca sair documento fora do padrão.
    return fail(res, querHtml, 500, `Falha ao gerar o PDF: ${message}`);
  } finally {
    // Fecha só a PÁGINA. O browser fica vivo pra próxima chamada — ver getBrowser.
    if (page) {
      try { await page.close(); } catch { /* nada a fazer */ }
    }
  }
}

/** Só o que vira nome de arquivo com segurança (o valor vem do cliente). */
function sanitizeFilename(raw?: string): string {
  return String(raw || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/**
 * Resposta de erro no formato que o CHAMADOR entende: HTML quando veio de um
 * formulário (uma pessoa olhando a aba), JSON quando é chamada programática.
 */
function fail(res: VercelResponse, querHtml: boolean, status: number, mensagem: string) {
  if (!querHtml) return res.status(status).json({ error: mensagem });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(
    `<!doctype html><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<body style="font-family:system-ui,sans-serif;padding:24px;color:#111;line-height:1.5">` +
    `<h2 style="color:#b00;margin:0 0 8px">Não foi possível gerar o PDF</h2>` +
    `<p>${mensagem.replace(/[<>&]/g, '')}</p>` +
    `<p style="color:#666">Feche esta aba e tente de novo.</p></body>`,
  );
}

/**
 * Chromium reaproveitado entre invocações.
 *
 * MEDIDO em 10/08/2026: subir o Chromium custa ~2s, e esse custo é FIXO —
 * renderizar 40 páginas leva o mesmo que renderizar 2. Na primeira versão a
 * função fechava o browser no `finally`, então DUAS chamadas seguidas custavam
 * 2,2s e 2,27s: a segunda não aproveitava nada da primeira.
 *
 * A Vercel reusa a instância da função entre requisições próximas, então guardar
 * a promessa no escopo do módulo faz as chamadas seguintes pularem a partida.
 * Guardamos a PROMESSA (não o browser resolvido) pra que duas requisições
 * simultâneas na mesma instância não subam dois Chromium.
 *
 * ⚠ Instância ociosa é reciclada pela plataforma e o browser morre junto; por
 * isso a checagem de `connected` antes de reusar, com relançamento silencioso.
 */
let browserPromise: Promise<Awaited<ReturnType<typeof launchBrowser>>> | null = null;

async function getBrowser() {
  if (browserPromise) {
    try {
      const existente = await browserPromise;
      const vivo = typeof (existente as { connected?: boolean }).connected === 'boolean'
        ? (existente as { connected: boolean }).connected
        : true;
      if (vivo) return existente;
    } catch {
      /* a partida anterior falhou — cai fora e tenta de novo */
    }
    browserPromise = null;
  }
  browserPromise = launchBrowser();
  try {
    return await browserPromise;
  } catch (err) {
    browserPromise = null; // não deixa uma falha envenenar as próximas chamadas
    throw err;
  }
}

/**
 * Chromium local em desenvolvimento, @sparticuz/chromium no serverless (o Chromium
 * completo não cabe no bundle da função).
 */
async function launchBrowser() {
  const puppeteer = (await import('puppeteer-core')).default;
  const isServerless = !!process.env.AWS_LAMBDA_FUNCTION_VERSION || !!process.env.VERCEL;

  if (!isServerless) {
    const executablePath =
      process.env.CHROME_EXECUTABLE_PATH || '/opt/pw-browsers/chromium';
    return puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  }

  const chromium = (await import('@sparticuz/chromium')).default;
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}
