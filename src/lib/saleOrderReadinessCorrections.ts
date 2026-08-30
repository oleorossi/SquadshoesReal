import type { SaleOrderCommandIssue } from '@/lib/saleOrderCommand';

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

export interface ReadinessColorCorrection {
  key: string;
  group: ReadinessProductGroup;
  templateProduct: ReadinessMaterialProduct;
  color: string;
  component: string | null;
  affectedItemIds: string[];
}

export interface SaleOrderReadinessCorrectionModel {
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

export const readinessIssueTitle = (issue: SaleOrderCommandIssue): string => {
  if (issue.code === 'item_price_missing') return 'Preço do item ausente';
  if (issue.code === 'material_color_not_registered') return 'Cor de material não cadastrada';
  return 'Pendência obrigatória do pedido';
};

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

  const grouped = new Map<string, ReadinessItemGroup>();
  const generalIssues: ReadinessIssueLine[] = [];
  for (const line of lines) {
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

  for (const line of lines) {
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
      if (group.is_color_agnostic === true) {
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
    itemGroups: [...grouped.values()],
    generalIssues,
    colorCorrections: [...colorByGroupAndColor.values()],
    agnosticColorIssues,
    unsupportedIssues,
    canOverrideAll: input.issues.length > 0
      && input.issues.every((issue) => issue.overrideable === true),
  };
}
