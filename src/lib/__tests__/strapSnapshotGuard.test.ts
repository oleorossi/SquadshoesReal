import { describe, expect, it } from 'vitest';
import { listMissingTechnicalStrapSnapshots } from '../strapSnapshotGuard';

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

  it('não transforma flag órfã de modelo com cabedal em demanda de tira', () => {
    expect(listMissingTechnicalStrapSnapshots(
      [{ reference_id: 'cabedal', strap_colors: [] }],
      [{ id: 'cabedal', has_straps: true, upper_material: 'NAPA', strap_colors: [] }],
    )).toEqual([]);
  });
});

