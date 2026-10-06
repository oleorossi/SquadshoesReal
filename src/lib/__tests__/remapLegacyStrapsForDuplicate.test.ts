import { describe, expect, it } from 'vitest';
import {
  remapLegacyStrapsForDuplicate,
  strapSnapshotNeedsSheetRemap,
  type DuplicateStrapLineLike,
} from '@/lib/remapLegacyStrapsForDuplicate';

const LINE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LINE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COLOR_ROSADO = '11111111-1111-4111-8111-111111111111';
const COLOR_TAN = '22222222-2222-4222-8222-222222222222';
const GROUP_STRASS = '33333333-3333-4333-8333-333333333333';
const GROUP_MEIA = '44444444-4444-4444-8444-444444444444';
const MEASURE = '55555555-5555-4555-8555-555555555555';
const TYPE = '66666666-6666-4666-8666-666666666666';

const colorMap: Record<string, string> = {
  'ROSADO COM FUNDO ROSADO': COLOR_ROSADO,
  TAN: COLOR_TAN,
};

function resolveColorId(name: string) {
  return colorMap[name.trim().toUpperCase()] || colorMap[name.trim()] || null;
}

function sheetLine(
  id: string,
  patch: Partial<DuplicateStrapLineLike>,
): DuplicateStrapLineLike {
  return {
    id,
    technical_strap_line_id: id,
    measure_id: MEASURE,
    strap_type_id: TYPE,
    consumption: 40,
    consumption_per_size: { '34': 40 },
    ...patch,
  };
}

describe('strapSnapshotNeedsSheetRemap', () => {
  it('detecta legado sem UUID e snapshot vazio', () => {
    const technical = [sheetLine(LINE_A, { label: 'TIRA 1' })];
    expect(strapSnapshotNeedsSheetRemap([{ id: '1', label: 'TIRA 1' }], technical)).toBe(true);
    expect(strapSnapshotNeedsSheetRemap([], technical)).toBe(true);
    expect(strapSnapshotNeedsSheetRemap(
      [sheetLine(LINE_A, { label: 'TIRA 1', color_id: COLOR_ROSADO })],
      technical,
    )).toBe(false);
  });
});

describe('remapLegacyStrapsForDuplicate', () => {
  const technical: DuplicateStrapLineLike[] = [
    sheetLine(LINE_A, {
      label: 'TIRA 1',
      identity_basis: 'finished_product_group',
      identity_group_id: GROUP_STRASS,
      group_id: GROUP_STRASS,
      group_name: 'TIRA STRASS 6MM',
      color_mode: 'select_on_order',
    }),
    sheetLine(LINE_B, {
      label: 'TIRA 2',
      identity_basis: 'reference_base',
      group_id: GROUP_MEIA,
      group_name: 'Meia Cana 10mm',
      color_mode: 'follow_main',
    }),
    sheetLine(LINE_C, {
      label: 'TIRA 3',
      identity_basis: 'finished_product_group',
      identity_group_id: GROUP_STRASS,
      group_id: GROUP_STRASS,
      group_name: 'TIRA STRASS 6MM',
      color_mode: 'select_on_order',
    }),
  ];

  it('remapeia id ordinal por rótulo e resolve color_id pelo nome', () => {
    const result = remapLegacyStrapsForDuplicate({
      snapshotLines: [
        {
          id: '1',
          label: 'TIRA 1',
          group_id: GROUP_STRASS,
          color: 'ROSADO COM FUNDO ROSADO',
        },
        {
          id: '2',
          label: 'TIRA 2',
          group_id: GROUP_MEIA,
          color: 'TAN',
        },
        {
          id: '3',
          label: 'TIRA 3',
          group_id: GROUP_STRASS,
          color: 'ROSADO COM FUNDO ROSADO',
        },
      ],
      technicalLines: technical,
      resolveColorId,
      itemLabel: 'NL02 / NEW TAN',
    });

    expect(result.remapped).toBe(true);
    expect(result.lines.map((l) => l.technical_strap_line_id)).toEqual([
      LINE_A, LINE_B, LINE_C,
    ]);
    expect(result.lines[0]).toMatchObject({
      color: 'ROSADO COM FUNDO ROSADO',
      color_id: COLOR_ROSADO,
      identity_basis: 'finished_product_group',
    });
    expect(result.lines[1]).toMatchObject({
      color_mode: 'follow_main',
      color: 'TAN',
    });
    expect(result.lines[2]).toMatchObject({
      color_id: COLOR_ROSADO,
    });
  });

  it('preserva snapshot já canônico sem inventar troca de UUID', () => {
    const snapshot = technical.map((line, i) => ({
      ...line,
      color: i === 1 ? 'TAN' : 'ROSADO COM FUNDO ROSADO',
      color_id: i === 1 ? COLOR_TAN : COLOR_ROSADO,
    }));
    const result = remapLegacyStrapsForDuplicate({
      snapshotLines: snapshot,
      technicalLines: technical,
      resolveColorId,
    });
    expect(result.remapped).toBe(false);
    expect(result.lines.map((l) => l.color_id)).toEqual([
      COLOR_ROSADO, COLOR_TAN, COLOR_ROSADO,
    ]);
  });

  it('falha com mensagem clara quando select_on_order fica sem cor', () => {
    expect(() => remapLegacyStrapsForDuplicate({
      snapshotLines: [{ id: '1', label: 'TIRA 1', color: 'ROSADO COM FUNDO ROSADO' }],
      technicalLines: technical,
      resolveColorId,
      itemLabel: 'NL02 / PRETO',
    })).toThrow(/NL02 \/ PRETO, TIRA 3/);
  });

  it('ficha sem tiras devolve vazio', () => {
    expect(remapLegacyStrapsForDuplicate({
      snapshotLines: [{ id: '1', label: 'TIRA 1' }],
      technicalLines: [],
      resolveColorId,
    })).toEqual({ lines: [], remapped: true });
  });
});
