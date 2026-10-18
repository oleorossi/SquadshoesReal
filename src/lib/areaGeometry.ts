/**
 * Geometria obrigatória para estoque em unidade de ÁREA.
 *
 * Porta canônica de cadastro = grupo (`update_material_group_dimensions` →
 * component_sheets). Este módulo é a fonte única de "o que conta como área" e
 * "L×A+unidade estão ok" — UI e (via contratos) a migration de gate espelham.
 */

export const AREA_STOCK_UNITS_STRICT = ['m²', 'm2', 'dm²', 'dm2', 'cm²', 'cm2', 'placa', 'placas'] as const;

const AREA_STOCK_SET = new Set(
  AREA_STOCK_UNITS_STRICT.map((u) => u.toLowerCase()),
);

export const DIMENSION_UNITS = ['mm', 'cm', 'm'] as const;

export type AreaGeometryInput = {
  width: number | null | undefined;
  length: number | null | undefined;
  dimensionsUnit: string | null | undefined;
};

export type AreaGeometryOk = {
  ok: true;
  width: number;
  length: number;
  dimensionsUnit: string;
  message?: undefined;
};

export type AreaGeometryErr = {
  ok: false;
  message: string;
};

export function normalizeStockUnit(unit: string | null | undefined): string {
  return (unit || '').trim().toLowerCase();
}

/** Estoque em metro² / dm² / cm² / placa — exige largura × comprimento. */
export function isAreaStockUnit(unit: string | null | undefined): boolean {
  return AREA_STOCK_SET.has(normalizeStockUnit(unit));
}

/** Unidade dimensional válida (mm/cm/m). */
export function isDimensionUnit(unit: string | null | undefined): boolean {
  const u = (unit || '').trim().toLowerCase();
  return u === 'mm' || u === 'cm' || u === 'm';
}

export function toMm(value: number, unit: string | null | undefined): number {
  if (!(value > 0)) return 0;
  const u = (unit || 'mm').trim().toLowerCase();
  if (u === 'mm') return value;
  if (u === 'cm') return value * 10;
  if (u === 'dm') return value * 100;
  if (u === 'm') return value * 1000;
  return 0;
}

/** Área da placa em dm² a partir de L×A. */
export function plateAreaDm2(input: AreaGeometryInput): number {
  const w = toMm(Number(input.width) || 0, input.dimensionsUnit);
  const l = toMm(Number(input.length) || 0, input.dimensionsUnit);
  if (w <= 0 || l <= 0) return 0;
  return (w * l) / 10_000;
}

/**
 * Valida geometria completa para material de área.
 * Default visual de unidade é `mm`, mas vazio/NULL é recusado.
 */
export function assertAreaGeometry(input: AreaGeometryInput): AreaGeometryOk | AreaGeometryErr {
  const width = Number(input.width) || 0;
  const length = Number(input.length) || 0;
  const dimensionsUnit = (input.dimensionsUnit || '').trim().toLowerCase() || '';

  if (!(width > 0)) {
    return { ok: false, message: 'Informe a largura da placa/bobina (maior que zero).' };
  }
  if (!(length > 0)) {
    return {
      ok: false,
      message: 'Informe o comprimento da placa (maior que zero). Unidade de área exige largura × comprimento.',
    };
  }
  if (!isDimensionUnit(dimensionsUnit)) {
    return {
      ok: false,
      message: 'Informe a unidade das dimensões (mm, cm ou m).',
    };
  }
  return { ok: true, width, length, dimensionsUnit };
}

/** Fator dm² → unidade de estoque (espelha get_material_conversion_info). */
export function areaStockDm2PerUnit(
  stockUnit: string | null | undefined,
  geometry: AreaGeometryInput | null | undefined,
): { dm2PerUnit: number; targetUnit: string; warning: string | null } {
  const unit = normalizeStockUnit(stockUnit);
  const targetUnit = unit || 'dm²';

  if (unit === 'placa' || unit === 'placas') {
    const area = geometry ? plateAreaDm2(geometry) : 0;
    if (!(area > 0)) {
      return {
        dm2PerUnit: 1,
        targetUnit,
        warning:
          'Estoque em placa sem largura×comprimento na ficha de componente. Configure no grupo de estoque.',
      };
    }
    return { dm2PerUnit: area, targetUnit, warning: null };
  }

  if (unit === 'm²' || unit === 'm2') {
    return { dm2PerUnit: 100, targetUnit: 'm²', warning: null };
  }
  if (unit === 'cm²' || unit === 'cm2') {
    return { dm2PerUnit: 0.01, targetUnit: 'cm²', warning: null };
  }
  // dm² / default área
  return { dm2PerUnit: 1, targetUnit: unit === 'dm2' ? 'dm²' : targetUnit, warning: null };
}
