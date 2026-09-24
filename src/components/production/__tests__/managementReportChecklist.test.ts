import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_SECTOR_ORDER,
  buildLineGroups,
  corrugadoGradeKey,
  eligibleSectorsForLine,
  fillGradeSizeRange,
  materialForChecklistSector,
  orderEligibleForChecklistSector,
  type ReportOrder,
} from '@/components/production/ManagementReport';
import {
  isOperatorPrintSector,
  reverseOutputAllowed,
} from '@/components/production/printReverseGate';

describe('ManagementReport checklist eligibility', () => {
  const base = (over: Partial<ReportOrder> = {}): ReportOrder => ({
    id: '1',
    total_pairs: 12,
    reference_name: 'LA01',
    color: 'OFF WHITE',
    production_sectors: ['Corte Palmilha', 'Corte Forração', 'Montagem', 'Expedição'],
    requires_upper_cut: false,
    requires_upper_sewing: false,
    requires_lining_cut: true,
    ...over,
  });

  it('CHECKLIST_SECTOR_ORDER usa nomes das fichas de impressão', () => {
    expect(CHECKLIST_SECTOR_ORDER).toContain('Corte Palmilha');
    expect(CHECKLIST_SECTOR_ORDER).toContain('Corte Cabedal');
    expect(CHECKLIST_SECTOR_ORDER).not.toContain('Corte Fibra');
  });

  it('Corte Forração exige roteiro + requires_lining_cut', () => {
    expect(orderEligibleForChecklistSector(base(), 'Corte Forração')).toBe(true);
    expect(orderEligibleForChecklistSector(base({ requires_lining_cut: false }), 'Corte Forração')).toBe(false);
    expect(orderEligibleForChecklistSector(
      base({ production_sectors: ['Montagem'] }),
      'Corte Forração',
    )).toBe(false);
  });

  it('Corte Cabedal ignora production_sectors e usa requires_upper_cut', () => {
    expect(orderEligibleForChecklistSector(
      base({ production_sectors: [], requires_upper_cut: true }),
      'Corte Cabedal',
    )).toBe(true);
    expect(orderEligibleForChecklistSector(
      base({ production_sectors: ['Corte Cabedal'], requires_upper_cut: false }),
      'Corte Cabedal',
    )).toBe(false);
  });

  it('setor genérico segue sheetHasSector (lista vazia = todos)', () => {
    expect(orderEligibleForChecklistSector(
      base({ production_sectors: [] }),
      'Montagem',
    )).toBe(true);
    expect(orderEligibleForChecklistSector(
      base({ production_sectors: ['Expedição'] }),
      'Montagem',
    )).toBe(false);
  });

  it('eligibleSectorsForLine lista setores na ordem de fábrica', () => {
    const sectors = eligibleSectorsForLine({
      production_sectors: ['Corte Palmilha', 'Corte Forração', 'Montagem', 'Expedição'],
      requires_upper_cut: false,
      requires_upper_sewing: false,
      requires_lining_cut: true,
    });
    expect(sectors[0]).toBe('Corte Palmilha');
    expect(sectors).toContain('Corte Forração');
    expect(sectors).toContain('Montagem');
    expect(sectors).not.toContain('Corte Cabedal');
    expect(sectors.indexOf('Corte Forração')).toBeLessThan(sectors.indexOf('Montagem'));
  });
});

describe('materialForChecklistSector', () => {
  const mats = {
    itemMaterial: 'NAPA SUDANI',
    upperMaterial: 'NAPA SUDANI',
    liningMaterial: 'NAPA SOFT',
    insoleMaterial: 'PALMILHA EVA',
    soleName: 'SOLADO 01',
  };

  it('qualquer setor → material comercial do item (cabedal/variante)', () => {
    expect(materialForChecklistSector(mats, 'Corte Cabedal')).toBe('NAPA SUDANI');
    expect(materialForChecklistSector(mats, 'Corte Forração')).toBe('NAPA SUDANI');
    expect(materialForChecklistSector(mats, 'Corte Palmilha')).toBe('NAPA SUDANI');
    expect(materialForChecklistSector(mats, 'Aviamento')).toBe('NAPA SUDANI');
  });

  it('sem itemMaterial cai em upper, depois lining', () => {
    expect(materialForChecklistSector({
      itemMaterial: null,
      upperMaterial: 'NAPA SOFT + MASSABOX',
      liningMaterial: 'NAPA SOFT',
      insoleMaterial: null,
      soleName: null,
    }, 'Corte Forração')).toBe('NAPA SOFT + MASSABOX');
  });
});

describe('grade corrugado no Relatório Gerencial', () => {
  it('fillGradeSizeRange preenche do primeiro ao último número', () => {
    expect(fillGradeSizeRange({ '34': 1, '36': 3, '40': 1 })).toEqual({
      '34': 1, '35': 0, '36': 3, '37': 0, '38': 0, '39': 0, '40': 1,
    });
  });

  it('buildLineGroups preserva curva do corrugado e soma o total', () => {
    const curve = { '34': 1, '35': 2, '36': 3, '37': 3, '38': 3, '39': 2, '40': 1 };
    const total = { '34': 12, '35': 24, '36': 36, '37': 36, '38': 36, '39': 24, '40': 12 };
    const lines = buildLineGroups([
      {
        id: 'a',
        total_pairs: 180,
        reference_name: 'SP201',
        color: 'PRETO',
        grade: total,
        corrugado_grade: curve,
        fichas: 12,
        production_sectors: ['Montagem', 'Expedição'],
        requires_upper_cut: false,
        requires_upper_sewing: false,
        requires_lining_cut: false,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].corrugadoGrade).toEqual(curve);
    expect(lines[0].grade).toEqual(total);
    expect(lines[0].fichas).toBe(12);
    expect(lines[0].mixedCorrugado).toBe(false);
  });

  it('buildLineGroups omite corrugado quando curvas misturam', () => {
    const lines = buildLineGroups([
      {
        id: 'a',
        total_pairs: 15,
        reference_name: 'SP201',
        color: 'PRETO',
        grade: { '34': 1, '35': 2, '36': 3, '37': 3, '38': 3, '39': 2, '40': 1 },
        corrugado_grade: { '34': 1, '35': 2, '36': 3, '37': 3, '38': 3, '39': 2, '40': 1 },
        fichas: 1,
        production_sectors: ['Montagem'],
        requires_upper_cut: false,
        requires_upper_sewing: false,
        requires_lining_cut: false,
      },
      {
        id: 'b',
        total_pairs: 12,
        reference_name: 'SP201',
        color: 'PRETO',
        grade: { '34': 2, '35': 2, '36': 2, '37': 2, '38': 2, '39': 1, '40': 1 },
        corrugado_grade: { '34': 2, '35': 2, '36': 2, '37': 2, '38': 2, '39': 1, '40': 1 },
        fichas: 1,
        production_sectors: ['Montagem'],
        requires_upper_cut: false,
        requires_upper_sewing: false,
        requires_lining_cut: false,
      },
    ]);
    expect(corrugadoGradeKey(lines[0].corrugadoGrade)).toBe('');
    expect(lines[0].mixedCorrugado).toBe(true);
    expect(lines[0].grade['34']).toBe(3);
  });
});

describe('Inverter saída — fichas de operador', () => {
  it('setores de fábrica são fichas de operador; Relatório não', () => {
    expect(isOperatorPrintSector('Corte Cabedal')).toBe(true);
    expect(isOperatorPrintSector('Expedição')).toBe(true);
    expect(isOperatorPrintSector('Relatório Gerencial')).toBe(false);
  });

  it('desabilita inverter quando há qualquer ficha de operador no A4', () => {
    expect(reverseOutputAllowed({ isA4: true, sectors: ['Corte Palmilha'] })).toBe(false);
    expect(reverseOutputAllowed({ isA4: true, sectors: ['Corte Cabedal', 'Relatório Gerencial'] })).toBe(false);
    expect(reverseOutputAllowed({ isA4: true, sectors: ['Relatório Gerencial'] })).toBe(true);
  });

  it('cartão/caixa (!isA4) ainda podem inverter', () => {
    expect(reverseOutputAllowed({ isA4: false, sectors: ['Corte Cabedal'] })).toBe(true);
  });
});
