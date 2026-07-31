import { describe, it, expect } from 'vitest';
import { adaptiveTableFont, gradeTableFont, floorSafeScale, FONT_FLOORS } from '../adaptiveFont';

/**
 * Trava o contrato entre o AUTO-FIT e a TABELA DE PISOS do CLAUDE.md.
 *
 * As duas regras não se conheciam: o `AUTO_FIT_FLOOR = 0.80` do PaginatedSheet
 * aplicava zoom por cima de fontes que já estavam NO piso (bucket 4: célula
 * 8px → 6,4px, número de grade 12px → 9,6px). Decisão do dono em 31/07/2026:
 * legibilidade vence densidade — o auto-fit para antes de furar o piso.
 */
describe('floorSafeScale — auto-fit nunca fura o piso tipográfico', () => {
  it('bucket 4 (o mais denso) não pode encolher nada: já está todo no piso', () => {
    // > 20 colunas cai no último bucket, cujos valores SÃO os pisos.
    expect(floorSafeScale(adaptiveTableFont(24))).toBe(1);
  });

  it('bucket 0 (folgado) tolera encolher — o piso global de 0.80 é quem manda lá', () => {
    const s = floorSafeScale(adaptiveTableFont(6));
    expect(s).toBeCloseTo(0.75, 3);
    expect(s).toBeLessThan(0.8);
  });

  it('a escala fica mais restritiva conforme a grade adensa (monotônica)', () => {
    const escalas = [6, 10, 14, 18, 24].map(n => floorSafeScale(adaptiveTableFont(n)));
    for (let i = 1; i < escalas.length; i++) {
      expect(escalas[i]).toBeGreaterThanOrEqual(escalas[i - 1]);
    }
  });

  it('nenhum elemento fica abaixo do piso quando a escala é aplicada', () => {
    for (const cols of [6, 9, 13, 17, 22, 30]) {
      const f = adaptiveTableFont(cols);
      const s = floorSafeScale(f);
      // tolerância de ponto flutuante
      expect(f.headerPx * s).toBeGreaterThanOrEqual(FONT_FLOORS.headerPx - 1e-9);
      expect(f.cellPx * s).toBeGreaterThanOrEqual(FONT_FLOORS.cellPx - 1e-9);
      expect(f.displayPx * s).toBeGreaterThanOrEqual(FONT_FLOORS.displayPx - 1e-9);
      expect(f.textPx * s).toBeGreaterThanOrEqual(FONT_FLOORS.textPx - 1e-9);
    }
  });

  it('o layout COMPACTO rebaixa o bucket e por isso restringe mais', () => {
    const sizes = ['34', '35', '36', '37', '38', '39', '40'];
    const normal = floorSafeScale(gradeTableFont(sizes, false));
    const compacto = floorSafeScale(gradeTableFont(sizes, true));
    expect(compacto).toBeGreaterThanOrEqual(normal);
  });

  it('escala 1 significa "não encolhe" — nunca devolve acima de 1', () => {
    for (const cols of [4, 8, 12, 16, 20, 24, 40]) {
      expect(floorSafeScale(adaptiveTableFont(cols))).toBeLessThanOrEqual(1);
    }
  });
});
