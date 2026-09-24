import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_SECTOR_ORDER,
  eligibleSectorsForLine,
  materialForChecklistSector,
  orderEligibleForChecklistSector,
  type ReportOrder,
} from '@/components/production/ManagementReport';

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
