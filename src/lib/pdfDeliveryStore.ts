/**
 * Estado global do overlay de entrega de PDF no iOS.
 * Fora do React de propósito: `printHtmlAsPdf` e `downloadBinaryFile` precisam
 * abrir/atualizar a UI sem receber um setState por props.
 */

export type PdfDeliveryPhase = 'generating' | 'ready' | 'error';

export type PdfDeliveryStage = 'preparing' | 'sending' | 'queued' | 'rendering';

export interface PdfDeliveryState {
  open: boolean;
  phase: PdfDeliveryPhase;
  stage: PdfDeliveryStage;
  /** Título de contexto (ex.: "Etiquetas", "Fichas") — não o filename técnico. */
  title: string;
  filename: string;
  bytes: Uint8Array | null;
  /** URL GET do job (com token) pra fallback "Abrir no Safari". */
  safariUrl: string | null;
  error: string | null;
  /** Depois que Compartilhar falha, mostra "Tentar baixar de novo". */
  shareFailed: boolean;
  /** ready: viewer embutido do PDF (botão Abrir / auto-preview da ZPL). */
  previewing: boolean;
  cancelled: boolean;
  /** Contador pra React re-renderizar. */
  rev: number;
}

type Listener = () => void;

const STAGE_TEXT: Record<PdfDeliveryStage, string> = {
  preparing: 'Preparando o documento…',
  sending: 'Enviando para o servidor…',
  queued: 'Na fila…',
  rendering: 'Renderizando…',
};

let state: PdfDeliveryState = {
  open: false,
  phase: 'generating',
  stage: 'preparing',
  title: 'PDF',
  filename: 'documento.pdf',
  bytes: null,
  safariUrl: null,
  error: null,
  shareFailed: false,
  previewing: false,
  cancelled: false,
  rev: 0,
};

const listeners = new Set<Listener>();

function emit() {
  state = { ...state, rev: state.rev + 1 };
  listeners.forEach((l) => l());
}

export function getPdfDeliveryState(): PdfDeliveryState {
  return state;
}

export function subscribePdfDelivery(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function pdfDeliveryStageText(stage: PdfDeliveryStage): string {
  return STAGE_TEXT[stage];
}

function ensurePdfName(filename: string): string {
  const base = String(filename || 'documento').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'documento';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

/** Abre o overlay em modo "gerando". Cancela sessão anterior se ainda aberta. */
export function beginPdfDelivery(opts: { title: string; filename: string }): void {
  state = {
    open: true,
    phase: 'generating',
    stage: 'preparing',
    title: opts.title || 'PDF',
    filename: ensurePdfName(opts.filename),
    bytes: null,
    safariUrl: null,
    error: null,
    shareFailed: false,
    previewing: false,
    cancelled: false,
    rev: state.rev + 1,
  };
  listeners.forEach((l) => l());
}

export function setPdfDeliveryStage(stage: PdfDeliveryStage): void {
  if (!state.open || state.cancelled) return;
  state = { ...state, stage, phase: 'generating', error: null };
  emit();
}

export function setPdfDeliveryReady(opts: {
  bytes: Uint8Array;
  safariUrl?: string | null;
  filename?: string;
  /** Já entra no viewer embutido (ex.: "Abrir PDF" da prévia ZPL no iOS). */
  openPreview?: boolean;
}): void {
  if (!state.open || state.cancelled) return;
  state = {
    ...state,
    phase: 'ready',
    bytes: opts.bytes,
    safariUrl: opts.safariUrl ?? state.safariUrl,
    filename: opts.filename ? ensurePdfName(opts.filename) : state.filename,
    error: null,
    shareFailed: false,
    previewing: !!opts.openPreview,
  };
  emit();
}

export function enterPdfPreview(): void {
  if (!state.open || state.phase !== 'ready' || !state.bytes) return;
  state = { ...state, previewing: true };
  emit();
}

export function exitPdfPreview(): void {
  if (!state.open || !state.previewing) return;
  state = { ...state, previewing: false };
  emit();
}

export function setPdfDeliveryError(message: string): void {
  if (!state.open || state.cancelled) return;
  state = {
    ...state,
    phase: 'error',
    error: message || 'Não foi possível gerar o PDF.',
  };
  emit();
}

export function markPdfShareFailed(): void {
  if (!state.open) return;
  state = { ...state, shareFailed: true };
  emit();
}

export function clearPdfShareFailed(): void {
  if (!state.open) return;
  state = { ...state, shareFailed: false };
  emit();
}

export function cancelPdfDelivery(): void {
  if (!state.open) return;
  state = { ...state, cancelled: true, open: false };
  emit();
}

export function closePdfDelivery(): void {
  if (!state.open) return;
  state = { ...state, open: false, cancelled: true };
  emit();
}

export function isPdfDeliveryCancelled(): boolean {
  return state.cancelled || !state.open;
}
