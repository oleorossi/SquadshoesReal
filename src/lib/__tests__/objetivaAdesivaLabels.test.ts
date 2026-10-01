import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OBJETIVA_ADESIVA_ART_HEIGHT_MM,
  OBJETIVA_ADESIVA_ART_WIDTH_MM,
  OBJETIVA_ADESIVA_COLUMNS,
  OBJETIVA_ADESIVA_DPI,
  OBJETIVA_ADESIVA_INSET_MM,
  OBJETIVA_ADESIVA_LABEL_HEIGHT_MM,
  OBJETIVA_ADESIVA_LABEL_WIDTH_MM,
  OBJETIVA_ADESIVA_PAGE_HEIGHT_MM,
  OBJETIVA_ADESIVA_PAGE_WIDTH_MM,
  buildObjetivaAdesivaPdf,
  buildObjetivaAdesivaZpl,
  composeObjetivaAdesivaCopy,
  countObjetivaAdesivaLabels,
  objetivaAdesivaPageCount,
  objetivaAdesivaPdfFilename,
  objetivaAdesivaZplFilename,
  planObjetivaAdesivaPlacements,
} from '@/lib/objetivaAdesivaLabels';
import { parseObjetivaOrderCsv } from '@/lib/objetivaLabels';
import type { ClientOrderLine } from '@/lib/clientLabelPattern';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/objetiva');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

function line(overrides: Partial<ClientOrderLine> = {}): ClientOrderLine {
  return {
    descricao: 'TAM RAST FEM METAL DEDO',
    referencia: 'SP124',
    cor: 'OFF WHITE 420',
    tamanho: '35',
    codigoBarra: '95755',
    codProduto: '95755',
    quantidade: 1,
    valor: 'R$ 39,99',
    ...overrides,
  };
}

describe('composeObjetivaAdesivaCopy', () => {
  it('monta L1/L2 como na original (descrição + ref/cor/TAM + preço)', () => {
    const rows = parseObjetivaOrderCsv(loadFixture('34669946-95755.csv'));
    const copy = composeObjetivaAdesivaCopy(rows[0]!);
    expect(copy.line1).toBe('TAM RAST FEM METAL DEDO -');
    expect(copy.line2).toBe('SP124 OFF WHITE 420 - TAM.: 35');
    expect(copy.codigoBarra).toBe('95755');
    expect(copy.priceText).toBe('R$ 39,99');
  });

  it('omite referência vazia na L2', () => {
    const copy = composeObjetivaAdesivaCopy(
      line({ referencia: '', cor: 'DOURADA 420', tamanho: '35' }),
    );
    expect(copy.line2).toBe('DOURADA 420 - TAM.: 35');
  });

  it('não trunca a L2 típica da original na arte útil', async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: [50, 30], orientation: 'landscape' });
    doc.setFont('helvetica', 'normal');
    const { fitObjetivaAdesivaText, OBJETIVA_ADESIVA_ART_WIDTH_MM: artW } = await import(
      '@/lib/objetivaAdesivaLabels'
    );
    const l2 = fitObjetivaAdesivaText(
      doc,
      'SP124 OFF WHITE 420 - TAM.: 35',
      7.5,
      artW,
    );
    expect(l2.texto).toBe('SP124 OFF WHITE 420 - TAM.: 35');
    expect(l2.texto.endsWith('…')).toBe(false);
  });
});

describe('planObjetivaAdesivaPlacements', () => {
  it('página é 50×30 mm — uma etiqueta por página', () => {
    expect(OBJETIVA_ADESIVA_LABEL_WIDTH_MM).toBe(50);
    expect(OBJETIVA_ADESIVA_LABEL_HEIGHT_MM).toBe(30);
    expect(OBJETIVA_ADESIVA_COLUMNS).toBe(1);
    expect(OBJETIVA_ADESIVA_PAGE_WIDTH_MM).toBe(50);
    expect(OBJETIVA_ADESIVA_PAGE_HEIGHT_MM).toBe(30);
    expect(OBJETIVA_ADESIVA_INSET_MM * 2 + OBJETIVA_ADESIVA_ART_WIDTH_MM)
      .toBe(OBJETIVA_ADESIVA_LABEL_WIDTH_MM);
    expect(OBJETIVA_ADESIVA_INSET_MM * 2 + OBJETIVA_ADESIVA_ART_HEIGHT_MM)
      .toBe(OBJETIVA_ADESIVA_LABEL_HEIGHT_MM);
  });

  it('cada etiqueta ganha a própria página', () => {
    const two = planObjetivaAdesivaPlacements(
      [line(), line({ codigoBarra: '112331', tamanho: '35' })],
      false,
    );
    expect(two).toHaveLength(2);
    expect(two[0]).toMatchObject({
      pageIndex: 0,
      column: 0,
      xMm: OBJETIVA_ADESIVA_INSET_MM,
      yMm: OBJETIVA_ADESIVA_INSET_MM,
    });
    expect(two[1]).toMatchObject({
      pageIndex: 1,
      column: 0,
      xMm: OBJETIVA_ADESIVA_INSET_MM,
      yMm: OBJETIVA_ADESIVA_INSET_MM,
    });
    expect(objetivaAdesivaPageCount(2)).toBe(2);
    expect(objetivaAdesivaPageCount(3)).toBe(3);
  });

  it('produção repete pela quantidade', () => {
    const rows = [line({ quantidade: 3 })];
    expect(countObjetivaAdesivaLabels(rows, true)).toBe(3);
    expect(planObjetivaAdesivaPlacements(rows, true)).toHaveLength(3);
    expect(countObjetivaAdesivaLabels(rows, false)).toBe(1);
  });
});

describe('buildObjetivaAdesivaPdf', () => {
  it('gera PDF 50×30 com descrição, SKU e preço (arte da original)', async () => {
    const rows = [
      parseObjetivaOrderCsv(loadFixture('34669946-95755.csv'))[0]!,
      parseObjetivaOrderCsv(loadFixture('34669946-112331.csv'))[0]!,
    ];
    const doc = await buildObjetivaAdesivaPdf(rows, { repeatByQuantity: false });
    expect(doc.getNumberOfPages()).toBe(2);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(50, 5);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(30, 5);

    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await getDocument({
      data: new Uint8Array(doc.output('arraybuffer')),
      useSystemFonts: true,
    }).promise;
    const pageText = async (n: number) => {
      const page = await pdf.getPage(n);
      const text = await page.getTextContent();
      return text.items.map(i => String((i as { str?: string }).str ?? '')).join('');
    };
    const page1 = await pageText(1);
    expect(page1).toContain('TAM RAST FEM METAL DEDO');
    expect(page1).toContain('SP124 OFF WHITE 420');
    expect(page1).toContain('95755');
    expect(page1).toContain('39,99');

    const page2 = await pageText(2);
    expect(page2).toContain('SAND FEM RAST TIRAS FINAS');
    expect(page2).toContain('112331');

    expect(objetivaAdesivaPdfFilename('34669946-95755.csv')).toMatch(/Objetiva_Adesiva/i);
  });

  it('3 SKUs geram 3 páginas', async () => {
    const rows = [
      line({ codigoBarra: '1', codProduto: '1' }),
      line({ codigoBarra: '2', codProduto: '2' }),
      line({ codigoBarra: '3', codProduto: '3' }),
    ];
    const doc = await buildObjetivaAdesivaPdf(rows, { repeatByQuantity: false });
    expect(doc.getNumberOfPages()).toBe(3);
  });

  it('ignora geometry salva com 2-up / célula 25 mm', async () => {
    const doc = await buildObjetivaAdesivaPdf([line()], {
      repeatByQuantity: false,
      geometry: { labelWidthMm: 25, columns: 2, columnGapMm: 6 },
    });
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(50, 5);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(30, 5);
    expect(doc.getNumberOfPages()).toBe(1);
  });
});

describe('buildObjetivaAdesivaZpl · mídia 50×30 203 dpi', () => {
  it('emite ^PW400/^LL240 com L1, L2, CODE128, SKU e preço', () => {
    expect(OBJETIVA_ADESIVA_DPI).toBe(203);
    const zpl = buildObjetivaAdesivaZpl(
      [line({ codigoBarra: '112331', valor: 'R$ 39,99' })],
      { repeatByQuantity: false },
    );
    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^PW400');
    expect(zpl).toContain('^LL240');
    expect(zpl).toContain('^BCN,');
    expect(zpl).toContain('^FD112331^FS');
    expect(zpl).toMatch(/TAM RAST FEM METAL DEDO/);
    expect(zpl).toMatch(/SP124 OFF WHITE 420/);
    expect(zpl).toMatch(/R\$ 39,99/);
    expect(zpl).toContain('^XZ');
    expect(objetivaAdesivaZplFilename('112331.csv')).toMatch(/50x30\.zpl$/);
  });

  it('produção repete pela quantidade e ignora geometry 2-up', () => {
    const zpl = buildObjetivaAdesivaZpl(
      [line({ quantidade: 2, codigoBarra: '95755' })],
      { repeatByQuantity: true, geometry: { labelWidthMm: 25, columns: 2 } },
    );
    const labels = zpl.split('^XA').filter(Boolean);
    expect(labels).toHaveLength(2);
    expect(zpl.match(/\^PW400/g)).toHaveLength(2);
  });
});
