import {
  effectiveOperatorStrapColor,
  operatorStrapSequence,
  type OperatorStrapLineLike,
} from '@/lib/operatorStrapSequence';

/** Texto consumido pelas etiquetas, na mesma ordem técnica da ficha do operador. */
export function labelStrapSequence(
  straps: OperatorStrapLineLike[] | null | undefined,
  mainColor?: string | null,
): string {
  return operatorStrapSequence(straps)
    .filter((strap) => !!strap.label?.trim())
    .map((strap) => `${strap.label.trim()}:${effectiveOperatorStrapColor(strap, mainColor)}`)
    .join('|');
}
