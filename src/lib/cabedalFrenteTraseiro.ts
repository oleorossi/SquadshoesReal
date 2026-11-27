/**
 * Frente e Traseiro na ficha de operador de Cabedal.
 *
 * O operador marca cada parte de forma independente: o traseiro pode estar
 * pronto com a frente ainda pendente. Usado na grade de Controle de Fichas
 * (Corte Cabedal, Costura Cabedal, Aviamento) e para etiquetar peças/etapas
 * quando o rótulo identifica a parte.
 */

export const CABEDAL_FRENTE_TRASEIRO_SECTORS = [
  'Corte Cabedal',
  'Costura Cabedal',
  'Aviamento',
] as const;

export type CabedalFrenteTraseiroSector = (typeof CABEDAL_FRENTE_TRASEIRO_SECTORS)[number];

export type CabedalPart = 'frente' | 'traseiro';

/** Traseiro primeiro: um rótulo com as duas palavras cai no traseiro. */
const TRASEIRO_RE = /(traseiro|traseira|tal[aã]o|counter|heel|calcanhar)/i;
const FRENTE_RE = /(frente|front)/i;

export function isCabedalFrenteTraseiroSector(sector: string | null | undefined): boolean {
  return (CABEDAL_FRENTE_TRASEIRO_SECTORS as readonly string[]).includes(String(sector || '').trim());
}

/** Classifica um rótulo de peça, etapa ou tira como Frente, Traseiro ou indefinido. */
export function classifyCabedalPart(label: string | null | undefined): CabedalPart | null {
  const text = String(label || '').trim();
  if (!text) return null;
  if (TRASEIRO_RE.test(text)) return 'traseiro';
  if (FRENTE_RE.test(text)) return 'frente';
  return null;
}

export function cabedalPartLabel(part: CabedalPart): 'Frente' | 'Traseiro' {
  return part === 'frente' ? 'Frente' : 'Traseiro';
}

export function cabedalPartBadge(part: CabedalPart): 'F' | 'T' {
  return part === 'frente' ? 'F' : 'T';
}
