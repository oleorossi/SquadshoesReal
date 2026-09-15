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
  objetivaHorizontalMioloLines,
  objetivaPdfFilename,
  objetivaRotatedRailLines,
  parseObjetivaOrderCsv,
  stripHangtagAccents,
  wrapObjetivaDescricao,
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

  it('descrição curta não quebra; PLAT TIRAS BRILHO vira 2 linhas', () => {
    expect(wrapObjetivaDescricao('SAND INFA RAST TIRAS NO')).toEqual([
      'SAND INFA RAST TIRAS NO',
    ]);
    expect(wrapObjetivaDescricao('SAND INFA PLAT TIRAS BRILHO')).toEqual([
      'SAND INFA PLAT TIRAS',
      'BRILHO',
    ]);
  });

  it('miolo horizontal empilha tipo/categoria/material/ref', () => {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv'));
    const row = rows.find(item => item.tamanho === '25');
    const copy = composeObjetivaLabelCopy(row!, OBJETIVA_DEFAULT_BRANDING);
    expect(objetivaHorizontalMioloLines(copy)).toEqual([
      'SANDALIA',
      'CALCADOS/INFANTIL',
      'PU/SO / DOURADA 420',
      'Ref.: I701',
    ]);
    const rails = objetivaRotatedRailLines(copy);
    expect(rails).toContain('SAND INFA RAST TIRAS NO');
    expect(rails).toContain('112334');
    expect(rails).toContain('29/26');
    expect(rails).not.toContain('SANDALIA');
    expect(rails).not.toContain('CALCADOS/INFANTIL');
  });
});

describe('objetivaLabels PDF · miolo horizontal + preço', () => {
  async function pdfContentForTam25(): Promise<string> {
    const rows = parseObjetivaOrderCsv(loadFixture('112334.csv'));
    const row = rows.find(item => item.tamanho === '25')!;
    const pattern = defaultPatternForKey('objetiva');
    const doc = await buildObjetivaPdf([row], {
      geometry: pattern.geometry,
      branding: pattern.branding,
      repeatByQuantity: false,
    });
    const bytes = Buffer.from(doc.output('arraybuffer'));
    const latin = bytes.toString('latin1');
    const streams = [...latin.matchAll(/stream\r?\n([\s\S]*?)\nendstream/g)];
    const { inflateSync } = await import('node:zlib');
    return streams
      .map(match => {
        try {
          return inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
        } catch {
          return match[1] ?? '';
        }
      })
      .join('\n');
  }

  it('grava CALCADOS/INFANTIL completo no conteúdo do PDF', async () => {
    const content = await pdfContentForTam25();
    expect(content).toContain('CALCADOS/INFANTIL');
    expect(content).not.toMatch(/CALCADOS\/INFANTI[^L]/);
  });

  it('emite miolo horizontal e bloco R$+main+cents unificado no footer', async () => {
    const content = await pdfContentForTam25();
    expect(content).toContain('(SANDALIA)');
    expect(content).toContain('(CALCADOS/INFANTIL)');
    // Miolo horizontal: Td (sem matriz Tm de rotação 90°)
    expect(content).toMatch(/\([\s\S]*SANDALIA[\s\S]*\)\s*Tj/);
    expect(content).not.toMatch(
      /0\.0000000000000001 1\. -1\. 0\.0000000000000001 [0-9.]+ [0-9.]+\s+Tm\s*\(SANDALIA\)/,
    );

    // Footer: bloco R$ → 39 → ,99 em sequência (não R$ isolado no canto inferior)
    const tamIdx = content.lastIndexOf('(TAM.:)');
    const rsIdx = content.lastIndexOf('(R$)');
    const mainIdx = content.lastIndexOf('(39)');
    const centsIdx = content.lastIndexOf('(,99)');
    expect(tamIdx).toBeGreaterThan(-1);
    expect(rsIdx).toBeGreaterThan(tamIdx);
    expect(mainIdx).toBeGreaterThan(rsIdx);
    expect(centsIdx).toBeGreaterThan(mainIdx);
  });
});
