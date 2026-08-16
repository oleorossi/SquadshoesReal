const IDEMPOTENCY_PREFIX = 'strap-legacy-incremental-ui';

export function createLegacyStrapIncrementalIdempotencyKey({
  cutoverId,
  mappingId,
  attemptId = crypto.randomUUID(),
}: {
  cutoverId: string;
  mappingId: string;
  attemptId?: string;
}) {
  return `${IDEMPOTENCY_PREFIX}:${cutoverId}:${mappingId}:${attemptId}`;
}

export function isLegacyStrapScopeChecksum(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
