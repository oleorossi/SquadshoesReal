import { describe, expect, it } from 'vitest';
import {
  buildExternalVolumePartialRows,
  countVolumesInSelection,
  expandBoxGroupsForVolumeSets,
  filterItemsByExternalVolumeSelection,
  parseRotuloVolumeSpec,
  volumeSetKeyForGroup,
  type ExternalVolumePartialGroup,
} from '@/lib/labelExternalVolumePartial';

const group = (
  overrides: Partial<ExternalVolumePartialGroup> & Pick<ExternalVolumePartialGroup, 'groupKey' | 'volumeSetKey'>,
): ExternalVolumePartialGroup => ({
  saleOrderNumber: 'PV-00194',
  referenceId: 'ref-1',
  refCode: 'I90',
  refName: 'I90',
  colors: ['TAN'],
  orderNumbers: ['OP-1'],
  ...overrides,
});

describe('parseRotuloVolumeSpec', () => {
  it('aceita volumes soltos separados por vírgula', () => {
    expect(parseRotuloVolumeSpec('20, 27', 62)).toEqual([20, 27]);
    expect(parseRotuloVolumeSpec('1,50', 62)).toEqual([1, 50]);
  });

  it('aceita intervalos inclusive e mistura com soltos', () => {
    expect(parseRotuloVolumeSpec('50-55', 62)).toEqual([50, 51, 52, 53, 54, 55]);
    expect(parseRotuloVolumeSpec('1, 50-52, 62', 62)).toEqual([1, 50, 51, 52, 62]);
  });

  it('ignora volumes fora de 1…N e tokens inválidos', () => {
    expect(parseRotuloVolumeSpec('20, 99, abc, 0, -3', 62)).toEqual([20]);
    expect(parseRotuloVolumeSpec('55-70', 62)).toEqual([55, 56, 57, 58, 59, 60, 61, 62]);
  });

  it('campo vazio ou N inválido devolve lista vazia', () => {
    expect(parseRotuloVolumeSpec('', 62)).toEqual([]);
    expect(parseRotuloVolumeSpec('   ', 62)).toEqual([]);
    expect(parseRotuloVolumeSpec('1,2', 0)).toEqual([]);
  });

  it('normaliza intervalo invertido e remove duplicatas', () => {
    expect(parseRotuloVolumeSpec('55-50, 52', 62)).toEqual([50, 51, 52, 53, 54, 55]);
  });
});

describe('conjuntos de volume do rótulo externo', () => {
  it('expande a seleção para todos os grupos do mesmo PV+ref+cor', () => {
    const selected = [group({ groupKey: 'a', volumeSetKey: 'PV-00194|ref-1|TAN|', orderNumbers: ['OP-1'] })];
    const all = [
      ...selected,
      group({ groupKey: 'b', volumeSetKey: 'PV-00194|ref-1|TAN|', orderNumbers: ['OP-2'] }),
      group({
        groupKey: 'c',
        volumeSetKey: 'PV-00194|ref-1|PRETO|',
        colors: ['PRETO'],
        orderNumbers: ['OP-3'],
      }),
    ];
    expect(expandBoxGroupsForVolumeSets(selected, all).map(g => g.groupKey)).toEqual(['a', 'b']);
  });

  it('monta uma linha por conjunto com o N do rótulo', () => {
    const rows = buildExternalVolumePartialRows(
      [
        group({ groupKey: 'a', volumeSetKey: 'PV-00194|ref-1|TAN|', orderNumbers: ['OP-1'] }),
        group({ groupKey: 'b', volumeSetKey: 'PV-00194|ref-1|TAN|', orderNumbers: ['OP-2'] }),
      ],
      { 'PV-00194|ref-1|TAN|': 62 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      volumeSetKey: 'PV-00194|ref-1|TAN|',
      color: 'TAN',
      maxVolume: 62,
      orderNumbers: ['OP-1', 'OP-2'],
    });
  });

  it('filtra mantendo o n/N original e ignora campo vazio', () => {
    const items = [
      { volumeSetKey: 'TAN', boxNumber: 20, totalBoxes: 62 },
      { volumeSetKey: 'TAN', boxNumber: 21, totalBoxes: 62 },
      { volumeSetKey: 'TAN', boxNumber: 27, totalBoxes: 62 },
      { volumeSetKey: 'PRETO', boxNumber: 1, totalBoxes: 10 },
    ];
    const rows = [
      {
        volumeSetKey: 'TAN',
        saleOrderNumber: 'PV-00194',
        refCode: 'I90',
        refName: 'I90',
        color: 'TAN',
        orderNumbers: ['OP-1'],
        maxVolume: 62,
        groupKeys: ['a'],
      },
      {
        volumeSetKey: 'PRETO',
        saleOrderNumber: 'PV-00194',
        refCode: 'I90',
        refName: 'I90',
        color: 'PRETO',
        orderNumbers: ['OP-2'],
        maxVolume: 10,
        groupKeys: ['b'],
      },
    ];
    const filtered = filterItemsByExternalVolumeSelection(items, rows, {
      TAN: '20, 27',
      PRETO: '',
    });
    expect(filtered).toEqual([
      { volumeSetKey: 'TAN', boxNumber: 20, totalBoxes: 62 },
      { volumeSetKey: 'TAN', boxNumber: 27, totalBoxes: 62 },
    ]);
    expect(countVolumesInSelection(rows, { TAN: '20, 27', PRETO: '' })).toBe(2);
  });

  it('deriva volumeSetKey a partir do grupo quando a chave não veio pronta', () => {
    expect(volumeSetKeyForGroup(group({
      groupKey: 'x',
      volumeSetKey: '',
      saleOrderNumber: 'PV-9',
      referenceId: 'r',
      colors: ['off white'],
      orders: [{ color: 'OFF WHITE', material_variant_id: 'v1' }],
    }))).toBe('PV-9|r|OFF WHITE|v1');
  });
});
