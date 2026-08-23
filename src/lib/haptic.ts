/** Toque curto no aparelho — no-op em desktop e se o browser recusar. */
export function haptic(ms = 15): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iOS Safari antigo, permissão recusada */
  }
}
