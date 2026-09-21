import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const handler = readFileSync(resolve(__dirname, '../../../api/render-pdf.ts'), 'utf8');

describe('render-pdf — aquecimento, fila async e esperas condicionais', () => {
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

  it('GET ?job= faz poll da fila (não só warm)', () => {
    expect(handler).toContain('function pollJob');
    expect(handler).toMatch(/jobQueryId\(req\)/);
    expect(handler).toMatch(/pdf_render_jobs/);
    expect(handler).toMatch(/pdf-queue/);
    expect(handler).toMatch(/status === 'ready'/);
    expect(handler).toMatch(/status === 'rendering'/);
  });

  it('POST async enfileira HTML no Storage e devolve HTML de espera', () => {
    expect(handler).toMatch(/asyncMode/);
    expect(handler).toContain('function enqueueAsyncJob');
    expect(handler).toMatch(/enqueueWaitHtml/);
    expect(handler).toMatch(/Na fila/);
  });

  it('Browserless via BROWSERLESS_URL com fallback @sparticuz', () => {
    expect(handler).toMatch(/BROWSERLESS_URL/);
    expect(handler).toMatch(/puppeteer\.connect/);
    expect(handler).toMatch(/browserWSEndpoint/);
    expect(handler).toMatch(/@sparticuz\/chromium/);
  });

  it('não espera rede nem barcode quando inspectPdfHtml diz que não precisa', () => {
    expect(handler).toContain('function inspectPdfHtml');
    expect(handler).not.toMatch(/^import\s.+\sfrom ['"]\.\//m);
    expect(handler).toMatch(/if \(waits\.waitForNetworkIdle\)/);
    expect(handler).toMatch(/if \(waits\.waitForTraceCodes\)/);
  });

  it('GET exige sessão aprovada e distingue warm de poll', () => {
    expect(handler).toContain('authenticateApprovedUser');
    expect(handler).toContain('bearerToken');
    expect(handler).toMatch(/Use POST para gerar, GET para aquecer ou consultar job/);
  });
});
