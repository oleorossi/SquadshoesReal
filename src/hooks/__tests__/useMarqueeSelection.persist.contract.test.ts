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

  it('click normal acumula (não é Finder-replace)', () => {
    // O ramo "next.clear(); next.add(id)" no click sem modificador
    // fazia cada clique apagar a seleção anterior — sintoma do dono
    // em Imprimir Fichas: "não consigo selecionar vários ao mesmo tempo".
    expect(src).not.toMatch(/Click normal: substitui seleção/);
    expect(src).not.toMatch(/next\.clear\(\);\s*next\.add\(id\)/s);
  });

  it('marquee inicia em cima das linhas e não limpa no mousedown', () => {
    // Bug 2026-09: closest('[data-marquee-item]') + setSelectedIds(new Set())
    // no mousedown tornava o arrasto inútil em tabela densa (Imprimir Fichas).
    // Espelha SelectionMarquee do estoque: arrasto aditivo, nasce na linha.
    expect(src).not.toMatch(/closest\(\s*'\[data-marquee-item\]'/);
    expect(src).not.toMatch(/closest\(\s*"\[data-marquee-item\]"/);
    expect(src).not.toMatch(/startSelection\.current = new Set\(\);\s*setSelectedIds\(new Set\(\)\)/s);
    expect(src).toMatch(/startSelection\.current = new Set\(selectedIds\)/);
    expect(src).toMatch(/suppressClickRef/);
  });
});
