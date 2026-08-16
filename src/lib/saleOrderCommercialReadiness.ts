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
}): MaterialVariantReadinessIssue | null {
  if (input.activeVariantCount <= 0 || input.materialVariantId) return null;
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
