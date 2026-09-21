import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Renderiza HTML em PDF com Chromium headless (Browserless ou @sparticuz).
 *
 * POR QUE ISTO EXISTE (10/08/2026): imprimir pelo navegador do CELULAR gerava uma
 * folha EM BRANCO depois de cada folha de etiquetas, e ainda carimbava o
 * cabeçalho do navegador (URL, data, "Página N de M") no papel.
 *
 * Fila async (pdf speed overhaul): POST com `async=1` grava HTML no Storage
 * `pdf-queue`, cria `pdf_render_jobs` e devolve HTML de espera com poll.
 * GET `?job=` autentica, inicia o render se `pending`, devolve 202 enquanto
 * outro worker já pegou, PDF inline se `ready`, HTML/JSON de erro se `failed`.
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
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;
const WARM_RATE_LIMIT = 30;
const PDF_QUEUE_BUCKET = 'pdf-queue';
const rateByUser = new Map<string, number[]>();
const warmByUser = new Map<string, number[]>();

/**
 * A função serverless é empacotada sem os módulos do front-end em `src/`.
 * Esta allowlist fica propositalmente aqui para que a proteção contra SSRF viaje
 * junto com `api/render-pdf.ts`; importar a versão do browser fez a função cair
 * ainda no carregamento do módulo na Vercel.
 */
function isAllowedPrintResource(raw: string, allowedHosts: Set<string>, isLocal = false): boolean {
  if (raw.startsWith('data:') || raw.startsWith('blob:') || raw === 'about:blank') return true;
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) return false;
  const host = url.hostname.toLowerCase();
  if (allowedHosts.has(host)) return true;
  if (host.endsWith('.supabase.co') || host.endsWith('.supabase.in')) return true;
  return host === 'fonts.googleapis.com'
    || host === 'fonts.gstatic.com'
    || host === 'cdn.jsdelivr.net'
    || host === 'cdnjs.cloudflare.com';
}

/**
 * Espelho de `src/lib/pdfRenderWaits.ts`. Vive AQUI (não num import relativo)
 * porque `package.json` é `"type": "module"`: `from './x'` sem `.js` derruba
 * a função no Node da Vercel (FUNCTION_INVOCATION_FAILED). Importar `src/`
 * também já derrubou o módulo. O contrato em pdfRenderWaits.test.ts trava
 * os dois corpos iguais.
 */
const FONT_HOST = /(?:fonts\.googleapis\.com|fonts\.gstatic\.com)/i;
const ABSOLUTE_URL = /https?:\/\/[^\s"'<>)\\]+/gi;
const TRACE_CODE = /id\s*=\s*["'](?:bc-|bx-|qr-ht-)/i;

interface PdfRenderWaits {
  waitForNetworkIdle: boolean;
  waitForTraceCodes: boolean;
}

function inspectPdfHtml(html: string): PdfRenderWaits {
  const urls = html.match(ABSOLUTE_URL) || [];
  return {
    waitForNetworkIdle: urls.some((url) => !FONT_HOST.test(url)),
    waitForTraceCodes: TRACE_CODE.test(html),
  };
}

type RequestBody = {
  html?: string;
  landscape?: unknown;
  filename?: string;
  access_token?: string;
  job_id?: string;
  async?: unknown;
};

type PdfRenderJob = {
  id: string;
  user_id: string;
  status: 'pending' | 'rendering' | 'ready' | 'failed';
  storage_path: string;
  pdf_storage_path: string | null;
  filename: string;
  landscape: boolean;
  print_job_id: string | null;
  error: string | null;
};

function consumeRateSlot(
  store: Map<string, number[]>,
  userId: string,
  limit: number,
  now = Date.now(),
): boolean {
  const valid = (store.get(userId) || []).filter(ts => now - ts < RATE_WINDOW_MS);
  if (valid.length >= limit) {
    store.set(userId, valid);
    return false;
  }
  valid.push(now);
  store.set(userId, valid);
  return true;
}

function serverSupabase(accessToken: string) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado no servidor.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function bearerToken(req: VercelRequest): string {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function queryToken(req: VercelRequest): string {
  const raw = req.query.access_token;
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0].trim();
  return '';
}

async function authenticateApprovedUser(accessToken: string) {
  const db = serverSupabase(accessToken);
  const { data: authData, error: authError } = await db.auth.getUser(accessToken);
  if (authError || !authData.user) {
    throw Object.assign(new Error('Sessão inválida ou expirada.'), { status: 401 });
  }
  const userId = authData.user.id;
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('approved')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile?.approved) {
    throw Object.assign(new Error('Usuário sem aprovação para gerar documentos.'), { status: 403 });
  }
  return { db, userId };
}

/**
 * GET aquece o Chromium da MESMA função do POST. Um arquivo `api/` irmão
 * subiria outro isolate e o cold start do PDF continuaria intacto.
 * Com Browserless o warm vira um connect barato (ou no-op se já conectado).
 */
async function warmBrowser(req: VercelRequest, res: VercelResponse) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Sessão ausente. Entre novamente no sistema.' });
  try {
    const { userId } = await authenticateApprovedUser(token);
    if (!consumeRateSlot(warmByUser, userId, WARM_RATE_LIMIT)) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Muitos aquecimentos em sequência. Aguarde um minuto.' });
    }
    await getBrowser();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(204).end();
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    const message = error instanceof Error ? error.message : 'Falha de autenticação.';
    return res.status(status).json({ error: message });
  }
}

function wantsJson(req: VercelRequest): boolean {
  return String(req.headers.accept || '').includes('application/json');
}

function jobQueryId(req: VercelRequest): string {
  const raw = req.query.job;
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0].trim();
  return '';
}

async function loadJob(
  db: SupabaseClient,
  jobId: string,
  userId: string,
): Promise<PdfRenderJob | null> {
  const { data, error } = await db
    .from('pdf_render_jobs')
    .select('id,user_id,status,storage_path,pdf_storage_path,filename,landscape,print_job_id,error')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as PdfRenderJob;
}

async function markPrintJob(
  db: SupabaseClient,
  printJobId: string | null | undefined,
  userId: string,
  status: 'generated' | 'failed',
) {
  if (!printJobId) return;
  try {
    await db.from('print_jobs').update({ status }).eq('id', printJobId).eq('user_id', userId);
  } catch { /* auditoria secundária */ }
}

async function streamStoredPdf(
  db: SupabaseClient,
  job: PdfRenderJob,
  res: VercelResponse,
) {
  if (!job.pdf_storage_path) {
    return res.status(500).json({ error: 'PDF pronto sem caminho no Storage.' });
  }
  const { data, error } = await db.storage.from(PDF_QUEUE_BUCKET).download(job.pdf_storage_path);
  if (error || !data) {
    return res.status(500).json({ error: 'Não foi possível ler o PDF gerado.' });
  }
  const buf = Buffer.from(await data.arrayBuffer());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(job.filename)}.pdf"`);
  // Limpeza best-effort: HTML + PDF após servir (TTL curto).
  void db.storage.from(PDF_QUEUE_BUCKET).remove(
    [job.storage_path, job.pdf_storage_path].filter(Boolean),
  );
  return res.status(200).send(buf);
}

async function renderHtmlToPdf(html: string, landscape: boolean): Promise<Buffer> {
  let page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['newPage']>> | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    const allowedHosts = new Set<string>([
      'squadshoes-real.vercel.app',
      ...(process.env.VERCEL_URL ? [process.env.VERCEL_URL] : []),
      ...(process.env.PRINT_ALLOWED_RESOURCE_HOSTS || '').split(',').map(v => v.trim()).filter(Boolean),
    ].map(v => v.toLowerCase()));
    const isLocal = !process.env.VERCEL;
    if (isLocal) {
      allowedHosts.add('localhost');
      allowedHosts.add('127.0.0.1');
    }
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (isAllowedPrintResource(request.url(), allowedHosts, isLocal)) request.continue();
      else request.abort('blockedbyclient');
    });

    const waits = inspectPdfHtml(html);

    await page.setContent(html, { waitUntil: 'load', timeout: 45_000 });
    if (waits.waitForNetworkIdle) {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 45_000 });
    }

    await page.emulateMediaType('print');
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);

    if (waits.waitForTraceCodes) {
      await page.waitForFunction(() => {
        const barcodes = Array.from(document.querySelectorAll<SVGElement>('svg[id^="bc-"],svg[id^="bx-"]'));
        const qrs = Array.from(document.querySelectorAll<HTMLElement>('[id^="qr-ht-"]'));
        return barcodes.every(el => el.childElementCount > 0)
          && qrs.every(el => el.querySelector('canvas,img') !== null);
      }, { timeout: 12_000 });
    }

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      landscape: landscape === true,
    });
    return Buffer.from(pdf);
  } finally {
    if (page) {
      try { await page.close(); } catch { /* nada a fazer */ }
    }
  }
}

async function claimAndRenderJob(
  db: SupabaseClient,
  userId: string,
  job: PdfRenderJob,
  req: VercelRequest,
  res: VercelResponse,
) {
  const { data: claimed, error: claimError } = await db
    .from('pdf_render_jobs')
    .update({ status: 'rendering', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('id,user_id,status,storage_path,pdf_storage_path,filename,landscape,print_job_id,error')
    .maybeSingle();

  if (claimError) {
    return jsonOrHtml(req, res, 500, { status: 'failed', error: claimError.message });
  }
  if (!claimed) {
    // Outro worker pegou — poll de novo.
    return jsonOrHtml(req, res, 202, { status: 'rendering' });
  }

  try {
    const { data: htmlBlob, error: dlError } = await db.storage
      .from(PDF_QUEUE_BUCKET)
      .download(job.storage_path);
    if (dlError || !htmlBlob) {
      throw new Error(dlError?.message || 'HTML do job não encontrado no Storage.');
    }
    const html = await htmlBlob.text();
    const pdfBuf = await renderHtmlToPdf(html, job.landscape === true);
    const pdfPath = `${userId}/${job.id}.pdf`;
    const { error: upError } = await db.storage.from(PDF_QUEUE_BUCKET).upload(pdfPath, pdfBuf, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (upError) throw new Error(upError.message);

    const { error: readyError } = await db
      .from('pdf_render_jobs')
      .update({
        status: 'ready',
        pdf_storage_path: pdfPath,
        updated_at: new Date().toISOString(),
        ready_at: new Date().toISOString(),
        error: null,
      })
      .eq('id', job.id)
      .eq('user_id', userId);
    if (readyError) throw new Error(readyError.message);

    await markPrintJob(db, job.print_job_id, userId, 'generated');

    if (wantsJson(req)) {
      return res.status(200).json({ status: 'ready' });
    }
    return streamStoredPdf(db, { ...job, pdf_storage_path: pdfPath, status: 'ready' }, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    console.error('[render-pdf] job falhou:', job.id, message);
    await db
      .from('pdf_render_jobs')
      .update({
        status: 'failed',
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('user_id', userId);
    await markPrintJob(db, job.print_job_id, userId, 'failed');
    return jsonOrHtml(req, res, 500, { status: 'failed', error: `Falha ao gerar o PDF: ${message}` });
  }
}

function jsonOrHtml(
  req: VercelRequest,
  res: VercelResponse,
  status: number,
  body: { status: string; error?: string },
) {
  if (wantsJson(req)) {
    return res.status(status).json(body);
  }
  if (status === 202) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(202).send(waitPageHtml('Renderizando…'));
  }
  return fail(res, true, status, body.error || 'Falha ao gerar o PDF.');
}

function waitPageHtml(stageText: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<title>Gerando PDF…</title>` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>
      html,body{height:100%;margin:0;background:#FAFAF7;color:#0A0A0A;
        font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
      .spin{width:28px;height:28px;margin:20px auto 0;border:2.5px solid #E6E1DA;
        border-top-color:#D9264E;border-radius:50%;animation:spin .7s linear infinite}
      @keyframes spin{to{transform:rotate(360deg)}}
    </style></head><body>
    <div style="text-align:center"><h1 style="font-size:22px;margin:0 0 8px">Gerando PDF…</h1>
    <p>${stageText.replace(/[<>&]/g, '')}</p><div class="spin"></div></div></body></html>`;
}

/**
 * Poll / conclusão do job. JSON (Accept) pra o script da aba; navegação comum
 * devolve o PDF quando ready.
 */
async function pollJob(req: VercelRequest, res: VercelResponse) {
  const jobId = jobQueryId(req);
  if (!jobId) {
    return res.status(400).json({ error: 'Parâmetro job ausente.' });
  }
  const token = queryToken(req) || bearerToken(req);
  if (!token) {
    return jsonOrHtml(req, res, 401, { status: 'failed', error: 'Sessão ausente. Entre novamente no sistema.' });
  }

  let db: ReturnType<typeof serverSupabase>;
  let userId = '';
  try {
    const auth = await authenticateApprovedUser(token);
    db = auth.db;
    userId = auth.userId;
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    const message = error instanceof Error ? error.message : 'Falha de autenticação.';
    return jsonOrHtml(req, res, status, { status: 'failed', error: message });
  }

  const job = await loadJob(db, jobId, userId);
  if (!job) {
    return jsonOrHtml(req, res, 404, { status: 'failed', error: 'Job de PDF não encontrado.' });
  }

  if (job.status === 'ready') {
    if (wantsJson(req)) return res.status(200).json({ status: 'ready' });
    return streamStoredPdf(db, job, res);
  }
  if (job.status === 'failed') {
    return jsonOrHtml(req, res, 500, {
      status: 'failed',
      error: job.error || 'Falha ao gerar o PDF.',
    });
  }
  if (job.status === 'rendering') {
    return jsonOrHtml(req, res, 202, { status: 'rendering' });
  }
  // pending → claim + render
  return claimAndRenderJob(db, userId, job, req, res);
}

/** Espelho mínimo de printJobWaitHtml — sem importar src/ (quebra o isolate). */
function enqueueWaitHtml(jobId: string, accessToken: string): string {
  const safeJob = JSON.stringify(jobId);
  const safeToken = JSON.stringify(accessToken);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<title>Gerando PDF…</title>` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>
      :root{color-scheme:light}
      html,body{height:100%;margin:0;background:#FAFAF7;color:#0A0A0A}
      body{font-family:"Fira Sans","Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:32px 20px}
      .card{width:min(420px,100%);text-align:center}
      .mark{width:36px;height:36px;margin:0 auto 20px;background:#D9264E;display:grid;place-items:center}
      .mark span{font-family:Anton,Impact,sans-serif;color:#FAFAF7;font-size:22px;line-height:1}
      .kicker{font-family:"Fira Code",ui-monospace,monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6B6560;margin:0 0 8px}
      h1{font-family:Anton,Impact,sans-serif;font-size:28px;line-height:1;text-transform:uppercase;margin:0 0 12px;font-weight:400}
      #pdf-wait-stage{font-size:15px;line-height:1.4;margin:0 0 8px;color:#0A0A0A}
      .hint{font-size:13px;line-height:1.45;color:#6B6560;margin:16px 0 0}
      .spin{width:28px;height:28px;margin:20px auto 0;border:2.5px solid #E6E1DA;border-top-color:#D9264E;border-radius:50%;animation:spin .7s linear infinite}
      @keyframes spin{to{transform:rotate(360deg)}}
    </style></head><body>
    <div class="card">
      <div class="mark" aria-hidden="true"><span>S</span></div>
      <p class="kicker">Squad Shoes</p>
      <h1>Gerando PDF…</h1>
      <p id="pdf-wait-stage">Na fila…</p>
      <p class="hint">Não feche esta aba. O arquivo abre aqui quando ficar pronto.</p>
      <div class="spin" aria-hidden="true"></div>
    </div>
    <script>(function(){
  var job=${safeJob}, token=${safeToken};
  var stageEl=document.getElementById('pdf-wait-stage');
  function setStage(t){ if(stageEl) stageEl.textContent=t; }
  function showError(msg){
    var safe=String(msg||'erro').replace(/[<>&]/g,'');
    document.open();
    document.write('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      +'<body style="font-family:system-ui,sans-serif;padding:24px;color:#111;line-height:1.5">'
      +'<h2 style="color:#b00;margin:0 0 8px">Não foi possível gerar o PDF</h2>'
      +'<p>'+safe+'</p><p style="color:#666">Feche esta aba e tente de novo.</p></body>');
    document.close();
  }
  function poll(){
    var statusUrl='/api/render-pdf?job='+encodeURIComponent(job)
      +'&access_token='+encodeURIComponent(token);
    setStage('Renderizando…');
    fetch(statusUrl,{
      headers:{'Accept':'application/json','Authorization':'Bearer '+token},
      credentials:'same-origin'
    }).then(function(r){
      return r.json().then(function(data){
        if(!r.ok && !(r.status===202 && data && data.status)){
          showError((data && data.error) || ('HTTP '+r.status));
          return;
        }
        var st=data && data.status;
        if(st==='pending'){ setStage('Na fila…'); setTimeout(poll,700); return; }
        if(st==='rendering'){ setStage('Renderizando…'); setTimeout(poll,900); return; }
        if(st==='ready'){ setStage('Pronto — abrindo…'); window.location.replace(statusUrl); return; }
        if(st==='failed'){ showError((data && data.error) || 'Falha ao gerar o PDF.'); return; }
        showError('Resposta inesperada do servidor.');
      });
    }).catch(function(err){
      showError(err && err.message ? err.message : 'Falha de rede ao consultar o job.');
    });
  }
  setTimeout(poll,120);
})();</script>
    </body></html>`;
}

async function enqueueAsyncJob(
  db: SupabaseClient,
  userId: string,
  html: string,
  filename: string,
  landscape: boolean,
  printJobId: string | undefined,
  accessToken: string,
  res: VercelResponse,
) {
  const jobId = randomUUID();
  const storagePath = `${userId}/${jobId}.html`;

  const { error: uploadError } = await db.storage.from(PDF_QUEUE_BUCKET).upload(
    storagePath,
    Buffer.from(html, 'utf8'),
    { contentType: 'text/html; charset=utf-8', upsert: false },
  );
  if (uploadError) {
    return fail(res, true, 500, `Não foi possível enfileirar o documento: ${uploadError.message}`);
  }

  const { error: insertError } = await db.from('pdf_render_jobs').insert({
    id: jobId,
    user_id: userId,
    status: 'pending',
    storage_path: storagePath,
    filename,
    landscape,
    print_job_id: printJobId || null,
  });
  if (insertError) {
    void db.storage.from(PDF_QUEUE_BUCKET).remove([storagePath]);
    return fail(res, true, 500, `Não foi possível criar o job de PDF: ${insertError.message}`);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(enqueueWaitHtml(jobId, accessToken));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (jobQueryId(req)) return pollJob(req, res);
    return warmBrowser(req, res);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, HEAD, POST');
    return res.status(405).json({ error: 'Use POST para gerar, GET para aquecer ou consultar job.' });
  }

  // O app manda POST de FORMULÁRIO (o navegador conduz a navegação e exibe a
  // espera / PDF sozinho — ver o cabeçalho de src/lib/printPdf.ts). JSON
  // continua aceito pra teste por linha de comando.
  const body = (req.body || {}) as RequestBody;
  const html = body.html;
  const landscape = body.landscape === true || body.landscape === '1';
  const filename = sanitizeFilename(body.filename) || 'documento';
  const asyncMode = body.async === true || body.async === '1';
  // Requisição vinda de formulário = quem lê a resposta é uma PESSOA numa aba.
  // Erro em JSON ali é lixo na tela; devolvemos HTML legível.
  const querHtml = String(req.headers.accept || '').includes('text/html') || asyncMode;

  if (!body.access_token) {
    return fail(res, querHtml, 401, 'Sessão ausente. Entre novamente no sistema.');
  }

  let userId = '';
  let db: ReturnType<typeof serverSupabase>;
  try {
    const auth = await authenticateApprovedUser(body.access_token);
    db = auth.db;
    userId = auth.userId;
    if (!consumeRateSlot(rateByUser, userId, RATE_LIMIT)) {
      res.setHeader('Retry-After', '60');
      return fail(res, querHtml, 429, 'Muitas gerações em sequência. Aguarde um minuto.');
    }
    if (body.job_id) {
      const { data: job } = await db.from('print_jobs').select('user_id').eq('id', body.job_id).maybeSingle();
      if (!job || job.user_id !== userId) {
        return fail(res, querHtml, 403, 'Lote de impressão inválido para esta sessão.');
      }
    }
  } catch (error) {
    const status = typeof (error as { status?: number }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    const message = error instanceof Error ? error.message : 'Falha de autenticação.';
    return fail(res, querHtml, status, message);
  }

  if (typeof html !== 'string' || html.trim().length === 0) {
    return fail(res, querHtml, 400, 'Documento vazio — nada para imprimir.');
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return fail(res, querHtml, 413,
      'Documento grande demais para gerar de uma vez. Imprima em partes.');
  }

  if (asyncMode) {
    return enqueueAsyncJob(
      db,
      userId,
      html,
      filename,
      landscape,
      body.job_id,
      body.access_token,
      res,
    );
  }

  // Caminho síncrono legado (CLI / testes sem async).
  try {
    const pdf = await renderHtmlToPdf(html, landscape);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename="${filename}.pdf"`);
    if (body.job_id) {
      await markPrintJob(db, body.job_id, userId, 'generated');
    }
    return res.status(200).send(pdf);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    console.error('[render-pdf] falhou:', message);
    await markPrintJob(db, body.job_id, userId, 'failed');
    return fail(res, querHtml, 500, `Falha ao gerar o PDF: ${message}`);
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
 * Preferência: Browserless cloud (`BROWSERLESS_URL` = WebSocket endpoint com
 * token). Fallback: Chromium local em dev, `@sparticuz/chromium` no serverless.
 */
async function launchBrowser() {
  const puppeteer = (await import('puppeteer-core')).default;
  const browserlessUrl = (process.env.BROWSERLESS_URL || '').trim();
  if (browserlessUrl) {
    return puppeteer.connect({ browserWSEndpoint: browserlessUrl });
  }

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
