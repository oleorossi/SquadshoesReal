import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OBJETIVA_ADESIVA_PAGE_HEIGHT_MM,
  OBJETIVA_ADESIVA_PAGE_WIDTH_MM,
  buildObjetivaAdesivaPdf,
  composeObjetivaAdesivaCopy,
  countObjetivaAdesivaLabels,
  objetivaAdesivaPageCount,
  objetivaAdesivaPdfFilename,
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
  it('monta L1/L2 como na foto (descrição + ref/cor/TAM + preço)', () => {
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
});

describe('planObjetivaAdesivaPlacements', () => {
  it('página é 50×30 mm', () => {
    expect(OBJETIVA_ADESIVA_PAGE_WIDTH_MM).toBe(50);
    expect(OBJETIVA_ADESIVA_PAGE_HEIGHT_MM).toBe(30);
  });

  it('2 etiquetas cabem numa carreira; 3 abrem página com direita vazia', () => {
    const two = planObjetivaAdesivaPlacements([line(), line({ codigoBarra: '2' })], false);
    expect(two).toHaveLength(2);
    expect(two[0]!.pageIndex).toBe(0);
    expect(two[0]!.column).toBe(0);
    expect(two[0]!.xMm).toBe(1);
    expect(two[1]!.column).toBe(1);
    expect(two[1]!.xMm).toBe(26);
    expect(objetivaAdesivaPageCount(2)).toBe(1);

    const three = planObjetivaAdesivaPlacements(
      [line(), line({ codigoBarra: '2' }), line({ codigoBarra: '3' })],
      false,
    );
    expect(three).toHaveLength(3);
    expect(three[2]!.pageIndex).toBe(1);
    expect(three[2]!.column).toBe(0);
    expect(objetivaAdesivaPageCount(3)).toBe(2);
  });

  it('produção repete pela quantidade', () => {
    const rows = [line({ quantidade: 3 })];
    expect(countObjetivaAdesivaLabels(rows, true)).toBe(3);
    expect(planObjetivaAdesivaPlacements(rows, true)).toHaveLength(3);
    expect(countObjetivaAdesivaLabels(rows, false)).toBe(1);
  });
});

describe('buildObjetivaAdesivaPdf', () => {
  it('gera PDF binário válido com SKU e preço na arte', async () => {
    const rows = parseObjetivaOrderCsv(loadFixture('34669946-95755.csv')).slice(0, 2);
    const doc = await buildObjetivaAdesivaPdf(rows, { repeatByQuantity: false });
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(50, 5);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(30, 5);

    const bytes = Buffer.from(doc.output('arraybuffer'));
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const latin = bytes.toString('latin1');
    const streams = [...latin.matchAll(/stream\r?\n([\s\S]*?)\nendstream/g)];
    const { inflateSync } = await import('node:zlib');
    const content = streams
      .map(match => {
        try {
          return inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
        } catch {
          return match[1] ?? '';
        }
      })
      .join('\n');
    expect(content).toContain('(95755)');
    expect(content).toMatch(/39/);
    expect(objetivaAdesivaPdfFilename('34669946-95755.csv')).toMatch(/Objetiva_Adesiva/i);
  });

  it('3 SKUs geram 2 páginas', async () => {
    const rows = [
      line({ codigoBarra: '1', codProduto: '1' }),
      line({ codigoBarra: '2', codProduto: '2' }),
      line({ codigoBarra: '3', codProduto: '3' }),
    ];
    const doc = await buildObjetivaAdesivaPdf(rows, { repeatByQuantity: false });
    expect(doc.getNumberOfPages()).toBe(2);
  });
});
