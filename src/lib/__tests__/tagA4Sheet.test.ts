import { describe, expect, it } from 'vitest';
import type { ClientOrderLine } from '@/lib/clientLabelPattern';
import {
  TAG_A4_CELL_HEIGHT_MM,
  TAG_A4_CELL_WIDTH_MM,
  TAG_A4_CELLS_PER_PAGE,
  TAG_A4_COLUMNS,
  TAG_A4_PAGE_HEIGHT_MM,
  TAG_A4_PAGE_WIDTH_MM,
  TAG_A4_ROWS,
  expandAndPaginateTagA4,
  tagA4BlockOrigin,
  tagA4CellOrigin,
  tagA4GroupKey,
  tagA4PdfFilename,
} from '@/lib/tagA4Sheet';

function line(partial: Partial<ClientOrderLine> & Pick<ClientOrderLine, 'referencia' | 'cor'>): ClientOrderLine {
  return {
    tamanho: '35',
    codProduto: '1',
    codigoBarra: '1',
    quantidade: 1,
    ...partial,
  };
}

describe('tagA4Sheet geometry', () => {
  it('grade 4×4 de 40×60 cabe centrada na A4', () => {
    expect(TAG_A4_COLUMNS * TAG_A4_ROWS).toBe(TAG_A4_CELLS_PER_PAGE);
    expect(TAG_A4_CELLS_PER_PAGE).toBe(16);
    const blockW = TAG_A4_COLUMNS * TAG_A4_CELL_WIDTH_MM;
    const blockH = TAG_A4_ROWS * TAG_A4_CELL_HEIGHT_MM;
    expect(blockW).toBe(160);
    expect(blockH).toBe(240);
    const origin = tagA4BlockOrigin();
    expect(origin.x).toBeCloseTo((TAG_A4_PAGE_WIDTH_MM - blockW) / 2);
    expect(origin.y).toBeCloseTo((TAG_A4_PAGE_HEIGHT_MM - blockH) / 2);
  });

  it('células avançam L→R, C→B', () => {
    const o0 = tagA4CellOrigin(0);
    const o1 = tagA4CellOrigin(1);
    const o4 = tagA4CellOrigin(4);
    expect(o1.x).toBeCloseTo(o0.x + TAG_A4_CELL_WIDTH_MM);
    expect(o1.y).toBeCloseTo(o0.y);
    expect(o4.x).toBeCloseTo(o0.x);
    expect(o4.y).toBeCloseTo(o0.y + TAG_A4_CELL_HEIGHT_MM);
  });
});

describe('expandAndPaginateTagA4', () => {
  it('repete pela quantidade e preenche até 16 por folha no mesmo grupo', () => {
    const pages = expandAndPaginateTagA4(
      [line({ referencia: 'SP124', cor: 'OFF WHITE 420', quantidade: 20 })],
      true,
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(16);
    expect(pages[1]).toHaveLength(4);
  });

  it('sem repetir quantidade gera 1 célula por linha', () => {
    const pages = expandAndPaginateTagA4(
      [
        line({ referencia: 'SP124', cor: 'OFF WHITE 420', quantidade: 60, tamanho: '35' }),
        line({ referencia: 'SP124', cor: 'OFF WHITE 420', quantidade: 60, tamanho: '36' }),
      ],
      false,
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
  });

  it('quebra de página ao mudar referência/cor mesmo com folha incompleta', () => {
    const pages = expandAndPaginateTagA4(
      [
        line({ referencia: 'SP124', cor: 'OFF WHITE 420', quantidade: 3 }),
        line({ referencia: 'SP130', cor: 'DOURADA 420', quantidade: 2 }),
      ],
      true,
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(3);
    expect(pages[1]).toHaveLength(2);
    expect(pages[0]!.every(r => tagA4GroupKey(r) === 'SP124||OFF WHITE 420')).toBe(true);
    expect(pages[1]!.every(r => tagA4GroupKey(r) === 'SP130||DOURADA 420')).toBe(true);
  });

  it('não remistura o mesmo grupo depois de outro (ordem do arquivo)', () => {
    const pages = expandAndPaginateTagA4(
      [
        line({ referencia: 'A', cor: 'PRETO', quantidade: 1 }),
        line({ referencia: 'B', cor: 'BRANCO', quantidade: 1 }),
        line({ referencia: 'A', cor: 'PRETO', quantidade: 1 }),
      ],
      true,
    );
    expect(pages).toHaveLength(3);
  });

  it('recusa lote acima do limite seguro', () => {
    expect(() =>
      expandAndPaginateTagA4(
        [line({ referencia: 'X', cor: 'Y', quantidade: 20_001 })],
        true,
      ),
    ).toThrow(/limite seguro/i);
  });
});

describe('tagA4PdfFilename', () => {
  it('sanitiza cliente e origem', () => {
    expect(tagA4PdfFilename('Objetiva', 'pedido 12.csv')).toBe(
      'Etiquetas_Objetiva_A4_pedido_12.pdf',
    );
  });
});

describe('buildTagA4Pdf smoke', () => {
  it('gera A4 com quebra de grupo e 16 células na primeira folha cheia', async () => {
    const { buildTagA4Pdf } = await import('@/lib/tagA4Sheet');
    const origins: Array<{ x: number; y: number }> = [];
    const doc = await buildTagA4Pdf(
      [
        line({ referencia: 'SP124', cor: 'OFF WHITE 420', quantidade: 17 }),
        line({ referencia: 'SP130', cor: 'DOURADA 420', quantidade: 1 }),
      ],
      {
        repeatByQuantity: true,
        drawCell: (_doc, _row, origin) => {
          origins.push({ x: origin.x, y: origin.y });
        },
      },
    );
    // 17 do 1º grupo → 2 páginas; +1 do 2º → 3 páginas
    expect(doc.getNumberOfPages()).toBe(3);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(TAG_A4_PAGE_WIDTH_MM);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(TAG_A4_PAGE_HEIGHT_MM);
    expect(origins).toHaveLength(18);
    expect(origins[0]!.x).toBeCloseTo(tagA4CellOrigin(0).x);
    // 17ª etiqueta do 1º grupo recomeça na célula 0 da folha seguinte
    expect(origins[16]!.x).toBeCloseTo(tagA4CellOrigin(0).x);
    expect(origins[16]!.y).toBeCloseTo(tagA4CellOrigin(0).y);
  });
});
