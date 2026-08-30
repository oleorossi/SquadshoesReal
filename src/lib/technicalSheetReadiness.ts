export type TechnicalSheetReadinessStageKey =
  | 'identity'
  | 'engineering'
  | 'stock'
  | 'production'
  | 'release';

export type TechnicalSheetReadinessTab =
  | 'id'
  | 'engineering'
  | 'production'
  | 'costs'
  | 'range-aviamento';

export interface TechnicalSheetReadinessStage {
  key: TechnicalSheetReadinessStageKey;
  label: string;
  tab: TechnicalSheetReadinessTab;
  ready: boolean;
  issues: string[];
}

export interface TechnicalSheetAuditSignals {
  unit_configuration_issue?: boolean;
  area_material_width_missing?: boolean;
  sole_driven_but_specs_missing?: boolean;
  upper_per_size_partial_no_fallback?: boolean;
}

export interface TechnicalSheetReadinessInput {
  [key: string]: unknown;
  id?: string;
  name?: unknown;
  shoe_category?: unknown;
  status_ficha?: unknown;
  ncm?: unknown;
  primary_sole_id?: unknown;
  sole_consumption?: unknown;
  has_straps?: unknown;
  strap_colors?: unknown;
  upper_material?: unknown;
  upper_material_group_id?: unknown;
  upper_material_product_id?: unknown;
  upper_consumption?: unknown;
  upper_consumption_per_size?: unknown;
  components_accessories?: unknown;
  requires_cutting_cabedal?: unknown;
  insole_ready_made?: unknown;
  insole_material?: unknown;
  sole_drives_consumption?: unknown;
  insole_consumption?: unknown;
  insole_consumption_per_size?: unknown;
  production_sectors?: unknown;
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

const RELEASE_STATUSES = new Set(['validada', 'publicada']);

export function evaluateTechnicalSheetReadiness(
  sheet: TechnicalSheetReadinessInput,
  audit?: TechnicalSheetAuditSignals | null,
): TechnicalSheetReadinessStage[] {
  const identityIssues: string[] = [];
  if (!String(sheet.name || '').trim()) identityIssues.push('referência');
  if (!String(sheet.shoe_category || '').trim()) identityIssues.push('categoria');
  // NCM é exigido na TRANSIÇÃO para validada/publicada — não depois que já
  // publicou. Senão a rail só reclama quando o dano comercial já está feito.
  if (RELEASE_STATUSES.has(String(sheet.status_ficha || '')) && !hasValidNcm(sheet.ncm)) {
    identityIssues.push('NCM válido');
  }

  const engineeringIssues: string[] = [];
  if (!sheet.primary_sole_id) engineeringIssues.push('solado principal');
  if (!hasPositiveScalar(sheet.sole_consumption)) engineeringIssues.push('consumo do solado');

  let strapIssues = false;
  const straps = Array.isArray(sheet.strap_colors) ? sheet.strap_colors : [];
  const requiresStraps = sheet.has_straps === true || straps.length > 0;
  if (requiresStraps) {
    if (straps.length === 0 || straps.some((line: unknown) => !hasConfiguredStrap(line))) {
      engineeringIssues.push('tiras com identidade e consumo');
      strapIssues = true;
    }
  }

  // Cabedal e tiras são requisitos independentes. Modelo somente de tiras não
  // precisa inventar cabedal; porém, assim que qualquer metade do cabedal foi
  // configurada, validamos identidade E consumo mesmo com has_straps=true.
  const hasUpperIdentity = String(sheet.upper_material || '').trim().length > 0
    || Boolean(sheet.upper_material_group_id)
    || Boolean(sheet.upper_material_product_id);
  const hasUpperConsumption = hasConsumption(sheet.upper_consumption, sheet.upper_consumption_per_size);
  const upperAccessories = Array.isArray(sheet.components_accessories)
    ? sheet.components_accessories.filter((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const accessory = entry as Record<string, unknown>;
        return !accessory.id && (
          Boolean(String(accessory.material || '').trim())
          || Boolean(accessory.product_id)
          || hasConsumption(accessory.consumption, accessory.consumption_per_size)
        );
      })
    : [];
  const requiresUpper = !requiresStraps
    || sheet.requires_cutting_cabedal === true
    || hasUpperIdentity
    || hasUpperConsumption
    || upperAccessories.length > 0;
  if (requiresUpper) {
    if (!hasUpperIdentity) engineeringIssues.push('material do cabedal');
    if (!hasUpperConsumption) {
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
  if (audit?.sole_driven_but_specs_missing) engineeringIssues.push('consumos por numeração do solado');
  if (audit?.upper_per_size_partial_no_fallback) engineeringIssues.push('grade completa do cabedal');

  const stockIssues: string[] = [];
  // Auditoria ausente ≠ estoque pronto. Sem o sinal, a etapa fica pendente
  // em vez de pintar verde por omissão.
  if (audit == null) {
    stockIssues.push('auditoria de estoque');
  } else {
    if (audit.unit_configuration_issue) stockIssues.push('unidade ou conversão de estoque');
    if (audit.area_material_width_missing) stockIssues.push('largura de material de área');
  }

  const productionIssues: string[] = [];
  if (!Array.isArray(sheet.production_sectors) || sheet.production_sectors.length === 0) {
    productionIssues.push('rota de setores');
  }

  const releaseIssues: string[] = [];
  if (!RELEASE_STATUSES.has(String(sheet.status_ficha || ''))) {
    releaseIssues.push('validação da engenharia');
  }

  return [
    { key: 'identity', label: 'Identificação', tab: 'id', ready: identityIssues.length === 0, issues: identityIssues },
    {
      key: 'engineering',
      label: 'Engenharia',
      tab: strapIssues ? 'range-aviamento' : 'engineering',
      ready: engineeringIssues.length === 0,
      issues: engineeringIssues,
    },
    { key: 'stock', label: 'Estoque', tab: 'engineering', ready: stockIssues.length === 0, issues: stockIssues },
    { key: 'production', label: 'Produção', tab: 'production', ready: productionIssues.length === 0, issues: productionIssues },
    { key: 'release', label: 'Liberação', tab: 'id', ready: releaseIssues.length === 0, issues: releaseIssues },
  ];
}

export function firstBlockingReadinessStage(
  sheet: TechnicalSheetReadinessInput,
  audit?: TechnicalSheetAuditSignals | null,
): TechnicalSheetReadinessStage | undefined {
  return evaluateTechnicalSheetReadiness(sheet, audit).find((stage) => !stage.ready);
}

export function buildBulkSolePatch(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
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
