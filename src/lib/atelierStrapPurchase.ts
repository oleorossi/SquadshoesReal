/**
 * Quem compra a tira do Ateliê. Os outros motores não repetem a compra nem a OS.
 *
 * - SKU de tira (`is_artisanal_strap` / buy_ready): motor `strap_demand`
 *   (quinzena, source_type strap_demand). A OC semanal não inclui esse SKU.
 * - Napa + OS do prestador: só o clique da aba Tiras
 *   (`generate_atelier_strap_purchase_and_service`). Não entra no estoque da
 *   fábrica e não é gerada pela OC semanal.
 * - Componente do kit que não é tira artesanal (elástico, aviamento comprado):
 *   a OC semanal, uma vez. O lote só debita na liberação. Não abre OS.
 */

export type AtelierStrapBuyer = 'strap_demand' | 'tiras_tab' | 'weekly_oc';

export function atelierStrapBuyer(input: {
  isArtisanalStrap: boolean;
  component?: string | null;
}): AtelierStrapBuyer {
  if (input.isArtisanalStrap) return 'strap_demand';
  return 'weekly_oc';
}

/** A OC semanal não leva o SKU que outro motor já compra. */
export function weeklyOcIncludesMaterial(input: {
  isArtisanalStrap: boolean;
}): boolean {
  return !input.isArtisanalStrap;
}
