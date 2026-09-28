import { isIosBrowser } from '@/lib/iosDevice';
import {
  beginPdfDelivery,
  closePdfDelivery,
  isPdfDeliveryCancelled,
  markPdfShareFailed,
  setPdfDeliveryError,
  setPdfDeliveryReady,
  setPdfDeliveryStage,
  type PdfDeliveryStage,
} from '@/lib/pdfDeliveryStore';

export { isIosBrowser };

function ensurePdfName(filename: string): string {
  const base = String(filename || 'documento').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'documento';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function buildFile(bytes: Uint8Array, filename: string): File {
  return new File([toArrayBuffer(bytes)], ensurePdfName(filename), {
    type: 'application/pdf',
  });
}

/** Tenta a folha nativa do iOS (WhatsApp, Arquivos, Mail…). */
export async function sharePdfFile(bytes: Uint8Array, filename: string, title?: string): Promise<void> {
  const file = buildFile(bytes, filename);
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };
  if (typeof nav.share !== 'function') {
    throw new Error('Este aparelho não oferece compartilhar arquivos.');
  }
  const payload: ShareData = { files: [file], title: title || file.name };
  if (typeof nav.canShare === 'function' && !nav.canShare(payload)) {
    throw new Error('Não foi possível compartilhar este PDF neste aparelho.');
  }
  await nav.share(payload);
}

/** Tentativa de download via &lt;a download&gt; — no iOS costuma ser frágil. */
export function downloadPdfFile(bytes: Uint8Array, filename: string): void {
  const name = ensurePdfName(filename);
  const blob = new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Entrega bytes de PDF: no iOS abre o overlay de ações; nos demais baixa direto.
 */
export function deliverPdfBytes(
  bytes: Uint8Array,
  opts: { filename: string; title: string },
): void {
  const filename = ensurePdfName(opts.filename);
  if (!isIosBrowser()) {
    downloadPdfFile(bytes, filename);
    return;
  }
  beginPdfDelivery({ title: opts.title, filename });
  setPdfDeliveryStage('preparing');
  setPdfDeliveryReady({ bytes, filename });
}

/** jsPDF → bytes → deliverPdfBytes. */
export function deliverJsPdf(
  doc: { output: (type: 'arraybuffer') => ArrayBuffer },
  filename: string,
  title: string,
): void {
  const bytes = new Uint8Array(doc.output('arraybuffer'));
  deliverPdfBytes(bytes, { filename, title });
}

export async function openPdfInSafari(safariUrl: string): Promise<void> {
  if (!safariUrl) throw new Error('Link do PDF indisponível.');
  // `_blank` no PWA iOS costuma abrir no Safari (fora do standalone).
  const opened = window.open(safariUrl, '_blank', 'noopener,noreferrer');
  if (!opened) {
    // Último recurso: navegar a própria janela.
    window.location.assign(safariUrl);
  }
}

export interface RenderPdfClientOptions {
  html: string;
  filename: string;
  title: string;
  accessToken: string;
  landscape?: boolean;
  jobId?: string;
  onStage?: (stage: PdfDeliveryStage) => void;
  signal?: AbortSignal;
}

/**
 * Enfileira + poll + baixa bytes do `/api/render-pdf` sem abrir aba.
 * Usado só no caminho iOS (a origem permanece ativa — sem suspender por pop-up).
 */
export async function renderPdfBytesClient(opts: RenderPdfClientOptions): Promise<{
  bytes: Uint8Array;
  safariUrl: string;
  filename: string;
}> {
  const filename = ensurePdfName(opts.filename).replace(/\.pdf$/i, '');
  const notify = (stage: PdfDeliveryStage) => {
    opts.onStage?.(stage);
    setPdfDeliveryStage(stage);
  };

  notify('sending');

  const body = new URLSearchParams();
  body.set('html', opts.html);
  body.set('filename', filename);
  body.set('access_token', opts.accessToken);
  body.set('async', '1');
  if (opts.landscape) body.set('landscape', '1');
  if (opts.jobId) body.set('job_id', opts.jobId);

  const post = await fetch('/api/render-pdf', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body,
    signal: opts.signal,
  });

  const postJson = await post.json().catch(() => ({} as { error?: string; job?: string }));
  if (!post.ok) {
    throw new Error(postJson.error || `Falha ao enfileirar o PDF (HTTP ${post.status}).`);
  }
  const jobId = postJson.job;
  if (!jobId || typeof jobId !== 'string') {
    throw new Error('Servidor não devolveu o job do PDF.');
  }

  const statusUrl =
    `/api/render-pdf?job=${encodeURIComponent(jobId)}` +
    `&access_token=${encodeURIComponent(opts.accessToken)}`;
  const safariUrl = statusUrl;

  notify('queued');

  for (;;) {
    if (opts.signal?.aborted || isPdfDeliveryCancelled()) {
      throw new DOMException('Cancelled', 'AbortError');
    }
    const poll = await fetch(statusUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${opts.accessToken}`,
      },
      credentials: 'same-origin',
      signal: opts.signal,
    });
    const data = await poll.json().catch(() => ({} as { status?: string; error?: string }));
    if (!poll.ok && !(poll.status === 202 && data?.status)) {
      throw new Error(data.error || `Falha ao consultar o PDF (HTTP ${poll.status}).`);
    }
    const st = data.status;
    if (st === 'pending') {
      notify('queued');
      await sleep(700, opts.signal);
      continue;
    }
    if (st === 'rendering') {
      notify('rendering');
      await sleep(900, opts.signal);
      continue;
    }
    if (st === 'failed') {
      throw new Error(data.error || 'Falha ao gerar o PDF.');
    }
    if (st === 'ready') break;
    throw new Error('Resposta inesperada do servidor de PDF.');
  }

  if (opts.signal?.aborted || isPdfDeliveryCancelled()) {
    throw new DOMException('Cancelled', 'AbortError');
  }

  const pdfRes = await fetch(statusUrl, {
    headers: {
      Accept: 'application/pdf',
      Authorization: `Bearer ${opts.accessToken}`,
      'X-Squad-Pdf-Client': '1',
    },
    credentials: 'same-origin',
    signal: opts.signal,
  });
  if (!pdfRes.ok) {
    const errJson = await pdfRes.json().catch(() => ({} as { error?: string }));
    throw new Error(errJson.error || `Falha ao baixar o PDF (HTTP ${pdfRes.status}).`);
  }
  const buffer = await pdfRes.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    safariUrl,
    filename: ensurePdfName(filename),
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    const t = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(t);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** API usada pelo overlay — reexporta marcações de falha/fecho. */
export {
  beginPdfDelivery,
  closePdfDelivery,
  isPdfDeliveryCancelled,
  markPdfShareFailed,
  setPdfDeliveryError,
  setPdfDeliveryReady,
  setPdfDeliveryStage,
};
