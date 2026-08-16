import { describe, expect, it } from 'vitest';
import { buildBulkSolePatch, evaluateTechnicalSheetReadiness } from '@/lib/technicalSheetReadiness';

const completeSheet = {
  name: 'DS20',
  shoe_category: 'Feminino',
  status_ficha: 'publicada',
  ncm: '64029990',
  primary_sole_id: 'sole-1',
  sole_consumption: 1,
  has_straps: false,
  upper_material: 'NAPA SOFT',
  upper_consumption: 8.5,
  upper_consumption_per_size: {},
  insole_ready_made: false,
  insole_material: 'PLACA EVA',
  sole_drives_consumption: true,
  production_sectors: ['Corte', 'Montagem'],
  sale_price: 79.9,
};

describe('evaluateTechnicalSheetReadiness', () => {
  it('não cobra cabedal de modelo de tiras quando as tiras estão configuradas', () => {
    const stages = evaluateTechnicalSheetReadiness({
      ...completeSheet,
      has_straps: true,
      upper_material: '',
      upper_consumption: 0,
      strap_colors: [{ group_id: 'group-1', consumption_per_size: { 34: 18 } }],
    });

    expect(stages.find((stage) => stage.key === 'engineering')?.issues).not.toContain('material do cabedal');
    expect(stages.find((stage) => stage.key === 'engineering')?.issues).not.toContain('consumo do cabedal');
  });

  it('não cobra placa nem consumo de área quando a palmilha é pronta', () => {
    const stages = evaluateTechnicalSheetReadiness({
      ...completeSheet,
      insole_ready_made: true,
      insole_material: '',
      insole_consumption: 0,
    });

    expect(stages.find((stage) => stage.key === 'engineering')?.issues).not.toContain('material da palmilha');
    expect(stages.find((stage) => stage.key === 'engineering')?.issues).not.toContain('consumo da palmilha');
  });

  it('bloqueia publicação sem identidade do solado e sem NCM válido', () => {
    const stages = evaluateTechnicalSheetReadiness({ ...completeSheet, primary_sole_id: null, ncm: '6402' });

    expect(stages.find((stage) => stage.key === 'identity')?.issues).toContain('NCM válido');
    expect(stages.find((stage) => stage.key === 'engineering')?.issues).toContain('solado principal');
  });
});

describe('buildBulkSolePatch', () => {
  it('leva junto o UUID do solado principal e a configuração técnica', () => {
    expect(buildBulkSolePatch(
      { sole_material: '', primary_sole_id: null, sole_group_id: null, sole_consumption: 0, sole_process: '' },
      { primary_sole_id: 'sole-1', sole_group_id: 'group-1', sole_consumption: 1, sole_process: 'Colada' },
      '01',
      false,
    )).toEqual({
      sole_material: '01',
      primary_sole_id: 'sole-1',
      sole_group_id: 'group-1',
      sole_consumption: 1,
      sole_process: 'Colada',
    });
  });

  it('não troca a identidade de uma ficha preenchida sem autorização de sobrescrita', () => {
    expect(buildBulkSolePatch(
      { sole_material: '238', primary_sole_id: 'old', sole_group_id: 'old-group', sole_consumption: 1, sole_process: 'Colada' },
      { primary_sole_id: 'new', sole_group_id: 'new-group', sole_consumption: 1, sole_process: 'Injetada' },
      '01',
      false,
    )).toEqual({});
  });
});
