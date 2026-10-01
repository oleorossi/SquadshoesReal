import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultPatternForKey, OBJETIVA_DEFAULT_BRANDING } from '@/lib/clientLabelPattern';
import {
  OBJETIVA_ART_DOTS,
  OBJETIVA_DPI,
  OBJETIVA_PDF_FONT,
  buildObjetivaPdf,
  buildObjetivaTagA4Pdf,
  buildObjetivaZpl,
  composeObjetivaLabelCopy,
  countObjetivaLabels,
  isObjetivaOrderHeader,
  objetivaBarcodeRailLines,
  objetivaMioloColumns,
  objetivaMioloLines,
  objetivaPdfFilename,
  objetivaRotatedRailLines,
  objetivaZplFilename,
  parseObjetivaOrderCsv,
  stripHangtagAccents,
  wrapObjetivaDescricao,
} from '@/lib/objetivaLabels';
import {
  TAG_A4_CELL_HEIGHT_MM,
  TAG_A4_CELL_WIDTH_MM,
  tagA4CellOrigin,
} from '@/lib/tagA4Sheet';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/objetiva');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('objetivaLabels parser', () => {
  it('detecta cabeçalho Objetiva real', () => {
    const csv = loadFixture('112334.csv');
    const header = (csv.split(/\r?\n/)[0] ?? '').split(';');
    expect(isObjetivaOrderHeader(header)).toBe(true);
  });

  it('parseia CSV Objetiva com SKU como código de barras', () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv'), '112334.csv');
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0]!;
    expect(first.codigoBarra).toBe('112334');
    expect(first.codProduto).toBe('112334');
    expect(first.referencia).toBeTruthy();
    expect(first.tamanho).toBeTruthy();
    expect(first.quantidade).toBeGreaterThan(0);
    expect(first.semanaFabricacao).toBeTruthy();
    expect(first.anoFabricacao).toBeTruthy();
    expect(first.sourceFile).toBe('112334.csv');
  });

  it('parseia os fixtures de pedido (completos e sem TIPO/CATEGORIA/GRUPO)', () => {
    for (const name of [
      '112332.csv',
      '112334.csv',
      '112336.csv',
      '34669946-95755.csv',
      '34669946-112331.csv',
    ]) {
      const rows = parseObjetivaOrderCsv(loadFixture(name), name);
      expect(rows.length, name).toBeGreaterThan(0);
      expect(rows.every(row => row.codigoBarra.length > 0), name).toBe(true);
    }
  });

  it('CSV Dakotton sem TIPO/CATEGORIA/GRUPO ainda parseia SKU/tamanho/preço', () => {
    const rows = parseObjetivaOrderCsv(loadFixture('34669946-112331.csv'));
    expect(rows[0]!.codigoBarra).toBe('112331');
    expect(rows[0]!.referencia).toBe('SP130');
    expect(rows[0]!.tamanho).toBe('35');
    expect(rows[0]!.valor).toMatch(/39/);
    expect(rows[0]!.tipo).toBe('');
    expect(rows[0]!.categoria).toBe('');
    expect(rows[0]!.grupo).toBe('');
  });
});

describe('objetivaLabels PDF', () => {
  it('conta etiquetas com e sem repetição por quantidade', () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv'));
    const withQty = countObjetivaLabels(rows, true);
    const sample = countObjetivaLabels(rows, false);
    expect(withQty).toBeGreaterThanOrEqual(sample);
    expect(sample).toBe(rows.length);
  });

  it('gera PDF binário válido (header %PDF)', async () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv')).slice(0, 2);
    const pattern = defaultPatternForKey('objetiva');
    const doc = await buildObjetivaPdf(rows, {
      geometry: pattern.geometry,
      branding: pattern.branding,
      repeatByQuantity: false,
    });
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
    expect(objetivaPdfFilename('112334.csv')).toMatch(/Objetiva/i);
  });

  it('aceita logo opcional sem quebrar a geração', async () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv')).slice(0, 1);
    const pattern = defaultPatternForKey('objetiva');
    const doc = await buildObjetivaPdf(rows, {
      geometry: pattern.geometry,
      branding: pattern.branding,
      repeatByQuantity: false,
      logo: {
        dataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        width: 1,
        height: 1,
      },
    });
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});

describe('composeObjetivaLabelCopy · hangtag 112334 TAM 25', () => {
  it('espelha a etiqueta física da foto', () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv'));
    const row = rows.find(item => item.tamanho === '25');
    expect(row).toBeTruthy();
    expect(row!.tipo).toBe('SANDÁLIA');
    expect(row!.grupo).toBe('CALÇADOS');

    const copy = composeObjetivaLabelCopy(row!, OBJETIVA_DEFAULT_BRANDING);
    expect(copy.descricao).toBe('SAND INFA RAST TIRAS NO');
    expect(copy.tipo).toBe('SANDALIA');
    expect(copy.categoria).toBe('CALCADOS/INFANTIL');
    expect(copy.material).toBe('PU/SO / DOURADA 420');
    expect(copy.referencia).toBe('Ref.: I701');
    expect(copy.tamanho).toBe('25');
    expect(copy.priceMain).toBe('39');
    expect(copy.priceCents).toBe('99');
    expect(copy.semanaAno).toBe('29 / 26');
    expect(copy.codigoBarra).toBe('112334');
    expect(copy.mottoLines).toEqual(['DEUS', 'É FIEL']);
    expect(copy.exchangeLines).toEqual(['TROCA MANTER', 'ESTA ETIQUETA']);
  });

  it('stripHangtagAccents só remove diacríticos', () => {
    expect(stripHangtagAccents('SANDÁLIA')).toBe('SANDALIA');
    expect(stripHangtagAccents('CALÇADOS')).toBe('CALCADOS');
  });

  it('descrição curta não quebra; PLAT TIRAS BRILHO vira 2 linhas', () => {
    expect(wrapObjetivaDescricao('SAND INFA RAST TIRAS NO')).toEqual([
      'SAND INFA RAST TIRAS NO',
    ]);
    expect(wrapObjetivaDescricao('SAND INFA PLAT TIRAS BRILHO')).toEqual([
      'SAND INFA PLAT TIRAS',
      'BRILHO',
    ]);
  });

  it('miolo empilha tipo/categoria/material/ref em colunas giradas', () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv'));
    const row = rows.find(item => item.tamanho === '25');
    const copy = composeObjetivaLabelCopy(row!, OBJETIVA_DEFAULT_BRANDING);
    expect(objetivaMioloLines(copy)).toEqual([
      'SANDALIA',
      'CALCADOS/INFANTIL',
      'PU/SO / DOURADA 420',
      'Ref.: I701',
    ]);

    // Faixa esquerda = só a descrição; SKU e semana/ano vão na coluna do código.
    expect(objetivaRotatedRailLines(copy)).toEqual(['SAND INFA RAST TIRAS NO']);
    expect(objetivaBarcodeRailLines(copy)).toEqual(['112334', '29 / 26']);
  });

  it('destaque do miolo é do TIPO, não da posição', () => {
    const comTipo = composeObjetivaLabelCopy(
      parseObjetivaOrderCsv(loadFixture('112334.csv')).find(r => r.tamanho === '25')!,
      OBJETIVA_DEFAULT_BRANDING,
    );
    expect(objetivaMioloColumns(comTipo)[0]).toEqual({ text: 'SANDALIA', emphasis: true });

    // CSV sem TIPO/CATEGORIA não pode promover o material a título.
    const semTipo = composeObjetivaLabelCopy(
      parseObjetivaOrderCsv(loadFixture('34669946-95755.csv'))[0]!,
      OBJETIVA_DEFAULT_BRANDING,
    );
    const columns = objetivaMioloColumns(semTipo);
    expect(columns[0]!.text).toBe('PU/SO / OFF WHITE 420');
    expect(columns.every(column => !column.emphasis)).toBe(true);
  });

  it('grade da arte é a mídia Ponto Mix: 320×480 dots a 203 dpi (40×60 mm)', () => {
    expect(OBJETIVA_DPI).toBe(203);
    expect(OBJETIVA_ART_DOTS.gridW).toBe(320);
    expect(OBJETIVA_ART_DOTS.gridH).toBe(480);
    const pattern = defaultPatternForKey('objetiva');
    expect(pattern.geometry.labelWidthMm).toBe(40);
    expect(pattern.geometry.labelHeightMm).toBe(60);
    // 40 mm / 320 dots = 0,125 mm/dot — igual à régua da Ponto Mix.
    expect(pattern.geometry.labelWidthMm / OBJETIVA_ART_DOTS.gridW).toBeCloseTo(0.125, 6);
    expect(pattern.geometry.labelHeightMm / OBJETIVA_ART_DOTS.gridH).toBeCloseTo(0.125, 6);
  });
});

describe('objetivaLabels PDF · miolo girado + preço', () => {
  type PdfTextItem = { str: string; transform: number[]; width: number };

  async function pdfTextForTam25(): Promise<PdfTextItem[]> {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv'));
    const row = rows.find(item => item.tamanho === '25')!;
    const pattern = defaultPatternForKey('objetiva');
    const doc = await buildObjetivaPdf([row], {
      geometry: pattern.geometry,
      branding: pattern.branding,
      repeatByQuantity: false,
    });
    const pdf = await getDocument({
      data: new Uint8Array(doc.output('arraybuffer')),
      useSystemFonts: true,
    }).promise;
    const page = await pdf.getPage(1);
    const text = await page.getTextContent();
    return text.items
      .map(item => {
        const t = item as { str?: string; transform?: number[]; width?: number };
        return {
          str: String(t.str ?? ''),
          transform: t.transform ?? [],
          width: t.width ?? 0,
        };
      })
      .filter(item => item.str.length > 0);
  }

  function itemNamed(items: PdfTextItem[], label: string): PdfTextItem {
    const hit = items.find(item => item.str === label);
    expect(hit, label).toBeTruthy();
    return hit!;
  }

  /** Matriz de rotação 90°: |b| ≈ 1 e |a| ≈ 0 no transform do pdfjs. */
  function isRotated90(item: PdfTextItem): boolean {
    const a = Math.abs(item.transform[0] ?? 0);
    const b = Math.abs(item.transform[1] ?? 0);
    return b > 0.5 && a < 0.5;
  }

  it('grava CALCADOS/INFANTIL completo no conteúdo do PDF', async () => {
    const items = await pdfTextForTam25();
    const joined = items.map(item => item.str).join('|');
    expect(joined).toContain('CALCADOS/INFANTIL');
    expect(joined).not.toMatch(/CALCADOS\/INFANTI[^L]/);
  });

  it('gira o miolo 90°, como na etiqueta física', async () => {
    const items = await pdfTextForTam25();
    for (const label of ['SANDALIA', 'CALCADOS/INFANTIL', 'Ref.: I701', 'SAND INFA RAST TIRAS NO']) {
      expect(isRotated90(itemNamed(items, label)), `${label} sem rotação`).toBe(true);
    }
  });

  it('cabeçalho, TAM e preço ficam na horizontal (sem rotação)', async () => {
    const items = await pdfTextForTam25();
    for (const label of ['TROCA MANTER', 'TAM.:', '25', 'R$', '39', ',99']) {
      expect(isRotated90(itemNamed(items, label)), `${label} não deveria girar`).toBe(false);
    }
  });

  it('R$ fica na margem esquerda e o valor grande alinhado à direita', async () => {
    const items = await pdfTextForTam25();
    const xOf = (label: string) => itemNamed(items, label).transform[4]!;
    // Na foto: "R$" no canto inferior esquerdo, "39,99" grande à direita.
    expect(xOf('R$')).toBeLessThan(xOf('39'));
    expect(xOf('39')).toBeLessThan(xOf(',99'));
    // TAM.: antes do número, na mesma faixa.
    expect(xOf('TAM.:')).toBeLessThan(xOf('25'));
  });

  it('centavos sobem em relação ao valor cheio (sobrescrito)', async () => {
    const items = await pdfTextForTam25();
    const yOf = (label: string) => itemNamed(items, label).transform[5]!;
    // PDF cresce para cima: baseline dos centavos é MAIOR que a do valor.
    expect(yOf(',99')).toBeGreaterThan(yOf('39'));
  });

  it('grade do preço deixa ≥2 mm de folga na borda direita e inferior', () => {
    const { gridW, gridH, price } = OBJETIVA_ART_DOTS;
    const rightMarginMm = ((gridW - price.rightX) / gridW) * 40;
    const bottomMarginMm = ((gridH - price.baseline) / gridH) * 60;
    expect(rightMarginMm).toBeGreaterThanOrEqual(2);
    expect(bottomMarginMm).toBeGreaterThanOrEqual(2);
    // Ainda abaixo do TAM.: para não colidir.
    expect(price.baseline).toBeGreaterThan(OBJETIVA_ART_DOTS.size.baseline);
  });

  it('embute Roboto Condensed (face da Tag física) e formata semana com espaços', async () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv'));
    const row = rows.find(item => item.tamanho === '25')!;
    const doc = await buildObjetivaPdf([row], {
      branding: OBJETIVA_DEFAULT_BRANDING,
      repeatByQuantity: false,
    });
    const fonts = doc.getFontList?.() ?? {};
    expect(fonts[OBJETIVA_PDF_FONT]).toBeTruthy();
    expect(composeObjetivaLabelCopy(row, OBJETIVA_DEFAULT_BRANDING).semanaAno).toMatch(
      /^\d+\s\/\s\d+$/,
    );
  });

  it('fio do miolo fica mais curto que o vão da descrição (foto Tag)', () => {
    const { divider, rail, exchange } = OBJETIVA_ART_DOTS;
    expect(divider.top).toBeGreaterThan(exchange.firstTop + exchange.step);
    expect(divider.bottom).toBeLessThanOrEqual(rail.bottom + 4);
    expect(divider.bottom - divider.top).toBeLessThan(rail.bottom - 70);
  });

  it('no A4 o preço fica dentro da célula com inset ≥ 1,5 mm', async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const rows = parseObjetivaOrderCsv(loadFixture('34669946-95755.csv'));
    const doc = await buildObjetivaTagA4Pdf([rows[0]!], {
      branding: OBJETIVA_DEFAULT_BRANDING,
      repeatByQuantity: false,
    });
    const pdf = await getDocument({
      data: new Uint8Array(doc.output('arraybuffer')),
      useSystemFonts: true,
    }).promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    const cell = tagA4CellOrigin(0);
    const inset = 1.5;
    const left = cell.x + inset;
    const right = cell.x + TAG_A4_CELL_WIDTH_MM - inset;
    const top = cell.y + inset;
    const bottom = cell.y + TAG_A4_CELL_HEIGHT_MM - inset;

    const priceItems = text.items.filter(item => {
      const str = String((item as { str?: string }).str ?? '');
      return str === 'R$' || str === '39' || str === ',99';
    }) as Array<{ str: string; transform: number[]; width: number }>;

    expect(priceItems.length).toBeGreaterThanOrEqual(3);
    for (const item of priceItems) {
      const xMm = (item.transform[4]! * 25.4) / 72;
      const yTopMm = ((vp.height - item.transform[5]!) * 25.4) / 72;
      const widthMm = ((item.width || 0) * 25.4) / 72;
      // Baseline do preço fica na faixa inferior da célula; descendente ≤ ~1,3 mm.
      expect(xMm, item.str).toBeGreaterThanOrEqual(left - 0.2);
      expect(xMm + widthMm, item.str).toBeLessThanOrEqual(right + 0.2);
      expect(yTopMm, item.str).toBeGreaterThanOrEqual(top);
      expect(yTopMm, item.str).toBeLessThanOrEqual(bottom + 0.2);
    }
  });
});

describe('objetivaLabels ZPL · mídia L42PRO 40×60', () => {
  it('emite um bloco ^XA/^XZ por etiqueta com largura e altura em dots', () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv'));
    const row = rows.find(item => item.tamanho === '25')!;
    const zpl = buildObjetivaZpl([row], { repeatByQuantity: false });
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true);
    // 40×60 mm a 203 dpi = 320×480 dots.
    expect(zpl).toContain('^PW320');
    expect(zpl).toContain('^LL480');
  });

  it('bloco central usa orientação bottom-up (B) e o resto normal (N)', () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv'));
    const zpl = buildObjetivaZpl([rows.find(r => r.tamanho === '25')!], {
      repeatByQuantity: false,
    });
    // Descrição, miolo, SKU e semana/ano girados.
    expect(zpl).toMatch(/\^A0B,[0-9]+,[0-9]+\^FDSAND INFA RAST TIRAS NO\^FS/);
    expect(zpl).toMatch(/\^A0B,[0-9]+,[0-9]+\^FDSANDALIA\^FS/);
    expect(zpl).toMatch(/\^A0B,[0-9]+,[0-9]+\^FD29 \/ 26\^FS/);
    // Código de barras girado.
    expect(zpl).toMatch(/\^BCB,[0-9]+,N,N,N/);
    // Cabeçalho e footer na horizontal.
    expect(zpl).toMatch(/\^A0N,[0-9]+,[0-9]+\^FDTROCA MANTER\^FS/);
    expect(zpl).toMatch(/\^A0N,[0-9]+,[0-9]+\^FDTAM\.:\^FS/);
    expect(zpl).toMatch(/\^A0N,[0-9]+,[0-9]+\^FDR\$\^FS/);
  });

  it('repete por quantidade e nomeia o arquivo pela origem', () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv')).slice(0, 1);
    const blocks = buildObjetivaZpl(rows, { repeatByQuantity: true }).match(/\^XA/g) ?? [];
    expect(blocks.length).toBe(rows[0]!.quantidade);
    expect(objetivaZplFilename('112334.csv')).toBe('Etiquetas_Objetiva_112334_L42PRO.zpl');
  });
});
