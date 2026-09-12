import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultPatternForKey, OBJETIVA_DEFAULT_BRANDING } from '@/lib/clientLabelPattern';
import {
  buildObjetivaPdf,
  composeObjetivaLabelCopy,
  countObjetivaLabels,
  isObjetivaOrderHeader,
  objetivaPdfFilename,
  parseObjetivaOrderCsv,
  stripHangtagAccents,
} from '@/lib/objetivaLabels';

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

  it('parseia os três fixtures sem erro', () => {
    for (const name of ['112332.csv', '112334.csv', '112336.csv']) {
      const rows = parseObjetivaOrderCsv(loadFixture(name), name);
      expect(rows.length, name).toBeGreaterThan(0);
      expect(rows.every(row => row.codigoBarra.length > 0), name).toBe(true);
    }
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
    expect(copy.semanaAno).toBe('29/26');
    expect(copy.codigoBarra).toBe('112334');
    expect(copy.mottoLines).toEqual(['DEUS', 'É FIEL']);
    expect(copy.exchangeLines).toEqual(['TROCA MANTER', 'ESTA ETIQUETA']);
  });

  it('stripHangtagAccents só remove diacríticos', () => {
    expect(stripHangtagAccents('SANDÁLIA')).toBe('SANDALIA');
    expect(stripHangtagAccents('CALÇADOS')).toBe('CALCADOS');
  });
});
