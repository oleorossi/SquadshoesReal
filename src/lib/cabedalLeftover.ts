/**
 * Sobra de napa no cabedal — Material 2+ de outra espessura.
 *
 * NÃO vive no BOM (cabedal é excluído do BOM pra não duplicar débito).
 * Mora em `technical_sheets.components_accessories` com `mandatory: true`
 * e, quando o grupo é o mesmo do Material 1, `product_id` pinado.
 *
 * Famílias distintas só pela espessura (NAPA CONHAQUE 1.0 × 1.2) são
 * sobra válida. SKU idêntico ao principal NÃO é sobra — é duplicata.
 *
 * Não relaxa `fn_guard_unique_active_group_color`. Sem pin no mesmo
 * grupo, `resolve_material_product` escolheria a napa principal pela cor.
 */

export const CABEDAL_LEFTOVER_SAME_SKU =
  'Este item já está no cabedal. A sobra precisa ser outro SKU (outra espessura).';

export const CABEDAL_LEFTOVER_NEEDS_PIN =
  'Sobra do mesmo grupo precisa do item específico. Sem pin o débito escolheria a napa principal pela cor.';

export const CABEDAL_LEFTOVER_DUPLICATE_SKU =
  'Esta sobra já está no cabedal com o mesmo item. Use outro SKU ou outra espessura.';

export type CabedalLeftoverExtra = {
  material?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  label?: string | null;
  mandatory?: boolean | null;
  leftover?: boolean | null;
  consumption?: number | string | null;
  consumption_per_size?: Record<string, number> | null;
};

export type CabedalLeftoverPrincipal = {
  upper_material?: string | null;
  upper_material_product_id?: string | null;
};

export type CabedalLeftoverIssue = {
  message: string;
  extraIndex: number;
};

export function normalizeCabedalMaterialName(name: string | null | undefined): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Família sem o sufixo de espessura (`1.0`, `1,2`, `1.20mm`). */
export function cabedalFamilyKey(name: string | null | undefined): string {
  return normalizeCabedalMaterialName(name)
    .replace(/\b\d+[.,]\d+\s*(mm)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSameCabedalGroup(
  extraName: string | null | undefined,
  principalName: string | null | undefined,
): boolean {
  const extra = normalizeCabedalMaterialName(extraName);
  const principal = normalizeCabedalMaterialName(principalName);
  return extra.length > 0 && extra === principal;
}

export function isSameNapaFamily(
  extraName: string | null | undefined,
  principalName: string | null | undefined,
): boolean {
  const extra = cabedalFamilyKey(extraName);
  const principal = cabedalFamilyKey(principalName);
  return extra.length > 0 && extra === principal;
}

export function isLeftoverCabedalExtra(
  extra: CabedalLeftoverExtra | null | undefined,
  principal: CabedalLeftoverPrincipal | null | undefined,
): boolean {
  if (!extra || extra.mandatory !== true) return false;
  if (extra.leftover === true) return true;
  const extraName = String(extra.material || '').trim();
  const principalName = String(principal?.upper_material || '').trim();
  if (!extraName || !principalName) return false;
  return isSameCabedalGroup(extraName, principalName)
    || isSameNapaFamily(extraName, principalName);
}

export function leftoverRequiresPin(
  extra: CabedalLeftoverExtra | null | undefined,
  principal: CabedalLeftoverPrincipal | null | undefined,
): boolean {
  return isSameCabedalGroup(extra?.material, principal?.upper_material);
}

export function validateCabedalLeftovers(
  extras: CabedalLeftoverExtra[] | null | undefined,
  principal: CabedalLeftoverPrincipal | null | undefined,
): CabedalLeftoverIssue[] {
  const issues: CabedalLeftoverIssue[] = [];
  const list = Array.isArray(extras) ? extras : [];
  const principalPid = principal?.upper_material_product_id || null;
  const extraPids = new Map<string, number>();

  list.forEach((extra, idx) => {
    if (extra?.mandatory !== true) return;
    if (!String(extra.material || '').trim()) return;

    const leftover = isLeftoverCabedalExtra(extra, principal);
    const pid = extra.product_id || null;

    if (leftover && leftoverRequiresPin(extra, principal) && !pid) {
      issues.push({ message: CABEDAL_LEFTOVER_NEEDS_PIN, extraIndex: idx });
    }
    if (pid && principalPid && pid === principalPid) {
      issues.push({ message: CABEDAL_LEFTOVER_SAME_SKU, extraIndex: idx });
    }
    if (pid) {
      if (extraPids.has(pid)) {
        issues.push({ message: CABEDAL_LEFTOVER_DUPLICATE_SKU, extraIndex: idx });
      } else {
        extraPids.set(pid, idx);
      }
    }
  });

  return issues;
}

export function leftoverCabedalDisplayName(extra: CabedalLeftoverExtra | null | undefined): string {
  const name = String(extra?.product_name || extra?.label || extra?.material || '').trim();
  if (!name) return 'Sobra';
  if (/^sobra\s*[·•\-–]\s*/i.test(name)) return name;
  return `Sobra · ${name}`;
}

export type CabedalLeftoverSheet = CabedalLeftoverPrincipal & {
  components_accessories?: CabedalLeftoverExtra[] | null;
};

export function leftoverLabelsFromSheet(
  sheet: CabedalLeftoverSheet | null | undefined,
): string[] {
  return listLeftoverCabedalLabels(sheet?.components_accessories, sheet);
}

export function listLeftoverCabedalLabels(
  extras: CabedalLeftoverExtra[] | null | undefined,
  principal: CabedalLeftoverPrincipal | null | undefined,
): string[] {
  const list = Array.isArray(extras) ? extras : [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const extra of list) {
    if (!isLeftoverCabedalExtra(extra, principal)) continue;
    const label = String(extra.product_name || extra.material || extra.label || '').trim()
      .replace(/^sobra\s*[·•\-–]\s*/i, '')
      .trim();
    if (!label) continue;
    const key = normalizeCabedalMaterialName(label);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(label);
  }
  return names;
}
