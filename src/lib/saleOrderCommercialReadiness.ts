export interface MaterialVariantReadinessIssue {
  type: 'error' | 'warning';
  message: string;
}

/**
 * Itens novos precisam de identidade técnica completa. Itens históricos sem
 * variante continuam editáveis, pois uma escolha retroativa mudaria consumo,
 * custo e débito de estoque de algo que já pode ter sido produzido.
 */
export function getMaterialVariantReadinessIssue(input: {
  itemNumber: number;
  itemId?: string | null;
  activeVariantCount: number;
  materialVariantId?: string | null;
  /**
   * O material da PRÓPRIA ficha está oferecido como opção no seletor? Nesse
   * caso `material_variant_id` nulo NÃO é ausência de escolha — é a escolha
   * "material da ficha", que os resolvers já tratam (p_variant_id NULL).
   *
   * Sem isto, a correção de 21/08/2026 (variante acrescenta opção, não
   * substitui) deixava o usuário escolher "NAPA SOFT · da ficha" na SR02 e
   * ainda assim barrava o salvamento com "selecione o grupo de material".
   */
  sheetMaterialSelectable?: boolean;
}): MaterialVariantReadinessIssue | null {
  if (input.activeVariantCount <= 0 || input.materialVariantId) return null;
  if (input.sheetMaterialSelectable) return null;
  if (!input.itemId) {
    return {
      type: 'error',
      message: `Item ${input.itemNumber}: selecione o grupo de material`,
    };
  }
  return {
    type: 'warning',
    message: `Item ${input.itemNumber}: sem grupo de material`,
  };
}
