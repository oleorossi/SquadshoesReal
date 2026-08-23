export type QueueErrorKind = 'ficha' | 'reserva' | 'rede' | 'limite' | 'outro';

export function classifyQueueError(message: string | null | undefined, attempts: number, maxAttempts = 5): QueueErrorKind {
  if (attempts >= maxAttempts) return 'limite';
  const t = (message || '').toLowerCase();
  if (!t) return 'outro';
  if (t.includes('failed to fetch') || t.includes('network') || t.includes('offline') || t.includes('timeout')) {
    return 'rede';
  }
  if (t.includes('ficha') || t.includes('strap') || t.includes('tira') || t.includes('identidade')) {
    return 'ficha';
  }
  if (t.includes('reserva') || t.includes('reservation') || t.includes('estoque insuficiente')) {
    return 'reserva';
  }
  return 'outro';
}

export function queueErrorLabel(kind: QueueErrorKind): string {
  switch (kind) {
    case 'ficha': return 'Ficha incompleta — corrija no ERP';
    case 'reserva': return 'Reserva/estoque recusou o PV';
    case 'rede': return 'Sem rede na hora do envio';
    case 'limite': return '5 tentativas — toque em Tentar de novo';
    default: return 'Erro no envio';
  }
}
