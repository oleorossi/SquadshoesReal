import { describe, expect, it } from 'vitest';
import { splitFichasIntoBlocks } from '../fichaBlocks';

const CURVE = { '34': 1, '35': 2, '36': 2, '37': 3, '38': 2, '39': 1, '40': 1 };
const SIZES = ['34', '35', '36', '37', '38', '39', '40'];

describe('blocos de 20 fichas na palmilha', () => {
  it('600 pares em curva de 12 viram 20 + 20 + completar 10', () => {
    const blocks = splitFichasIntoBlocks({ fichas: 50, curve: CURVE, sizes: SIZES });
    expect(blocks.map(block => block.fichas)).toEqual([20, 20, 10]);
    expect(blocks.map(block => block.completar)).toEqual([false, false, true]);
    expect(blocks[0].pairs).toBe(240);
    expect(blocks[0].grade).toEqual({ '34': 20, '35': 40, '36': 40, '37': 60, '38': 40, '39': 20, '40': 20 });
    expect(blocks[2].pairs).toBe(120);
    expect(blocks[2].grade['37']).toBe(30);
    const total = blocks.reduce((sum, block) => sum + block.pairs, 0);
    expect(total).toBe(600);
  });

  it('não inventa bloco sem a curva de 12', () => {
    expect(splitFichasIntoBlocks({ fichas: 50, curve: null })).toEqual([]);
  });

  it('um lote exato de 20 não se chama completar', () => {
    const blocks = splitFichasIntoBlocks({ fichas: 20, curve: CURVE, sizes: SIZES });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].completar).toBe(false);
    expect(blocks[0].pairs).toBe(240);
  });
});
