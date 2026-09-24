import {
  resolveMaterialVariantColorGroup,
  resolveSheetCommercialColorGroup,
} from '@/lib/materialVariantColorGroup';

/**
 * Resolve o grupo de material efetivo (cabedal / forração / palmilha) de um
 * item de PV pra impressão — espelha a precedência dos resolvers SQL /
 * orderConsumption (pin de produto > grupo do slot da variante > material
 * principal quando variant_drives_* > texto da ficha).
 *
 * Usado pelo Relatório Gerencial (checklist) pra NÃO mostrar só o
 * `lining_material` estático da ficha quando o item pinou uma variante
 * (NAPA SOFT vs SUDANI vs MADRID no mesmo modelo).
 */

export interface MaterialResolveSheet {
  upper_material?: string | null;
  upper_material_group_id?: string | null;
  lining_material?: string | null;
  insole_material?: string | null;
  variant_drives_upper?: boolean | null;
  variant_drives_lining?: boolean | null;
}

export interface MaterialResolveVariant {
  id: string;
  material_name?: string | null;
  upper_material_product_id?: string | null;
  upper_material_group_id?: string | null;
  lining_material_product_id?: string | null;
  lining_material_group_id?: string | null;
  insole_material_product_id?: string | null;
  insole_material_group_id?: string | null;
  main_material_group_id?: string | null;
}

export interface ResolvedReportMaterials {
  upper: string | null;
  lining: string | null;
  insole: string | null;
  /**
   * Material comercial do item (campo "Material" do PV): variante /
   * cabedal → forração. É o que a coluna Material do Relatório mostra.
   */
  item: string | null;
  /** true quando a forração veio da variante (não do texto da ficha). */
  liningFromVariant: boolean;
  upperFromVariant: boolean;
}

function groupName(
  groupsById: Map<string, string>,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  const n = (groupsById.get(id) || '').trim();
  return n || null;
}

function resolveSlot(
  groupsById: Map<string, string>,
  sheetName: string | null | undefined,
  variant: MaterialResolveVariant | null | undefined,
  pinProductId: string | null | undefined,
  variantGroupId: string | null | undefined,
  drivenByMain: boolean,
  /** Nome do grupo do produto pinado (quando já resolvido pelo call-site). */
  pinGroupName?: string | null,
): { name: string | null; fromVariant: boolean } {
  // Pin de produto: o nome do grupo do SKU pinado vence (call-site pode
  // passar; sem isso cai no group_id do slot / main / ficha).
  if (pinProductId) {
    if (pinGroupName && pinGroupName.trim()) {
      return { name: pinGroupName.trim(), fromVariant: true };
    }
    // Sem nome do pin, ainda preferimos o grupo do slot da variante.
    const g = groupName(groupsById, variantGroupId);
    if (g) return { name: g, fromVariant: true };
  }
  const slot = groupName(groupsById, variantGroupId);
  if (slot) return { name: slot, fromVariant: true };
  if (drivenByMain && variant) {
    const main = groupName(groupsById, variant.main_material_group_id);
    if (main) return { name: main, fromVariant: true };
  }
  const sheet = (sheetName || '').trim();
  return { name: sheet || null, fromVariant: false };
}

function groupsArrayFromMap(groupsById: Map<string, string>) {
  return Array.from(groupsById.entries()).map(([id, name]) => ({ id, name }));
}

/** Material comercial do item — espelha SaleOrderItemForm.mainGroupForNewColor. */
export function resolveReportItemMaterial(args: {
  sheet: MaterialResolveSheet | null | undefined;
  variant: MaterialResolveVariant | null | undefined;
  groupsById: Map<string, string>;
}): string | null {
  const { sheet, variant, groupsById } = args;
  const groups = groupsArrayFromMap(groupsById);

  if (variant) {
    const fromName = (variant.material_name || '').trim();
    if (fromName) return fromName;
    const fromVariant = resolveMaterialVariantColorGroup({
      variant,
      sheet,
      products: [],
      groups,
    });
    if (fromVariant?.name?.trim()) return fromVariant.name.trim();
  }

  const fromSheet = resolveSheetCommercialColorGroup({ sheet, groups });
  if (fromSheet?.name?.trim()) return fromSheet.name.trim();

  // Fallback textual (sem id no mapa de grupos): cabedal → forração.
  const upper = (sheet?.upper_material || '').trim();
  if (upper) return upper;
  const lining = (sheet?.lining_material || '').trim();
  return lining || null;
}

export function resolveReportMaterials(args: {
  sheet: MaterialResolveSheet | null | undefined;
  variant: MaterialResolveVariant | null | undefined;
  groupsById: Map<string, string>;
  /** group name do produto pinado de upper/lining/insole (opcional). */
  pinGroupNames?: {
    upper?: string | null;
    lining?: string | null;
    insole?: string | null;
  };
}): ResolvedReportMaterials {
  const { sheet, variant, groupsById, pinGroupNames } = args;
  const upper = resolveSlot(
    groupsById,
    sheet?.upper_material,
    variant,
    variant?.upper_material_product_id,
    variant?.upper_material_group_id,
    !!sheet?.variant_drives_upper,
    pinGroupNames?.upper,
  );
  const lining = resolveSlot(
    groupsById,
    sheet?.lining_material,
    variant,
    variant?.lining_material_product_id,
    variant?.lining_material_group_id,
    !!sheet?.variant_drives_lining,
    pinGroupNames?.lining,
  );
  const insole = resolveSlot(
    groupsById,
    sheet?.insole_material,
    variant,
    variant?.insole_material_product_id,
    variant?.insole_material_group_id,
    false,
    pinGroupNames?.insole,
  );
  return {
    upper: upper.name,
    lining: lining.name,
    insole: insole.name,
    item: resolveReportItemMaterial({ sheet, variant, groupsById }),
    liningFromVariant: lining.fromVariant,
    upperFromVariant: upper.fromVariant,
  };
}
