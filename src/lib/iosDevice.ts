/**
 * Detecção de iPhone/iPad no browser (inclui iPadOS com UA de desktop).
 * Usada pra desviar a entrega de PDF: no iOS o viewer inline não oferece
 * salvar/compartilhar de forma confiável (sobretudo no PWA).
 */
export function isIosBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+: Safari reporta MacIntel + toque.
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}
