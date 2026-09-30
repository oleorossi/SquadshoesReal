import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const host = readFileSync(
  resolve(__dirname, '../components/pdf/PdfDeliveryHost.tsx'),
  'utf8',
);

describe('PdfDeliveryHost — Abrir embutido (iOS)', () => {
  it('oferece Abrir secundário e viewer com Voltar', () => {
    expect(host).toMatch(/>\s*Abrir\s*</);
    expect(host).toContain('enterPdfPreview');
    expect(host).toContain('exitPdfPreview');
    expect(host).toMatch(/>\s*Voltar\s*</);
    expect(host).toContain('createPdfBlobUrl');
    expect(host).toContain('Abra pra conferir');
  });

  it('Safari só no AlertDialog de fallback do Abrir, não como botão pós-share', () => {
    expect(host).toContain('Abrir no Safari');
    expect(host).toContain('setSafariConfirm(true)');
    expect(host).toContain('Tentar baixar de novo');
    expect(host).toContain('{state.shareFailed &&');
    // Removido o CTA ghost "Abrir no Safari…" que aparecia após share falhar.
    expect(host).not.toContain('Abrir no Safari…');
    expect(host).not.toContain('onClick={() => setSafariConfirm(true)}');
  });
});
