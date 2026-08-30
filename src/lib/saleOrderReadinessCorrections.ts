import type { SaleOrderCommandIssue } from '@/lib/saleOrderCommand';
import { getTechnicalSheetAuditGapForIssueCode } from '@/lib/technicalSheetAudit';

export interface ReadinessSaleOrderItem {
  id: string;
  reference_id: string | null;
  color: string | null;
  quantity: number | null;
  unit_price: number | null;
}

export interface ReadinessTechnicalSheet {
  id: string;
  code: string | null;
  name: string | null;
}

export interface ReadinessMaterialProduct {
  id: string;
  name: string | null;
  group_id: string | null;
  unit: string | null;
}

export interface ReadinessProductGroup {
  id: string;
  name: string | null;
  is_color_agnostic: boolean | null;
  auto_component_sheet?: boolean | null;
}

export interface ReadinessIssueLine {
  key: string;
  issue: SaleOrderCommandIssue;
  item: ReadinessSaleOrderItem | null;
  sheet: ReadinessTechnicalSheet | null;
  title: string;
  component: string | null;
}

export interface ReadinessItemGroup {
  key: string;
  item: ReadinessSaleOrderItem | null;
  sheet: ReadinessTechnicalSheet | null;
  issues: ReadinessIssueLine[];
}

export interface ReadinessReferenceGroup {
  key: string;
  referenceId: string;
  sheet: ReadinessTechnicalSheet | null;
  items: ReadinessSaleOrderItem[];
  issues: ReadinessIssueLine[];
}

export interface ReadinessColorCorrection {
  key: string;
  group: ReadinessProductGroup;
  templateProduct: ReadinessMaterialProduct;
  color: string;
  component: string | null;
  affectedItemIds: string[];
}

export interface SaleOrderReadinessCorrectionModel {
  referenceGroups: ReadinessReferenceGroup[];
  itemGroups: ReadinessItemGroup[];
  generalIssues: ReadinessIssueLine[];
  colorCorrections: ReadinessColorCorrection[];
  agnosticColorIssues: ReadinessIssueLine[];
  unsupportedIssues: ReadinessIssueLine[];
  canOverrideAll: boolean;
}

const asText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeColor = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase();

/** Fibra/placa da palmilha: a cor entra no forro, não neste grupo.
 *  Forração Palmilha continua pedindo cadastro de cor. */
export function isInsoleFiberColorAgnostic(
  component: string | null | undefined,
  group: Pick<ReadinessProductGroup, 'is_color_agnostic' | 'name'> | null,
): boolean {
  if (group?.is_color_agnostic === true) return true;
  const label = `${component || ''} ${group?.name || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/(forr|revest|lining|napa)/.test(label)) return false;
  return /(^|\s)palmilha(\s|$)/.test(label) || /fibra/.test(label) || /placa/.test(label);
}

export const readinessIssueTitle = (issue: SaleOrderCommandIssue): string => {
  if (issue.code === 'item_price_missing') return 'Preço do item ausente';
  if (issue.code === 'material_color_not_registered') return 'Cor de material não cadastrada';
  const auditGap = getTechnicalSheetAuditGapForIssueCode(issue.code);
  if (auditGap) return auditGap.label;
  return 'Pendência obrigatória do pedido';
};

const isTechnicalSheetIssue = (issue: SaleOrderCommandIssue): boolean => (
  issue.scope === 'technical_sheet' || issue.code.startsWith('technical_sheet_')
);

export function buildSaleOrderReadinessCorrectionModel(input: {
  issues: SaleOrderCommandIssue[];
  items: ReadinessSaleOrderItem[];
  sheets: ReadinessTechnicalSheet[];
  products: ReadinessMaterialProduct[];
  groups: ReadinessProductGroup[];
}): SaleOrderReadinessCorrectionModel {
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const sheetById = new Map(input.sheets.map((sheet) => [sheet.id, sheet]));
  const productById = new Map(input.products.map((product) => [product.id, product]));
  const groupById = new Map(input.groups.map((group) => [group.id, group]));

  const lines = input.issues.map((issue, index): ReadinessIssueLine => {
    const item = issue.item_id ? itemById.get(issue.item_id) || null : null;
    const referenceId = issue.reference_id || item?.reference_id || null;
    const sheet = referenceId ? sheetById.get(referenceId) || null : null;
    return {
      key: `${issue.code}:${issue.item_id || issue.reference_id || index}:${index}`,
      issue,
      item,
      sheet,
      title: readinessIssueTitle(issue),
      component: asText(issue.details?.component),
    };
  });

  const itemsByReference = new Map<string, ReadinessSaleOrderItem[]>();
  for (const item of input.items) {
    if (!item.reference_id) continue;
    const referenceItems = itemsByReference.get(item.reference_id);
    if (referenceItems) referenceItems.push(item);
    else itemsByReference.set(item.reference_id, [item]);
  }

  const referenceGrouped = new Map<string, ReadinessReferenceGroup>();
  const referenceIssueKeys = new Set<string>();
  const grouped = new Map<string, ReadinessItemGroup>();
  const generalIssues: ReadinessIssueLine[] = [];
  const correctionLines: ReadinessIssueLine[] = [];
  for (const line of lines) {
    if (isTechnicalSheetIssue(line.issue)) {
      const referenceId = line.issue.reference_id || line.item?.reference_id || null;
      if (!referenceId) {
        generalIssues.push(line);
        correctionLines.push(line);
        continue;
      }

      const dedupeKey = `${referenceId}:${line.issue.code}`;
      if (referenceIssueKeys.has(dedupeKey)) continue;
      referenceIssueKeys.add(dedupeKey);
      correctionLines.push(line);

      const current = referenceGrouped.get(referenceId);
      if (current) {
        current.issues.push(line);
      } else {
        referenceGrouped.set(referenceId, {
          key: referenceId,
          referenceId,
          sheet: line.sheet,
          items: itemsByReference.get(referenceId) || [],
          issues: [line],
        });
      }
      continue;
    }

    correctionLines.push(line);
    if (!line.issue.item_id && !line.item) {
      generalIssues.push(line);
      continue;
    }
    const key = line.item?.id || line.issue.item_id || `general:${line.key}`;
    const current = grouped.get(key);
    if (current) {
      current.issues.push(line);
    } else {
      grouped.set(key, {
        key,
        item: line.item,
        sheet: line.sheet,
        issues: [line],
      });
    }
  }

  const colorByGroupAndColor = new Map<string, ReadinessColorCorrection>();
  const agnosticColorIssues: ReadinessIssueLine[] = [];
  const unsupportedIssues: ReadinessIssueLine[] = [];

  for (const line of correctionLines) {
    const { issue, item } = line;
    if (issue.code === 'item_price_missing') {
      // Desde a migration 143, este blocker significa exclusivamente que o
      // preço do próprio item está zerado/inválido. Alterar o preço-base global
      // da ficha não corrige o item e poderia afetar outros clientes/PVs.
      unsupportedIssues.push(line);
      continue;
    }

    if (issue.code === 'material_color_not_registered') {
      const productId = asText(issue.details?.product_id);
      const product = productId ? productById.get(productId) || null : null;
      const group = product?.group_id ? groupById.get(product.group_id) || null : null;
      const color = asText(issue.details?.color) || item?.color?.trim() || '';
      if (!product || !group || !color) {
        unsupportedIssues.push(line);
        continue;
      }
      if (isInsoleFiberColorAgnostic(line.component, group)) {
        agnosticColorIssues.push(line);
        continue;
      }

      const key = `${group.id}:${normalizeColor(color)}`;
      const existing = colorByGroupAndColor.get(key);
      const itemId = item?.id || issue.item_id || null;
      if (existing) {
        if (itemId && !existing.affectedItemIds.includes(itemId)) {
          existing.affectedItemIds.push(itemId);
        }
      } else {
        colorByGroupAndColor.set(key, {
          key,
          group,
          templateProduct: product,
          color,
          component: line.component,
          affectedItemIds: itemId ? [itemId] : [],
        });
      }
      continue;
    }

    unsupportedIssues.push(line);
  }

  return {
    referenceGroups: [...referenceGrouped.values()],
    itemGroups: [...grouped.values()],
    generalIssues,
    colorCorrections: [...colorByGroupAndColor.values()],
    agnosticColorIssues,
    unsupportedIssues,
    canOverrideAll: input.issues.length > 0
      && input.issues.every((issue) => issue.overrideable === true),
  };
}
