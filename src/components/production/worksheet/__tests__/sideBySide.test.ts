import { describe, it, expect } from 'vitest';
import { gradeTableFont, gradeMinWidthPx, A4_CONTENT_WIDTH_PX } from '../adaptiveFont';
import { fitBesideGrade, thumbRowWidthPx, SIDE_BY_SIDE_GAP_PX } from '../sideBySide';

/**
 * Trava a regra compartilhada do padrão "não gaste ALTURA deixando a LARGURA
 * parada". Ela nasceu dentro do Corte Forração e virou módulo próprio quando
 * um segundo setor foi avaliado — o teste existe para que a regra continue
 * UMA só, e não duas cópias que divergem no dia em que alguém mexer numa.
 */

const ADULTO = ['34', '35', '36', '37', '38', '39', '40'];
const DENSA = ['23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40'];

describe('fitBesideGrade — a grade manda na largura', () => {
  it('aprova a foto de 92px ao lado da grade de 7 numerações (o caso do PV-00167)', () => {
    const r = fitBesideGrade({
      asideWidthPx: thumbRowWidthPx(1, 92), sizeKeys: ADULTO,
      font: gradeTableFont(ADULTO, true), maxCellDigits: 3,
    });
    expect(r.fits).toBe(true);
    expect(r.slackPx).toBeGreaterThan(0);
  });

  it('REPROVA na grade densa: a foto deixaria a grade abaixo do mínimo', () => {
    const r = fitBesideGrade({
      asideWidthPx: thumbRowWidthPx(2, 68), sizeKeys: DENSA,
      font: gradeTableFont(DENSA, true), maxCellDigits: 4,
    });
    expect(r.fits).toBe(false);
    expect(r.slackPx).toBeLessThan(0);
  });

  it('bloco estreito de largura zero nunca forma linha', () => {
    const r = fitBesideGrade({ asideWidthPx: 0, sizeKeys: ADULTO, font: gradeTableFont(ADULTO, true) });
    expect(r.fits).toBe(false);
    expect(r.rigidWidthPx).toBe(0);
  });

  it('INVARIANTE: aprovando, o que sobra para a grade fica ≥ o mínimo dela', () => {
    for (const n of [1, 2, 3, 4]) {
      for (const px of [52, 68, 92]) {
        for (const cols of [4, 7, 10, 14, 18, 22]) {
          for (const digits of [2, 3, 4, 5]) {
            const sizes = Array.from({ length: cols }, (_, i) => String(22 + i));
            const font = gradeTableFont(sizes, true);
            const aside = thumbRowWidthPx(n, px);
            const r = fitBesideGrade({ asideWidthPx: aside, sizeKeys: sizes, font, maxCellDigits: digits });
            if (!r.fits) continue;
            const sobra = A4_CONTENT_WIDTH_PX - aside - SIDE_BY_SIDE_GAP_PX;
            expect(sobra).toBeGreaterThanOrEqual(gradeMinWidthPx(sizes, font, digits));
          }
        }
      }
    }
  });

  it('a largura declarada cobre o bloco estreito, o respiro E o mínimo da grade', () => {
    const font = gradeTableFont(ADULTO, true);
    const aside = thumbRowWidthPx(2, 68);
    const r = fitBesideGrade({ asideWidthPx: aside, sizeKeys: ADULTO, font, maxCellDigits: 3 });
    expect(r.rigidWidthPx).toBe(aside + SIDE_BY_SIDE_GAP_PX + gradeMinWidthPx(ADULTO, font, 3));
  });

  it('largura útil MENOR (linha dentro de card com padding) restringe mais', () => {
    const font = gradeTableFont(ADULTO, true);
    const aside = thumbRowWidthPx(3, 92);
    const naPagina = fitBesideGrade({ asideWidthPx: aside, sizeKeys: ADULTO, font, maxCellDigits: 4 });
    const noCard = fitBesideGrade({
      asideWidthPx: aside, sizeKeys: ADULTO, font, maxCellDigits: 4,
      availableWidthPx: A4_CONTENT_WIDTH_PX - 3 - 16,
    });
    expect(noCard.slackPx).toBeLessThan(naPagina.slackPx);
  });

  it('thumbRowWidthPx conta os respiros ENTRE as miniaturas, não depois da última', () => {
    expect(thumbRowWidthPx(1, 92)).toBe(92);
    expect(thumbRowWidthPx(2, 68)).toBe(2 * 68 + SIDE_BY_SIDE_GAP_PX);
    expect(thumbRowWidthPx(3, 52)).toBe(3 * 52 + 2 * SIDE_BY_SIDE_GAP_PX);
    expect(thumbRowWidthPx(0, 92)).toBe(0);
  });
});
