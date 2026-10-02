import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginPdfDelivery,
  cancelPdfDelivery,
  closePdfDelivery,
  getPdfDeliveryState,
  isPdfDeliveryCancelled,
  markPdfShareFailed,
  setPdfDeliveryError,
  setPdfDeliveryReady,
  setPdfDeliveryStage,
} from '../pdfDeliveryStore';

describe('pdfDeliveryStore', () => {
  beforeEach(() => {
    closePdfDelivery();
  });

  it('abre em gerando e aceita ready com bytes', () => {
    beginPdfDelivery({ title: 'Etiquetas', filename: 'etiquetas-PV-1' });
    expect(getPdfDeliveryState().open).toBe(true);
    expect(getPdfDeliveryState().phase).toBe('generating');
    expect(getPdfDeliveryState().filename).toBe('etiquetas-PV-1.pdf');

    setPdfDeliveryStage('rendering');
    const bytes = new Uint8Array([1, 2, 3]);
    setPdfDeliveryReady({ bytes, safariUrl: '/api/render-pdf?job=x' });
    const st = getPdfDeliveryState();
    expect(st.phase).toBe('ready');
    expect(st.bytes).toBe(bytes);
    expect(st.safariUrl).toContain('job=x');
  });

  it('ready não entra em prévia embutida', () => {
    beginPdfDelivery({ title: 'Etiquetas', filename: 'etiquetas' });
    setPdfDeliveryReady({ bytes: new Uint8Array([1]) });
    const st = getPdfDeliveryState();
    expect(st.phase).toBe('ready');
    expect(st.open).toBe(true);
    expect(st).not.toHaveProperty('previewing');
  });

  it('cancelar impede ready posterior', () => {
    beginPdfDelivery({ title: 'Fichas', filename: 'fichas' });
    cancelPdfDelivery();
    expect(isPdfDeliveryCancelled()).toBe(true);
    setPdfDeliveryReady({ bytes: new Uint8Array([9]) });
    expect(getPdfDeliveryState().open).toBe(false);
    expect(getPdfDeliveryState().phase).not.toBe('ready');
  });

  it('marca falha de share e erro', () => {
    beginPdfDelivery({ title: 'PDF', filename: 'doc' });
    setPdfDeliveryReady({ bytes: new Uint8Array([1]) });
    markPdfShareFailed();
    expect(getPdfDeliveryState().shareFailed).toBe(true);
    beginPdfDelivery({ title: 'PDF', filename: 'doc' });
    setPdfDeliveryError('boom');
    expect(getPdfDeliveryState().phase).toBe('error');
    expect(getPdfDeliveryState().error).toBe('boom');
  });
});
