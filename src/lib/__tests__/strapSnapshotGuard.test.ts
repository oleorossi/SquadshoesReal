import { describe, expect, it } from 'vitest';
import {
  listMissingTechnicalStrapSnapshots,
  recoverEmptyStrapSnapshotsForSubmit,
  shouldSkipCommittedStrapReconcile,
} from '../strapSnapshotGuard';

describe('listMissingTechnicalStrapSnapshots', () => {
  it('bloqueia a referência de tira quando o snapshot do item está vazio', () => {
    expect(listMissingTechnicalStrapSnapshots(
      [{ reference_id: 'soft', reference_label: 'SOFT', strap_colors: [] }],
      [{ id: 'soft', name: 'SOFT', has_straps: true, strap_colors: [] }],
    )).toEqual([{ index: 0, referenceId: 'soft', label: 'SOFT' }]);
  });

  it('sai do bloqueio somente quando uma linha técnica existe no snapshot', () => {
    expect(listMissingTechnicalStrapSnapshots(
      [{ reference_id: 'soft', strap_colors: [{ technical_strap_line_id: 'line-1' }] }],
      [{ id: 'soft', name: 'SOFT', has_straps: true }],
    )).toEqual([]);
  });

  it('bloqueia snapshot ausente quando cabedal e tiras coexistem', () => {
    expect(listMissingTechnicalStrapSnapshots(
      [{ reference_id: 'cabedal', strap_colors: [] }],
      [{ id: 'cabedal', has_straps: true, upper_material: 'NAPA', strap_colors: [] }],
    )).toEqual([{ index: 0, referenceId: 'cabedal', label: 'item 1' }]);
  });
});

describe('shouldSkipCommittedStrapReconcile', () => {
  it('preserva snapshot comprometido com linhas', () => {
    expect(shouldSkipCommittedStrapReconcile({
      preserveCommitted: true,
      snapshotLength: 4,
      technicalDefinitionsLength: 4,
      hasStraps: true,
    })).toBe(true);
  });

  it('recupera snapshot comprometido vazio quando a ficha exige tiras', () => {
    expect(shouldSkipCommittedStrapReconcile({
      preserveCommitted: true,
      snapshotLength: 0,
      technicalDefinitionsLength: 1,
      hasStraps: true,
    })).toBe(false);
  });

  it('não força reconcile em rascunho (não comprometido)', () => {
    expect(shouldSkipCommittedStrapReconcile({
      preserveCommitted: false,
      snapshotLength: 0,
      technicalDefinitionsLength: 1,
      hasStraps: true,
    })).toBe(false);
  });

  it('preserva [] quando a ficha não exige tiras', () => {
    expect(shouldSkipCommittedStrapReconcile({
      preserveCommitted: true,
      snapshotLength: 0,
      technicalDefinitionsLength: 0,
      hasStraps: false,
    })).toBe(true);
  });
});

describe('recoverEmptyStrapSnapshotsForSubmit', () => {
  const lineId = 'c089b1bb-c4da-49c5-af04-54e4be8c503b';
  const ds20Ref = {
    id: 'ds20',
    code: 'DS20',
    name: 'SP124',
    has_straps: true,
    strap_colors: [{
      id: lineId,
      technical_strap_line_id: lineId,
      label: 'TIRA 1',
      color_mode: 'follow_main',
      measure_id: '0166b326-2023-4427-a165-aada45ee5611',
    }],
  };

  it('reidrata snapshot vazio da ficha e libera o guard', () => {
    const { items, recoveredEmpty } = recoverEmptyStrapSnapshotsForSubmit(
      [{ reference_id: 'ds20', color: 'OFF WHITE', strap_colors: [], strap_sourcing: {} }],
      [ds20Ref],
    );
    expect(recoveredEmpty).toBe(1);
    expect(items[0].strap_colors).toHaveLength(1);
    expect(listMissingTechnicalStrapSnapshots(items, [ds20Ref])).toEqual([]);
  });

  it('hidrata pv_origem a partir do sourcing operacional', () => {
    const { items, hydratedOrigem } = recoverEmptyStrapSnapshotsForSubmit(
      [{
        reference_id: 'ds20',
        color: 'PRETO',
        strap_colors: [{
          technical_strap_line_id: lineId,
          label: 'TIRA 1',
          measure_id: '0166b326-2023-4427-a165-aada45ee5611',
          pv_origem: null,
        }],
        strap_sourcing: { [lineId]: { source_mode: 'internal' } },
      }],
      [ds20Ref],
    );
    expect(hydratedOrigem).toBe(1);
    expect((items[0].strap_colors as any[])[0].pv_origem).toBe('fabrica');
  });
});
