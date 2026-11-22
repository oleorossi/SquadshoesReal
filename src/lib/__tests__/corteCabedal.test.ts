import { describe, expect, it } from 'vitest';
import { cutTotal, rangeBoard, resolveCutPhoto, sizeGradeForCut, suggestContractorIds, weekLoad } from '@/lib/corteCabedal';

describe('corte independente', () => {
  it('sugere o último lançamento e deixa trocar a lista', () => {
    expect(suggestContractorIds(['b', 'a'], 'c', ['a', 'b', 'c'])).toEqual(['b', 'a']);
    expect(suggestContractorIds([], 'c', ['a', 'c'])).toEqual(['c']);
    expect(suggestContractorIds(['x'], 'c', ['a', 'c'])).toEqual([]);
  });

  it('soma as faixas e só fecha quando os prestadores batem o corte', () => {
    const board = rangeBoard(
      { P: 30, G: 120 },
      [{ P: 10, G: 40 }, { P: 20, G: 80 }],
    );
    expect(board.every((row) => row.closed)).toBe(true);
    expect(cutTotal({ P: 30, G: 120 })).toBe(150);
    const open = rangeBoard({ P: 30, G: 120 }, [{ P: 10, G: 40 }]);
    expect(open.find((row) => row.label === 'G')?.closed).toBe(false);
  });

  it('escolhe a foto da cor antes da ficha', () => {
    expect(resolveCutPhoto({
      variantImageUrl: 'https://cdn/preto.jpg',
      images: ['https://cdn/ficha.jpg'],
      imageUrl: 'https://cdn/legado.jpg',
    })).toBe('https://cdn/preto.jpg');
    expect(resolveCutPhoto({
      images: [{ url: 'https://cdn/ficha.jpg' }],
      imageUrl: 'https://cdn/legado.jpg',
    })).toBe('https://cdn/ficha.jpg');
    expect(resolveCutPhoto({})).toBe('');
  });

  it('reparte a faixa pela curva do item', () => {
    expect(sizeGradeForCut(
      [{ label: 'P', sizes: ['34', '35'], cap: 30, mode: 'range' }],
      { P: 30 },
      { '34': 10, '35': 20 },
    )).toEqual({ '34': 10, '35': 20 });
  });

  it('não soma a capacidade duas vezes e conta a rua', () => {
    const load = weekLoad([
      { contractorId: 'a', sectorKey: 'costura', periodStart: '2026-11-16', streetPairs: 40, capacityPeriod: 100 },
      { contractorId: 'a', sectorKey: 'costura', periodStart: '2026-11-16', streetPairs: 10, capacityPeriod: 100 },
      { contractorId: 'a', sectorKey: 'costura', periodStart: '2026-11-09', streetPairs: 5, capacityPeriod: 100 },
    ], 'a', 'costura', '2026-11-16');
    expect(load.street).toBe(55);
    expect(load.free).toBe(50);
  });
});
