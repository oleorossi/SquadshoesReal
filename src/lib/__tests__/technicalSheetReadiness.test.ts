import { describe, expect, it } from 'vitest';
import { buildBulkSolePatch, evaluateTechnicalSheetReadiness, firstBlockingReadinessStage } from '@/lib/technicalSheetReadiness';

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

const readyAudit = {};

describe('evaluateTechnicalSheetReadiness', () => {
  it('não cobra cabedal de modelo de tiras quando as tiras estão configuradas', () => {
    const stages = evaluateTechnicalSheetReadiness({
      ...completeSheet,
      has_straps: true,
      upper_material: '',
      upper_consumption: 0,
      strap_colors: [{ group_id: 'group-1', consumption_per_size: { 34: 18 } }],
    }, readyAudit);

    expect(stages.find((stage) => stage.key === 'engineering')?.issues).not.toContain('material do cabedal');
    expect(stages.find((stage) => stage.key === 'engineering')?.issues).not.toContain('consumo do cabedal');
  });

  it('não cobra placa nem consumo de área quando a palmilha é pronta', () => {
    const stages = evaluateTechnicalSheetReadiness({
      ...completeSheet,
      insole_ready_made: true,
      insole_material: '',
      insole_consumption: 0,
    }, readyAudit);

    expect(stages.find((stage) => stage.key === 'engineering')?.issues).not.toContain('material da palmilha');
    expect(stages.find((stage) => stage.key === 'engineering')?.issues).not.toContain('consumo da palmilha');
  });

  it('bloqueia publicação sem identidade do solado e sem NCM válido', () => {
    const stages = evaluateTechnicalSheetReadiness({ ...completeSheet, primary_sole_id: null, ncm: '6402' }, readyAudit);

    expect(stages.find((stage) => stage.key === 'identity')?.issues).toContain('NCM válido');
    expect(stages.find((stage) => stage.key === 'engineering')?.issues).toContain('solado principal');
  });

  it('exige NCM na transição para validada, não só depois de publicada', () => {
    const rascunho = evaluateTechnicalSheetReadiness({ ...completeSheet, status_ficha: 'rascunho', ncm: '' }, readyAudit);
    const validada = evaluateTechnicalSheetReadiness({ ...completeSheet, status_ficha: 'validada', ncm: '' }, readyAudit);

    expect(rascunho.find((stage) => stage.key === 'identity')?.issues).not.toContain('NCM válido');
    expect(validada.find((stage) => stage.key === 'identity')?.issues).toContain('NCM válido');
  });

  it('manda Liberação para Identificação (status mora lá, não em Precificação)', () => {
    const stages = evaluateTechnicalSheetReadiness({ ...completeSheet, status_ficha: 'rascunho' }, readyAudit);
    expect(stages.find((stage) => stage.key === 'release')?.tab).toBe('id');
  });

  it('manda tiras incompletas para Range Aviamento', () => {
    const stages = evaluateTechnicalSheetReadiness({
      ...completeSheet,
      has_straps: true,
      strap_colors: [{ label: 'Tira 1' }],
    }, readyAudit);
    expect(stages.find((stage) => stage.key === 'engineering')?.tab).toBe('range-aviamento');
  });

  it('não pinta Estoque pronto enquanto a auditoria não carregou', () => {
    const stages = evaluateTechnicalSheetReadiness(completeSheet);
    expect(stages.find((stage) => stage.key === 'stock')?.ready).toBe(false);
    expect(stages.find((stage) => stage.key === 'stock')?.issues).toContain('auditoria de estoque');
  });

  it('firstBlockingReadinessStage aponta a primeira etapa vermelha', () => {
    const blocking = firstBlockingReadinessStage({ ...completeSheet, primary_sole_id: null }, readyAudit);
    expect(blocking?.key).toBe('engineering');
  });

  it('não trata auditoria ausente como estoque pronto na publicação', () => {
    const blocking = firstBlockingReadinessStage(completeSheet, null);
    expect(blocking?.key).toBe('stock');
    expect(blocking?.issues).toContain('auditoria de estoque');
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
