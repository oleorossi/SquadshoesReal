import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Contrato: filtrar NÃO pode podar seleção fora da vista.
 * O prune antigo (validIds.has) foi removido de propósito (2026-09).
 */
describe('useMarqueeSelection persistência', () => {
  const src = readFileSync(
    resolve(__dirname, '../useMarqueeSelection.ts'),
    'utf8',
  );

  it('não poda selectedIds quando items mudam', () => {
    expect(src).not.toMatch(/validIds\.has/);
    expect(src).not.toMatch(/Limpa seleção quando lista de items muda/);
  });

  it('expõe hiddenSelectedCount e selectMatchingIds', () => {
    expect(src).toMatch(/hiddenSelectedCount/);
    expect(src).toMatch(/selectMatchingIds/);
    expect(src).toMatch(/deselectVisible/);
    expect(src).toMatch(/visibleSelectedCount/);
  });
});
