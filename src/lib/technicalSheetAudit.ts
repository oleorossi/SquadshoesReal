export type TechnicalSheetAuditGapSeverity = 'critical' | 'warn';

export type TechnicalSheetAuditGapKey =
  | 'missing_upper_material'
  | 'missing_upper_consumption'
  | 'missing_lining_material'
  | 'missing_lining_consumption'
  | 'missing_insole_material'
  | 'missing_insole_consumption'
  | 'missing_sole_material'
  | 'missing_sole_consumption'
  | 'sole_fachetado_sem_fachete'
  | 'sole_driven_but_specs_missing'
  | 'missing_sole_color_mapping'
  | 'straps_without_colors'
  | 'straps_without_group'
  | 'missing_mod'
  | 'upper_per_size_partial_no_fallback'
  | 'missing_production_sectors'
  | 'missing_primary_sole_id'
  | 'invalid_published_ncm'
  | 'unit_configuration_issue'
  | 'area_material_width_missing';

export interface TechnicalSheetAuditRow {
  id: string;
  code: string;
  name: string;
  status: string | null;
  sole_drives_consumption: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  missing_upper_material: boolean;
  missing_upper_consumption: boolean;
  missing_lining_material: boolean;
  missing_lining_consumption: boolean;
  missing_insole_material: boolean;
  missing_insole_consumption: boolean;
  missing_sole_material: boolean;
  missing_sole_consumption: boolean;
  sole_fachetado_sem_fachete: boolean;
  sole_driven_but_specs_missing: boolean;
  missing_sole_color_mapping: boolean;
  straps_without_colors: boolean;
  straps_without_group: boolean;
  missing_mod: boolean;
  upper_per_size_partial_no_fallback: boolean;
  missing_production_sectors: boolean;
  missing_primary_sole_id: boolean;
  invalid_published_ncm: boolean;
  unit_configuration_issue: boolean;
  area_material_width_missing: boolean;
}

export interface TechnicalSheetAuditGap {
  key: TechnicalSheetAuditGapKey;
  label: string;
  severity: TechnicalSheetAuditGapSeverity;
}

export const TECHNICAL_SHEET_AUDIT_GAPS: readonly TechnicalSheetAuditGap[] = [
  { key: 'missing_upper_material', label: 'Grupo do cabedal', severity: 'critical' },
  { key: 'missing_upper_consumption', label: 'Consumo do cabedal', severity: 'critical' },
  { key: 'missing_lining_material', label: 'Grupo da forração', severity: 'critical' },
  { key: 'missing_lining_consumption', label: 'Consumo da forração', severity: 'critical' },
  { key: 'missing_insole_material', label: 'Grupo da palmilha', severity: 'critical' },
  { key: 'missing_insole_consumption', label: 'Consumo da palmilha', severity: 'critical' },
  { key: 'missing_sole_material', label: 'Grupo do solado', severity: 'critical' },
  { key: 'missing_sole_consumption', label: 'Consumo do solado', severity: 'critical' },
  { key: 'sole_driven_but_specs_missing', label: 'Solado dirige consumo mas não tem specs', severity: 'critical' },
  { key: 'missing_sole_color_mapping', label: 'Cores do solado', severity: 'warn' },
  { key: 'sole_fachetado_sem_fachete', label: 'Fachete (solado fachetado)', severity: 'warn' },
  { key: 'straps_without_colors', label: 'Tiras sem cores', severity: 'warn' },
  { key: 'straps_without_group', label: 'Tiras sem grupo', severity: 'warn' },
  { key: 'missing_mod', label: 'MOD (mão-de-obra)', severity: 'warn' },
  { key: 'upper_per_size_partial_no_fallback', label: 'Cabedal per-size parcial', severity: 'warn' },
  { key: 'missing_production_sectors', label: 'Setores de produção não configurados', severity: 'critical' },
  { key: 'missing_primary_sole_id', label: 'Solado principal sem vínculo de estoque', severity: 'critical' },
  { key: 'invalid_published_ncm', label: 'NCM inválido em ficha publicada', severity: 'critical' },
  { key: 'unit_configuration_issue', label: 'Unidade ou conversão de estoque', severity: 'critical' },
  { key: 'area_material_width_missing', label: 'Largura do material de área', severity: 'critical' },
];

const TECHNICAL_SHEET_AUDIT_GAP_BY_KEY = new Map(
  TECHNICAL_SHEET_AUDIT_GAPS.map(gap => [gap.key, gap]),
);

export function getTechnicalSheetAuditGaps(row: TechnicalSheetAuditRow): TechnicalSheetAuditGap[] {
  return TECHNICAL_SHEET_AUDIT_GAPS.filter(gap => row[gap.key]);
}

export function getTechnicalSheetAuditGapForIssueCode(issueCode: string): TechnicalSheetAuditGap | null {
  const key = issueCode.startsWith('technical_sheet_')
    ? issueCode.slice('technical_sheet_'.length)
    : issueCode;

  return TECHNICAL_SHEET_AUDIT_GAP_BY_KEY.get(key as TechnicalSheetAuditGapKey) ?? null;
}
