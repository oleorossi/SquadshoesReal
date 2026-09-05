import { describe, expect, it } from 'vitest';
import {
  reconcileEditableStrapSnapshots,
  sameTechnicalStrapStructure,
  strapPresentationLines,
  technicalStrapSequenceSignature,
  type ReconcileStrapLineLike,
} from '@/lib/reconcileStrapSnapshots';

const lineA = '0198f35c-7f4d-7000-8000-000000000001';
const lineB = '0198f35c-7f4d-7000-8000-000000000002';
const lineC = '0198f35c-7f4d-7000-8000-000000000003';
const typeA = '11111111-1111-4111-8111-111111111111';
const typeB = '22222222-2222-4222-8222-222222222222';
const measureA = '33333333-3333-4333-8333-333333333333';
const measureB = '44444444-4444-4444-8444-444444444444';
const red = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const blue = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function strap(
  lineId: string,
  overrides: Partial<ReconcileStrapLineLike> = {},
): ReconcileStrapLineLike {
  return {
    id: lineId,
    technical_strap_line_id: lineId,
    label: lineId === lineA ? 'TIRA 1' : 'TIRA 2',
    strap_type_id: typeA,
    measure_id: measureA,
    identity_basis: 'reference_base',
    color_mode: 'select_on_order',
    identity_group_id: null,
    group_id: 'group-base',
    consumption: 36,
    consumption_per_size: { '35': 36, '36': 38 },
    color: 'VERMELHO',
    color_id: red,
    ...overrides,
  };
}

describe('strapPresentationLines', () => {
  it('distingue ficha ainda não carregada de remoção autoritativa de todas as tiras', () => {
    const snapshot = [strap(lineA)];
    expect(strapPresentationLines(snapshot, undefined, false)).toBe(snapshot);
    expect(strapPresentationLines(snapshot, [], false)).toEqual([]);
    expect(strapPresentationLines(snapshot, [], true)).toBe(snapshot);
    const reconciled = reconcileEditableStrapSnapshots({snapshotLines: snapshot, technicalLines: [],
      sourcing: {[lineA]: {source_mode: 'internal', color_id: red, strap_variant_id: lineC}}});
    expect(reconciled.lines).toEqual([]);
    expect(reconciled.sourcing).toEqual({});
    expect(reconciled.changes).toContainEqual({kind:'removed', lineId:lineA, ordinal:0});
  });
  it('devolve o snapshot comprometido integral sem misturar a ficha atual', () => {
    const historical = [strap(lineA, {
      label: 'TIRA HISTÓRICA',
      consumption: 36,
      measure_id: measureA,
      color: 'AZUL',
      color_id: blue,
    })];
    const currentSheet = [strap(lineA, {
      label: 'TIRA RENOMEADA',
      consumption: 70,
      measure_id: measureB,
      color: '',
      color_id: null,
    })];

    const presented = strapPresentationLines(historical, currentSheet, true);

    expect(presented).toBe(historical);
    expect(presented[0]).toMatchObject({
      label: 'TIRA HISTÓRICA',
      consumption: 36,
      measure_id: measureA,
      color: 'AZUL',
      color_id: blue,
    });
  });

  it('em rascunho usa a estrutura atual sem perder a escolha comercial', () => {
    const snapshot = [strap(lineA, { color: 'AZUL', color_id: blue })];
    const currentSheet = [strap(lineA, {
      label: 'TIRA ATUAL',
      measure_id: measureB,
      consumption: 70,
      color: '',
      color_id: null,
    })];

    expect(strapPresentationLines(snapshot, currentSheet, false)[0]).toMatchObject({
      label: 'TIRA ATUAL',
      measure_id: measureB,
      consumption: 70,
      color: 'AZUL',
      color_id: blue,
    });
  });
});

describe('reconcileEditableStrapSnapshots', () => {
  it('propaga mudança somente de família/medida, preserva cor e invalida sourcing', () => {
    const snapshot = strap(lineA, { color: 'AZUL', color_id: blue });
    const technical = strap(lineA, {
      strap_type_id: typeB,
      measure_id: measureB,
      color: '',
      color_id: null,
    });
    const result = reconcileEditableStrapSnapshots({
      snapshotLines: [snapshot],
      technicalLines: [technical],
      sourcing: {
        [lineA]: {
          source_mode: 'internal',
          color_id: blue,
          strap_variant_id: lineC,
          recipe_id: lineB,
          gross_required_m: 12,
        },
      },
    });

    expect(result.lines[0]).toMatchObject({
      strap_type_id: typeB,
      measure_id: measureB,
      color: 'AZUL',
      color_id: blue,
    });
    expect(result.sourcing).not.toHaveProperty(lineA);
    expect(result.changes).toContainEqual({
      kind: 'structure_changed',
      lineId: lineA,
      ordinal: 0,
    });
  });

  it('reordena por UUID sem trocar as cores entre posições', () => {
    const first = strap(lineA, { color: 'VERMELHO', color_id: red });
    const second = strap(lineB, { color: 'AZUL', color_id: blue });
    const sourcing = {
      [lineA]: { source_mode: 'internal' as const, color_id: red, strap_variant_id: lineC },
      [lineB]: { source_mode: 'internal' as const, color_id: blue, strap_variant_id: lineC },
    };

    const result = reconcileEditableStrapSnapshots({
      snapshotLines: [first, second],
      technicalLines: [
        strap(lineB, { color: '', color_id: null }),
        strap(lineA, { color: '', color_id: null }),
      ],
      sourcing,
    });

    expect(result.orderChanged).toBe(true);
    expect(result.lines.map((line) => [line.technical_strap_line_id, line.color_id])).toEqual([
      [lineB, blue],
      [lineA, red],
    ]);
    expect(result.sourcing).toEqual(sourcing);
  });

  it('inclui/remove linhas sem transferir cor ou origem pela posição', () => {
    const sourceA = { source_mode: 'internal' as const, color_id: red, strap_variant_id: lineC };
    const sourceB = { source_mode: 'internal' as const, color_id: blue, strap_variant_id: lineC };
    const result = reconcileEditableStrapSnapshots({
      snapshotLines: [
        strap(lineA, { color: 'VERMELHO', color_id: red }),
        strap(lineB, { color: 'AZUL', color_id: blue }),
      ],
      technicalLines: [
        strap(lineB, { color: '', color_id: null }),
        strap(lineC, { color: '', color_id: null }),
      ],
      sourcing: { [lineA]: sourceA, [lineB]: sourceB },
    });

    expect(result.lines.map((line) => [line.technical_strap_line_id, line.color_id])).toEqual([
      [lineB, blue],
      [lineC, null],
    ]);
    expect(result.sourcing).toEqual({ [lineB]: sourceB });
    expect(result.changes).toEqual(expect.arrayContaining([
      { kind: 'removed', lineId: lineA, ordinal: 0 },
      { kind: 'added', lineId: lineC, ordinal: 1 },
    ]));
  });

  it('mudança para seguir a cor principal limpa a seleção e a origem antigas', () => {
    const result = reconcileEditableStrapSnapshots({
      snapshotLines: [strap(lineA, { color: 'AZUL', color_id: blue })],
      technicalLines: [strap(lineA, {
        color_mode: 'follow_main',
        color: '',
        color_id: null,
      })],
      sourcing: {
        [lineA]: { source_mode: 'internal', color_id: blue, strap_variant_id: lineC },
      },
    });

    expect(result.lines[0]).toMatchObject({
      color_mode: 'follow_main',
      color: '',
      color_id: null,
    });
    expect(result.sourcing).toEqual({});
    expect(result.changes).toContainEqual({
      kind: 'color_cleared',
      lineId: lineA,
      ordinal: 0,
    });
  });

  it('mudança para seleção no pedido não reaproveita automaticamente a cor principal', () => {
    const result = reconcileEditableStrapSnapshots({
      snapshotLines: [strap(lineA, {
        color_mode: 'follow_main',
        color: 'VERMELHO',
        color_id: red,
      })],
      technicalLines: [strap(lineA, {
        color_mode: 'select_on_order',
        color: '',
        color_id: null,
      })],
      sourcing: {
        [lineA]: { source_mode: 'internal', color_id: red, strap_variant_id: lineC },
      },
    });

    expect(result.lines[0]).toMatchObject({
      color_mode: 'select_on_order',
      color: '',
      color_id: null,
    });
    expect(result.sourcing).toEqual({});
  });

  it('não infere identidade para linha legada e exige revisão da linha canônica', () => {
    const legacy: ReconcileStrapLineLike = {
      id: '1',
      label: 'TIRA 1',
      color_mode: 'select_on_order' as const,
      color: 'AZUL',
      color_id: blue,
    };
    const result = reconcileEditableStrapSnapshots({
      snapshotLines: [legacy],
      technicalLines: [strap(lineA, { color: '', color_id: null })],
      sourcing: {},
    });

    expect(result.lines[0]).toMatchObject({
      technical_strap_line_id: lineA,
      color: '',
      color_id: null,
    });
    expect(result.changes).toEqual(expect.arrayContaining([
      { kind: 'legacy_unmatched', lineId: null, ordinal: 0 },
      { kind: 'added', lineId: lineA, ordinal: 0 },
    ]));
  });

  it('limpa cor que o catálogo informa não ser mais válida', () => {
    const result = reconcileEditableStrapSnapshots({
      snapshotLines: [strap(lineA, { color: 'AZUL', color_id: blue })],
      technicalLines: [strap(lineA, { color: '', color_id: null })],
      sourcing: {},
      canPreserveColor: () => false,
    });

    expect(result.lines[0]).toMatchObject({ color: '', color_id: null });
  });
});

describe('comparador estrutural', () => {
  it('inclui família, medida e ordem, mas não a cor comercial', () => {
    const first = strap(lineA);
    const second = strap(lineB, { color: 'AZUL', color_id: blue });

    expect(sameTechnicalStrapStructure(first, { ...first, color: 'AZUL', color_id: blue }))
      .toBe(true);
    expect(sameTechnicalStrapStructure(first, { ...first, strap_type_id: typeB })).toBe(false);
    expect(sameTechnicalStrapStructure(first, { ...first, measure_id: measureB })).toBe(false);
    expect(technicalStrapSequenceSignature([first, second]))
      .not.toBe(technicalStrapSequenceSignature([second, first]));
  });
});
