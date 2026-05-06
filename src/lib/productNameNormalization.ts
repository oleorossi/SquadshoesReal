/**
 * Canonical product-name normalization rules used across the system.
 *
 * Goal: agrupar variantes de cor sob o mesmo "modelo" preservando atributos
 * técnicos críticos (espessura, dimensão, código). Itens diferentes que
 * compartilham group_id (ex.: EVA 3MM vs Placa EVA 1.0, COLA PVC vs COLA AMARELA)
 * NÃO devem ser unificados.
 *
 * Regra global: agrupar por nome normalizado (sem sufixo de cor),
 * NUNCA por group_id.
 */

// Lista canônica de cores reconhecidas como sufixos. Mantida em um único lugar
// para que toda regra de agrupamento do sistema use o mesmo vocabulário.
export const KNOWN_COLOR_SUFFIXES = [
  'caramelo', 'preto', 'preta', 'marrom', 'bege', 'branco', 'branca',
  'natural', 'cinza', 'vermelho', 'vermelha', 'azul', 'verde',
  'amarelo', 'amarela', 'rosa', 'nude', 'cafe', 'café', 'chocolate',
  'tabaco', 'conhaque', 'off white', 'off-white',
] as const;

const COLOR_SUFFIX_REGEX = new RegExp(
  `[\\s\\-/–—]+(${KNOWN_COLOR_SUFFIXES.join('|')})\\s*$`,
  'i'
);

/**
 * Remove acentos, normaliza espaços e converte para minúsculas.
 * Não remove cor — útil para comparação exata.
 */
export function normalizeBaseString(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove sufixo de cor do nome do produto, preservando dimensões e
 * especificações técnicas (ex.: "EVA 3MM", "Placa 1.0", "Cola PVC").
 *
 * Exemplos:
 *   "Saltinho Bloco - Caramelo" -> "saltinho bloco"
 *   "EVA 3MM Preto"             -> "eva 3mm"
 *   "COLA PVC"                  -> "cola pvc"          (sem alteração)
 *   "COLA AMARELA"              -> "cola amarela"     (cor faz parte do nome técnico se houver outro modelo)
 *
 * Observação: somente cores no FINAL após separador são removidas. Isso evita
 * unificar erradamente "COLA AMARELA" com "COLA PVC" (não há separador antes
 * de "AMARELA" que indique sufixo de variante).
 */
export function normalizeProductName(name: string): string {
  const base = normalizeBaseString(name);
  return base.replace(COLOR_SUFFIX_REGEX, '').replace(/\s+/g, ' ').trim();
}

/**
 * Chave estável para agrupar variantes de cor de um mesmo modelo.
 * Use sempre que precisar consolidar produtos no UI ou em cálculos.
 */
export function productGroupingKey(name: string): string {
  return `n:${normalizeProductName(name)}`;
}
