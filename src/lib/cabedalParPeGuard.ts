/**
 * Guarda pé × par no consumo de cabedal.
 *
 * Canônico = dm²/PAR. Cadastro por pé subestima ~2×. A normalização legada é
 * assistida (CabedalParPeAuditPanel + RPC double_upper_consumption). Esta
 * guarda impede NOVO cadastro sem confirmação explícita.
 *
 * Heurística de suspeita (espelha o painel de auditoria): valor ≈ 40–60% do
 * maior peer sano do mesmo material. Sem peer, pede confirmação sempre que
 * houver consumo > 0 (não dá pra separar pé de par por regra cega sozinha).
 */

export const CABEDAL_OUTLIER_DM2 = 100;

/** Valor parece metade do peer (cadastro típico por pé). */
export function isSuspectPerFoot(value: number, peerMax: number): boolean {
  if (!(value > 0) || value >= CABEDAL_OUTLIER_DM2) return false;
  if (!(peerMax > 0) || peerMax >= CABEDAL_OUTLIER_DM2) return false;
  const ratio = value / peerMax;
  return ratio >= 0.4 && ratio <= 0.6;
}

export function averagePositiveConsumption(
  scalar: number | null | undefined,
  perSize?: Record<string, number> | null,
): number {
  const values = [
    Number(scalar) || 0,
    ...Object.values(perSize || {}).map((v) => Number(v) || 0),
  ].filter((v) => v > 0 && v < CABEDAL_OUTLIER_DM2);
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sheetLooksLikePerFoot(opts: {
  upperConsumption: number | null | undefined;
  upperConsumptionPerSize?: Record<string, number> | null;
  peerMaxForMaterial: number;
}): boolean {
  const avg = averagePositiveConsumption(opts.upperConsumption, opts.upperConsumptionPerSize);
  if (!(avg > 0)) return false;
  return isSuspectPerFoot(avg, opts.peerMaxForMaterial);
}

/** Precisa confirmar POR PAR antes de gravar? */
export function needsCabedalParConfirmation(opts: {
  hasUpperMaterial: boolean;
  upperConsumption: number | null | undefined;
  upperConsumptionPerSize?: Record<string, number> | null;
  peerMaxForMaterial?: number;
}): boolean {
  if (!opts.hasUpperMaterial) return false;
  const avg = averagePositiveConsumption(opts.upperConsumption, opts.upperConsumptionPerSize);
  if (!(avg > 0)) return false;
  // Sem peer: sempre confirma (não inventa regra numérica cega).
  if (!(opts.peerMaxForMaterial! > 0)) return true;
  // Com peer: confirma se parece metade OU em todo save com consumo
  // (confirmação barata; anula deriva silenciosa).
  return true;
}

export const CABEDAL_PAR_CONFIRM_MESSAGE =
  'O consumo de Cabedal está em dm² POR PAR (dois pés juntos)?\n\n' +
  'Se você mediu só UM pé, cancele e dobre os valores — ou use ' +
  'Diagnósticos → Consumo → “Padrão par × pé” (×2 assistido).\n\n' +
  'OK = está POR PAR · Cancelar = revisar';
