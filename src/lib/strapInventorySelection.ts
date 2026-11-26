/**
 * Seleção de tira na ficha a partir do grupo de estoque (spec
 * tira-material-de-estoque.md R4): a linha referencia o grupo-folha; o Hub
 * só entra como ponte opcional (measure_id) enquanto o writer do PV ainda
 * lê medida canônica.
 */
import { ROLL_WIDTH_FLOOR_MM } from '@/lib/materialConsumption';
import { normalizeForSearch } from '@/lib/searchUtils';
import {
  applyCanonicalTechnicalStrapMeasure,
  applyTechnicalStrapIdentity,
  hasCanonicalTechnicalStrapIdentity,
  isUuid,
  type TechnicalStrapLineLike,
  type TechnicalStrapMeasureLike,
  type TechnicalStrapTypeLike,
} from '@/lib/technicalStrapLines';
import { strapIdentityBasis } from '@/lib/strapIdentity';

/** Subconjunto do catálogo necessário para casar medida Hub ↔ estoque. */
export interface StrapInventoryCatalogLike {
  types: readonly TechnicalStrapTypeLike[];
  measures: readonly TechnicalStrapMeasureLike[];
}

export interface StrapInventoryGroupLike {
  id: string;
  name: string;
  parent_group_id?: string | null;
  is_family?: boolean | null;
  is_artisanal_strap?: boolean | null;
  strap_origin?: 'comprar_pronto' | 'fabrica' | 'prestador' | null;
  strap_uses_napa?: boolean | null;
  consumption_unit?: string | null;
  dimensions_width?: number | null;
}

/** Folha de estoque candidata a tira (não família/container). */
export function isStrapInventorySelectableGroup(
  group: StrapInventoryGroupLike,
  parentIds: ReadonlySet<string>,
): boolean {
  if (!group?.id || parentIds.has(group.id) || group.is_family === true) return false;
  if (group.is_artisanal_strap === true) return true;
  if (group.strap_origin) return true;
  const width = Number(group.dimensions_width);
  const unit = String(group.consumption_unit || '').trim().toLowerCase();
  const linearUnit = !unit || unit === 'm' || unit === 'metro' || unit === 'metros';
  // Mesma heurística de fita pronta (elástico/tira): largura da peça, não bobina.
  return linearUnit && width > 0 && width < ROLL_WIDTH_FLOOR_MM;
}


/** Largura da bitola: cadastro, ou o "NMM" no nome (ex.: TIRA STRASS 15MM). */
export function strapInventoryGroupWidthMm(group: StrapInventoryGroupLike): number {
  const width = Number(group.dimensions_width);
  if (width > 0) return width;
  const match = String(group.name || '').match(/(\d+(?:[.,]\d+)?)\s*mm\b/i);
  if (!match) return 0;
  return Number(match[1].replace(',', '.'));
}

export function resolveHubMeasureForStockGroup(
  group: StrapInventoryGroupLike,
  familyName: string | null | undefined,
  catalog: StrapInventoryCatalogLike | null | undefined,
): TechnicalStrapMeasureLike | null {
  if (!catalog) return null;
  const width = strapInventoryGroupWidthMm(group);
  const familyNorm = normalizeForSearch(familyName || '');
  const groupNorm = normalizeForSearch(group.name || '');
  const activeTypes = (catalog.types || []).filter((type) => type.active !== false);

  const scored = (catalog.measures || []).flatMap((measure) => {
    if (measure.active === false) return [];
    if (!(width > 0) || Number(measure.finished_width_mm) !== width) return [];
    const type = activeTypes.find((entry) => entry.id === measure.strap_type_id);
    if (!type) return [];
    const typeNorm = normalizeForSearch(type.name || '');
    if (!typeNorm) return [];
    const familyMatch = familyNorm && typeNorm === familyNorm;
    const nameMatch = groupNorm.includes(typeNorm);
    if (!familyMatch && !nameMatch) return [];
    return [{ measure, typeLen: typeNorm.length, familyMatch }];
  });

  if (scored.length === 0) return null;
  scored.sort((left, right) => (
    Number(right.familyMatch) - Number(left.familyMatch)
    || right.typeLen - left.typeLen
    || Number(right.measure.origem_padrao === 'sempre_sku_acabado')
      - Number(left.measure.origem_padrao === 'sempre_sku_acabado')
  ));
  return scored[0].measure;
}

function prefersBuyReady(
  group: StrapInventoryGroupLike,
  measure: TechnicalStrapMeasureLike | null,
): boolean {
  if (group.strap_origin === 'comprar_pronto' || group.strap_uses_napa === false) return true;
  if (group.strap_origin === 'fabrica' || group.strap_origin === 'prestador') return false;
  if (measure?.origem_padrao === 'sempre_sku_acabado') return true;
  // Sem Hub e sem origem no grupo: fita estreita = SKU acabado (piloto elástico).
  const width = strapInventoryGroupWidthMm(group);
  return width > 0 && width < ROLL_WIDTH_FLOOR_MM;
}

/**
 * Aplica o grupo-folha de estoque na linha da ficha.
 * Preenche measure_id quando o Hub tem a bitola correspondente (ponte PV).
 */
export function applyStockStrapGroupToLine<T extends TechnicalStrapLineLike>(
  line: T,
  group: StrapInventoryGroupLike,
  pathLabel: string,
  catalog: StrapInventoryCatalogLike | null | undefined,
  familyName?: string | null,
): T {
  const measure = resolveHubMeasureForStockGroup(group, familyName, catalog);
  const buyReady = prefersBuyReady(group, measure);
  const withGroup = {
    ...line,
    group_id: group.id,
    group_name: pathLabel || group.name,
  } as T;

  const measured = measure
    ? applyCanonicalTechnicalStrapMeasure(withGroup, measure)
    : ({
      ...withGroup,
      measure_id: null,
      strap_type_id: null,
    } as T);

  if (buyReady) {
    return {
      ...applyTechnicalStrapIdentity(measured, 'finished_product_group', group.id),
      internal_production_enabled: false,
      group_id: group.id,
      group_name: pathLabel || group.name,
    };
  }

  return {
    ...applyTechnicalStrapIdentity(measured, 'reference_base', null),
    internal_production_enabled: true,
    group_id: group.id,
    group_name: pathLabel || group.name,
  };
}

/** Identidade válida: Hub canônico OU grupo de estoque buy-ready (R4). */
export function hasTechnicalStrapLineIdentity(
  line: TechnicalStrapLineLike,
  measures: TechnicalStrapMeasureLike[],
  types: TechnicalStrapTypeLike[],
): boolean {
  if (hasCanonicalTechnicalStrapIdentity(line, measures, types)) return true;
  if (!isUuid(line.technical_strap_line_id)) return false;
  if (strapIdentityBasis(line) !== 'finished_product_group') return false;
  const stockGroupId = line.identity_group_id || (line as { group_id?: string | null }).group_id;
  return isUuid(stockGroupId);
}

/** Display value for GroupMaterialSelect when leaf name is bare ("25MM"). */
export function strapStockGroupDisplayValue(
  line: TechnicalStrapLineLike & { group_name?: string | null; group_id?: string | null },
): string {
  if (line.group_name?.trim()) return line.group_name.trim();
  return '';
}

export function strapStockGroupSelectedId(
  line: TechnicalStrapLineLike & { group_id?: string | null },
): string | null {
  if (isUuid(line.identity_group_id)) return line.identity_group_id;
  if (isUuid(line.group_id)) return line.group_id;
  return null;
}
