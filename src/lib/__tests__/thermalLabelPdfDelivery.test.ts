import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../iosDevice', () => ({
  isIosBrowser: vi.fn(() => false),
}));

import { isIosBrowser } from '../iosDevice';
import { closePdfDelivery, getPdfDeliveryState } from '../pdfDeliveryStore';
import {
  openOrDownloadThermalLabelPdf,
  pdfFileNameForThermalLabels,
} from '../thermalLabelPdfDelivery';

describe('thermalLabelPdfDelivery', () => {
  beforeEach(() => {
    closePdfDelivery();
    vi.mocked(isIosBrowser).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('nomeia o PDF com a data do dia', () => {
    expect(pdfFileNameForThermalLabels(new Date('2026-09-29T12:00:00Z'))).toBe(
      'etiquetas-2026-09-29.pdf',
    );
  });

  it('abre o PDF numa aba quando o navegador permite', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:thermal-pdf'),
      revokeObjectURL: vi.fn(),
    });
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    await expect(openOrDownloadThermalLabelPdf(blob, 'etiquetas-teste.pdf')).resolves.toBe(
      'opened',
    );
    expect(open).toHaveBeenCalledWith(
      'blob:thermal-pdf',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('baixa o PDF quando o pop-up é bloqueado', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:thermal-pdf'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(window, 'open').mockReturnValue(null);
    const click = vi.fn();
    const append = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      const el = node as HTMLAnchorElement;
      if (typeof el.click === 'function') {
        el.click = click;
      } else {
        Object.defineProperty(el, 'click', { value: click });
      }
      return node;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    await expect(openOrDownloadThermalLabelPdf(blob, 'etiquetas-teste.pdf')).resolves.toBe(
      'downloaded',
    );
    expect(click).toHaveBeenCalled();
    expect(append).toHaveBeenCalled();
  });

  it('no iOS abre o overlay canônico na tela de ações', async () => {
    vi.mocked(isIosBrowser).mockReturnValue(true);
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    await expect(openOrDownloadThermalLabelPdf(blob, 'etiquetas-ios.pdf')).resolves.toBe(
      'overlay',
    );
    const st = getPdfDeliveryState();
    expect(st.open).toBe(true);
    expect(st.phase).toBe('ready');
    expect(st.title).toBe('Etiquetas');
    expect(st.safariUrl).toBeNull();
    expect(st.bytes?.byteLength).toBeGreaterThan(0);
  });
});
