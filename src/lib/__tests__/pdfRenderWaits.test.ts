import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectPdfHtml } from '../pdfRenderWaits';
import { inspectPdfHtml as inspectFromApi } from '../../../api/pdfRenderWaits';

const FONT_ONLY = `<!doctype html><html><head>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Fira+Sans:wght@400;700&display=swap" rel="stylesheet">
</head><body><h1>Consumo</h1></body></html>`;

const WITH_PHOTO = `<!doctype html><html><head>
  <link rel="stylesheet" href="https://squadshoes-real.vercel.app/assets/index.css">
</head><body><img src="https://ssvxfoybzmjlypnipqzn.supabase.co/storage/v1/a.png"></body></html>`;

const WITH_BARCODE = `<svg id="bc-hang-1"></svg><div id="qr-ht-1"></div>`;

describe('inspectPdfHtml', () => {
  it('consumo (só Google Fonts) não espera rede nem código de barras', () => {
    expect(inspectPdfHtml(FONT_ONLY)).toEqual({
      waitForNetworkIdle: false,
      waitForTraceCodes: false,
    });
  });

  it('ficha/etiqueta com foto ou CSS do app espera a rede', () => {
    expect(inspectPdfHtml(WITH_PHOTO).waitForNetworkIdle).toBe(true);
    expect(inspectPdfHtml(WITH_PHOTO).waitForTraceCodes).toBe(false);
  });

  it('hangtag com barcode/QR espera os códigos', () => {
    expect(inspectPdfHtml(WITH_BARCODE).waitForTraceCodes).toBe(true);
  });

  it('o espelho da função Vercel devolve o mesmo veredito', () => {
    for (const html of [FONT_ONLY, WITH_PHOTO, WITH_BARCODE, '']) {
      expect(inspectFromApi(html)).toEqual(inspectPdfHtml(html));
    }
  });
});

describe('pdfRenderWaits — corpos iguais (src × api)', () => {
  it('os dois arquivos são o mesmo texto a partir de FONT_HOST', () => {
    const slice = (file: string) => {
      const text = readFileSync(resolve(__dirname, file), 'utf8');
      const start = text.indexOf('const FONT_HOST');
      if (start < 0) throw new Error(`FONT_HOST ausente em ${file}`);
      return text.slice(start);
    };
    expect(slice('../../../api/pdfRenderWaits.ts')).toBe(slice('../pdfRenderWaits.ts'));
  });
});
