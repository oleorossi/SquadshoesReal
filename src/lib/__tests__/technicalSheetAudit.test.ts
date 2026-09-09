import { describe, expect, it } from 'vitest';

import {
  getTechnicalSheetAuditGapForIssueCode,
  getTechnicalSheetAuditGaps,
  type TechnicalSheetAuditRow,
} from '@/lib/technicalSheetAudit';

const completeRow: TechnicalSheetAuditRow = {
  id: 'sheet-1',
  code: 'SP131',
  name: 'SP131',
  status: 'Ativo',
  sole_drives_consumption: false,
  missing_upper_material: false,
  missing_upper_consumption: false,
  missing_lining_material: false,
  missing_lining_consumption: false,
  missing_insole_material: false,
  missing_insole_consumption: false,
  missing_sole_material: false,
  missing_sole_consumption: false,
  sole_fachetado_sem_fachete: false,
  sole_driven_but_specs_missing: false,
  missing_sole_color_mapping: false,
  straps_without_colors: false,
  straps_without_group: false,
  missing_mod: false,
  upper_per_size_partial_no_fallback: false,
  missing_production_sectors: false,
  missing_primary_sole_id: false,
  invalid_published_ncm: false,
  unit_configuration_issue: false,
  area_material_width_missing: false,
};

describe('technicalSheetAudit', () => {
  it('retorna somente as pendências ativas da ficha, com rótulos legíveis', () => {
    const gaps = getTechnicalSheetAuditGaps({
      ...completeRow,
      missing_insole_material: true,
      missing_production_sectors: true,
    });

    expect(gaps).toEqual([
      { key: 'missing_insole_material', label: 'Grupo da palmilha', severity: 'critical' },
      { key: 'missing_production_sectors', label: 'Setores de produção não configurados', severity: 'critical' },
    ]);
  });

  it('traduz o código técnico do bloqueio do pedido para a mesma pendência da auditoria', () => {
    expect(getTechnicalSheetAuditGapForIssueCode('technical_sheet_missing_insole_material')).toEqual({
      key: 'missing_insole_material',
      label: 'Grupo da palmilha',
      severity: 'critical',
    });
    expect(getTechnicalSheetAuditGapForIssueCode('technical_sheet_audit_missing')).toBeNull();
  });
});
