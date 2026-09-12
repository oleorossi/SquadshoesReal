import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectPdfHtml } from '../pdfRenderWaits';

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
});

describe('pdfRenderWaits — corpo igual no handler da Vercel', () => {
  it('api/render-pdf.ts não tem import relativo (ESM derruba a função)', () => {
    const handler = readFileSync(resolve(__dirname, '../../../api/render-pdf.ts'), 'utf8');
    expect(handler).not.toMatch(/^import\s.+\sfrom ['"]\.\//m);
  });

  it('os dois arquivos têm as mesmas regex e o mesmo inspectPdfHtml', () => {
    const logic = (file: string) => {
      const text = readFileSync(resolve(__dirname, file), 'utf8');
      const consts = ['FONT_HOST', 'ABSOLUTE_URL', 'TRACE_CODE'].map((name) => {
        const m = text.match(new RegExp(`const ${name} = /[\\s\\S]*?;`));
        if (!m) throw new Error(`${name} ausente em ${file}`);
        return m[0];
      });
      const fn = text.match(/function inspectPdfHtml\(html: string\): PdfRenderWaits \{[\s\S]*?\n\}/);
      if (!fn) throw new Error(`inspectPdfHtml ausente em ${file}`);
      return [...consts, fn[0]].join('\n');
    };
    expect(logic('../../../api/render-pdf.ts')).toBe(logic('../pdfRenderWaits.ts'));
  });
});
