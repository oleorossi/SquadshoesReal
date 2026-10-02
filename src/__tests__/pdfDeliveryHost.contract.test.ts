import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const host = readFileSync(
  resolve(__dirname, '../components/pdf/PdfDeliveryHost.tsx'),
  'utf8',
);

describe('PdfDeliveryHost — Abrir no Safari (iOS)', () => {
  it('oferece Abrir no Safari sem prévia embutida', () => {
    expect(host).toContain('Abrir no Safari');
    expect(host).toContain('openPdfInSafari');
    expect(host).toContain('Compartilhar ou salvar');
    // Prévia iframe+blob removida (quadro preto no PWA).
    expect(host).not.toContain('enterPdfPreview');
    expect(host).not.toContain('exitPdfPreview');
    expect(host).not.toContain('createPdfBlobUrl');
    expect(host).not.toContain('<iframe');
    expect(host).not.toMatch(/>\s*Voltar\s*</);
    expect(host).not.toContain('previewing');
  });

  it('sem URL de servidor cai no Compartilhar; Safari falhou também', () => {
    expect(host).toContain('state.safariUrl');
    expect(host).toContain('sharePdfFile');
    expect(host).toContain('Abrindo compartilhar');
    // Sem diálogo de confirmação antes de sair do app.
    expect(host).not.toContain('AlertDialog');
    expect(host).not.toContain('Abrir no Safari?');
    expect(host).toContain('Tentar baixar de novo');
    expect(host).toContain('{state.shareFailed &&');
  });
});
