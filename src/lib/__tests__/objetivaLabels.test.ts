import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultPatternForKey } from '@/lib/clientLabelPattern';
import {
  buildObjetivaPdf,
  countObjetivaLabels,
  isObjetivaOrderHeader,
  objetivaPdfFilename,
  parseObjetivaOrderCsv,
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
});
