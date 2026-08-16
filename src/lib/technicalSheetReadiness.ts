export type TechnicalSheetReadinessStageKey =
  | 'identity'
  | 'engineering'
  | 'stock'
  | 'production'
  | 'release';

export interface TechnicalSheetReadinessStage {
  key: TechnicalSheetReadinessStageKey;
  label: string;
  tab: 'id' | 'engineering' | 'production' | 'costs';
  ready: boolean;
  issues: string[];
}

export interface TechnicalSheetAuditSignals {
  unit_configuration_issue?: boolean;
  area_material_width_missing?: boolean;
  sole_driven_but_specs_missing?: boolean;
  upper_per_size_partial_no_fallback?: boolean;
}

const hasPositiveScalar = (value: unknown): boolean => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const hasPositiveMap = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).some(hasPositiveScalar);
};

const hasConsumption = (scalar: unknown, perSize: unknown): boolean =>
  hasPositiveScalar(scalar) || hasPositiveMap(perSize);

const hasValidNcm = (value: unknown): boolean => /^\d{8}$/.test(String(value || '').trim());

const hasConfiguredStrap = (line: unknown): boolean => {
  if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
  const strap = line as Record<string, unknown>;
  const hasIdentity = Boolean(strap.measure_id || strap.group_id);
  const hasMeasure = hasPositiveScalar(strap.consumption)
    || hasPositiveMap(strap.consumption_per_size);
  return hasIdentity && hasMeasure;
};

export function evaluateTechnicalSheetReadiness(
  sheet: Record<string, any>,
  audit: TechnicalSheetAuditSignals = {},
): TechnicalSheetReadinessStage[] {
  const identityIssues: string[] = [];
  if (!String(sheet.name || '').trim()) identityIssues.push('referência');
  if (!String(sheet.shoe_category || '').trim()) identityIssues.push('categoria');
  if (sheet.status_ficha === 'publicada' && !hasValidNcm(sheet.ncm)) identityIssues.push('NCM válido');

  const engineeringIssues: string[] = [];
  if (!sheet.primary_sole_id) engineeringIssues.push('solado principal');
  if (!hasPositiveScalar(sheet.sole_consumption)) engineeringIssues.push('consumo do solado');

  if (sheet.has_straps) {
    const straps = Array.isArray(sheet.strap_colors) ? sheet.strap_colors : [];
    if (straps.length === 0 || straps.some((line: unknown) => !hasConfiguredStrap(line))) {
      engineeringIssues.push('tiras com identidade e consumo');
    }
  } else {
    if (!String(sheet.upper_material || '').trim()) engineeringIssues.push('material do cabedal');
    if (!hasConsumption(sheet.upper_consumption, sheet.upper_consumption_per_size)) {
      engineeringIssues.push('consumo do cabedal');
    }
  }

  if (!sheet.insole_ready_made) {
    if (!String(sheet.insole_material || '').trim()) engineeringIssues.push('material da palmilha');
    if (!sheet.sole_drives_consumption
      && !hasConsumption(sheet.insole_consumption, sheet.insole_consumption_per_size)) {
      engineeringIssues.push('consumo da palmilha');
    }
  }
  if (audit.sole_driven_but_specs_missing) engineeringIssues.push('consumos por numeração do solado');
  if (audit.upper_per_size_partial_no_fallback) engineeringIssues.push('grade completa do cabedal');

  const stockIssues: string[] = [];
  if (audit.unit_configuration_issue) stockIssues.push('unidade ou conversão de estoque');
  if (audit.area_material_width_missing) stockIssues.push('largura de material de área');

  const productionIssues: string[] = [];
  if (!Array.isArray(sheet.production_sectors) || sheet.production_sectors.length === 0) {
    productionIssues.push('rota de setores');
  }

  const releaseIssues: string[] = [];
  if (!['validada', 'publicada'].includes(String(sheet.status_ficha || ''))) {
    releaseIssues.push('validação da engenharia');
  }

  return [
    { key: 'identity', label: 'Identificação', tab: 'id', ready: identityIssues.length === 0, issues: identityIssues },
    { key: 'engineering', label: 'Engenharia', tab: 'engineering', ready: engineeringIssues.length === 0, issues: engineeringIssues },
    { key: 'stock', label: 'Estoque', tab: 'engineering', ready: stockIssues.length === 0, issues: stockIssues },
    { key: 'production', label: 'Produção', tab: 'production', ready: productionIssues.length === 0, issues: productionIssues },
    { key: 'release', label: 'Liberação', tab: 'costs', ready: releaseIssues.length === 0, issues: releaseIssues },
  ];
}

export function buildBulkSolePatch(
  target: Record<string, any>,
  source: Record<string, any>,
  soleName: string,
  overwrite: boolean,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const mayReplaceSole = overwrite || !target.sole_material;

  if (mayReplaceSole && target.sole_material !== soleName) patch.sole_material = soleName;
  if (source.primary_sole_id && mayReplaceSole && target.primary_sole_id !== source.primary_sole_id) {
    patch.primary_sole_id = source.primary_sole_id;
  }
  if (source.sole_group_id && mayReplaceSole && target.sole_group_id !== source.sole_group_id) {
    patch.sole_group_id = source.sole_group_id;
  }
  if (hasPositiveScalar(source.sole_consumption) && (overwrite || !hasPositiveScalar(target.sole_consumption))) {
    if (Number(target.sole_consumption) !== Number(source.sole_consumption)) {
      patch.sole_consumption = Number(source.sole_consumption);
    }
  }
  if (source.sole_process && (overwrite || !target.sole_process) && target.sole_process !== source.sole_process) {
    patch.sole_process = source.sole_process;
  }

  return patch;
}
