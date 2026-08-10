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

  const { html, landscape } = (req.body || {}) as { html?: string; landscape?: boolean };

  if (typeof html !== 'string' || html.trim().length === 0) {
    return res.status(400).json({ error: 'Campo "html" é obrigatório.' });
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return res.status(413).json({ error: 'HTML grande demais — mande em lotes menores.' });
  }

  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

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
    return res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    console.error('[render-pdf] falhou:', message);
    // Sem plano B por decisão do dono: o app mostra o erro em vez de cair no modo
    // antigo, pra nunca sair documento fora do padrão.
    return res.status(500).json({ error: `Falha ao gerar o PDF: ${message}` });
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* nada a fazer */ }
    }
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
