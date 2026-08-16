function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

export function sameStrapSourcingSelection(before: unknown, after: unknown) {
  return JSON.stringify(stableValue(before || {})) === JSON.stringify(stableValue(after || {}));
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return String(error || '');
  const record = error as Record<string, unknown>;
  return [record.message, record.details, record.hint]
    .filter((value) => typeof value === 'string')
    .join(' ');
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object' ? error as Record<string, unknown> : {};
}

function parsedDetail(error: unknown): Record<string, unknown> | null {
  const detail = errorRecord(error).details;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    return detail as Record<string, unknown>;
  }
  if (typeof detail !== 'string') return null;
  try {
    const parsed = JSON.parse(detail) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function factLine(value: unknown) {
  if (!value || typeof value !== 'object') return String(value || 'fato sem detalhe');
  const fact = value as Record<string, unknown>;
  const type = String(fact.type || 'fato');
  const entityId = String(fact.entity_id || 'sem UUID');
  const detail = fact.detail == null ? '' : ` · ${JSON.stringify(fact.detail)}`;
  return `${type} · ${entityId}${detail}`;
}

export function isCommittedStrapSourcingError(error: unknown) {
  return /origem comprometida.*override_sale_order_item_strap_sourcing/i.test(errorText(error));
}

export function strapSourcingErrorDetails(error: unknown) {
  const record = errorRecord(error);
  const detail = parsedDetail(error);
  if (detail?.code === 'strap_source_override_blocked') {
    const blockedFacts = Array.isArray(detail.blocked_facts) ? detail.blocked_facts : [];
    const preservedFacts = Array.isArray(detail.preserved_realized_facts)
      ? detail.preserved_realized_facts
      : [];
    return [
      String(record.message || 'Troca de origem bloqueada por fatos físicos ou documentais.'),
      `Ação necessária: ${String(detail.required_action || 'Concilie os fatos bloqueadores no fluxo documental.')}`,
      `Bloqueios (${blockedFacts.length}):`,
      ...blockedFacts.map((fact) => `• ${factLine(fact)}`),
      `Fatos realizados preservados (${preservedFacts.length}):`,
      ...preservedFacts.map((fact) => `• ${factLine(fact)}`),
      record.hint ? `Orientação do servidor: ${String(record.hint)}` : '',
    ].filter(Boolean).join('\n');
  }
  if (String(record.code || '') === '40001') {
    return `${String(record.message || 'A revisão da origem mudou em outra sessão.')} Recarregue o PV para usar a revisão atual; nenhum override foi aplicado.`;
  }
  const text = errorText(error).trim();
  return text || 'O servidor recusou a troca de origem comprometida sem informar detalhes.';
}
