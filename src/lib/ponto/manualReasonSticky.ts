/**
 * Justificativa sticky por funcionário na sessão do browser.
 * Só memória de aba — a trilha oficial continua em time_record_manual_overrides.
 */
const KEY_PREFIX = 'ponto:last-reason:';

export function manualReasonStorageKey(employeeId: string): string {
  return `${KEY_PREFIX}${employeeId}`;
}

export function readStickyManualReason(employeeId: string): string {
  if (typeof sessionStorage === 'undefined' || !employeeId) return '';
  try {
    return sessionStorage.getItem(manualReasonStorageKey(employeeId)) || '';
  } catch {
    return '';
  }
}

export function writeStickyManualReason(employeeId: string, reason: string): void {
  if (typeof sessionStorage === 'undefined' || !employeeId) return;
  const trimmed = reason.trim();
  if (trimmed.length < 4) return;
  try {
    sessionStorage.setItem(manualReasonStorageKey(employeeId), trimmed);
  } catch {
    // quota / private mode — ignore
  }
}
