export interface UpperCutSheetLike {
  upper_material?: unknown;
  upper_material_group_id?: unknown;
  upper_material_product_id?: unknown;
  upper_consumption?: unknown;
  upper_consumption_per_size?: unknown;
  components_accessories?: unknown;
}

const hasText = (value: unknown): boolean => String(value || '').trim().length > 0;

const hasPositiveConsumption = (value: unknown): boolean => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const hasPositivePerSize = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).some(hasPositiveConsumption);
};

const hasUpperAccessorySignal = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;
  return value.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const accessory = entry as Record<string, unknown>;
    // Entradas com `id` são componentes genéricos legados. As linhas de
    // cabedal (alternativa por cor ou material mandatório adicional) não têm.
    if (accessory.id) return false;
    return hasText(accessory.material)
      || hasText(accessory.product_id)
      || hasPositiveConsumption(accessory.consumption)
      || hasPositivePerSize(accessory.consumption_per_size);
  });
};

/**
 * Decide se a referência possui trabalho de Corte Cabedal por sinais do próprio
 * consumo de cabedal. `has_straps` não participa: cabedal e tiras são fluxos
 * independentes e podem coexistir na mesma ficha.
 *
 * Um sinal parcial também mantém o corte visível. A prontidão da ficha é quem
 * aponta o campo ausente; esconder a OP por cadastro incompleto seria pior.
 */
export function requiresUpperCut(sheet: UpperCutSheetLike | null | undefined): boolean {
  if (!sheet) return false;
  return hasText(sheet.upper_material)
    || hasText(sheet.upper_material_group_id)
    || hasText(sheet.upper_material_product_id)
    || hasPositiveConsumption(sheet.upper_consumption)
    || hasPositivePerSize(sheet.upper_consumption_per_size)
    || hasUpperAccessorySignal(sheet.components_accessories);
}
