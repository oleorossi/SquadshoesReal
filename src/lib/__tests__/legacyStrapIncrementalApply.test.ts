import { describe, expect, it } from 'vitest';
import {
  createLegacyStrapIncrementalIdempotencyKey,
  isLegacyStrapScopeChecksum,
} from '@/lib/legacyStrapIncrementalApply';

describe('aplicação incremental de rateio legado', () => {
  it('mantém a mesma chave durante a mesma tentativa e muda entre tentativas', () => {
    const input = { cutoverId: 'cutover-1', mappingId: 'mapping-1' };
    const first = createLegacyStrapIncrementalIdempotencyKey({ ...input, attemptId: 'attempt-1' });
    expect(createLegacyStrapIncrementalIdempotencyKey({ ...input, attemptId: 'attempt-1' })).toBe(first);
    expect(createLegacyStrapIncrementalIdempotencyKey({ ...input, attemptId: 'attempt-2' })).not.toBe(first);
  });

  it('aceita apenas checksum SHA-256 minúsculo do escopo', () => {
    expect(isLegacyStrapScopeChecksum('a'.repeat(64))).toBe(true);
    expect(isLegacyStrapScopeChecksum('A'.repeat(64))).toBe(false);
    expect(isLegacyStrapScopeChecksum('a'.repeat(63))).toBe(false);
  });
});
