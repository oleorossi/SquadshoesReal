/**
 * Palmilha furada (2026-10-10) — especificação da ficha técnica
 * (`technical_sheets.insole_perforated`) que as fichas de operador de Silk e
 * Palmilha destacam. Só camada de impressão.
 *
 * O card de operador pode fundir VÁRIAS referências na mesma cor (mesmo solado
 * + cor). A marca viaja em cada referência do card (`refs[].insolePerforated`),
 * então o destaque sabe dizer se a palmilha furada vale pro card inteiro ou só
 * para algumas das referências que o operador tem na mão.
 */
export interface InsolePerforationRef {
  code?: string;
  name?: string;
  insolePerforated?: boolean;
}

export interface InsolePerforationSummary {
  /** TRUE quando ao menos uma referência do card tem palmilha furada. */
  show: boolean;
  /** Referências furadas quando o card MISTURA furadas e não furadas;
   *  null quando todas as referências do card são furadas. */
  onlyRefs: string[] | null;
}

export function summarizeInsolePerforation(
  refs: InsolePerforationRef[] | undefined | null,
): InsolePerforationSummary {
  const list = refs || [];
  const perforated = list.filter(r => r.insolePerforated === true);
  if (perforated.length === 0) return { show: false, onlyRefs: null };
  if (perforated.length === list.length) return { show: true, onlyRefs: null };
  return {
    show: true,
    onlyRefs: perforated.map(r => r.name || r.code || '—'),
  };
}
