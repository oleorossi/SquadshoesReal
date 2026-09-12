import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const handler = readFileSync(resolve(__dirname, '../../../api/render-pdf.ts'), 'utf8');

describe('render-pdf — aquecimento e esperas condicionais', () => {
  it('GET aquece o Chromium da MESMA função, sem gastar a cota de geração', () => {
    expect(handler).toMatch(/req\.method === 'GET'/);
    expect(handler).toMatch(/status\(204\)/);
    expect(handler).toMatch(/warmByUser/);
    expect(handler).toMatch(/consumeRateSlot\(warmByUser/);
    expect(handler).toMatch(/consumeRateSlot\(rateByUser/);
    expect(handler).toContain("await getBrowser()");
    // Um arquivo api/ irmão subiria outro isolate — o cold start continuaria.
    expect(handler).not.toMatch(/api\/render-pdf-warm/);
  });

  it('não espera rede nem barcode quando inspectPdfHtml diz que não precisa', () => {
    expect(handler).toContain("import { inspectPdfHtml } from './pdfRenderWaits'");
    expect(handler).toMatch(/if \(waits\.waitForNetworkIdle\)/);
    expect(handler).toMatch(/if \(waits\.waitForTraceCodes\)/);
  });

  it('GET exige sessão aprovada e não aceita HTML vazio como PDF', () => {
    expect(handler).toContain('authenticateApprovedUser');
    expect(handler).toContain('bearerToken');
    expect(handler).toMatch(/Use POST para gerar, GET para aquecer/);
  });
});
