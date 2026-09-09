import { describe, it, expect } from 'vitest';
import { gradeTableFont, gradeMinWidthPx, A4_CONTENT_WIDTH_PX } from '../adaptiveFont';
import { compactThumbPx, thumbsFitBesideGrade, COMPACT_THUMB_GAP_PX } from '../../SilkMontageWorkSheet';

/**
 * Trava a regra "a GRADE manda na largura" (CLAUDE.md → Preferências de
 * impressão, item 4) no ponto onde ela é decidida: o layout compacto do Corte
 * Forração passou a poder pôr a foto AO LADO da grade (2026-08-29), e é a
 * primeira vez que alguma coisa disputa largura com a tabela.
 *
 * O corte do `table-layout: fixed` é SILENCIOSO — o operador lê "18" onde
 * estava "180" e nada no papel denuncia. Por isso a decisão é uma função pura
 * testável, e não uma condição escondida dentro do JSX.
 */

/** Grade real do PV-00167 (a que motivou a mudança): 34–40, totais de 3 dígitos. */
const SIZES_PV167 = ['34', '35', '36', '37', '38', '39', '40'];
/** Grade mista infantil+adulto, o caso denso que existe na base. */
const SIZES_MISTA = ['23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40'];

describe('gradeMinWidthPx — largura que a grade exige para não cortar número', () => {
  it('cresce com o número de numerações', () => {
    const larguras = [4, 7, 12, 18, 24].map(n => {
      const sizes = Array.from({ length: n }, (_, i) => String(30 + i));
      return gradeMinWidthPx(sizes, gradeTableFont(sizes, true), 3);
    });
    for (let i = 1; i < larguras.length; i++) {
      expect(larguras[i]).toBeGreaterThan(larguras[i - 1]);
    }
  });

  it('mais dígitos na célula exigem mais largura', () => {
    const ft = gradeTableFont(SIZES_PV167, true);
    expect(gradeMinWidthPx(SIZES_PV167, ft, 4)).toBeGreaterThan(gradeMinWidthPx(SIZES_PV167, ft, 2));
  });

  it('chave de numeração longa (conjugada "33/34") também empurra a largura', () => {
    const simples = ['33', '34', '35'];
    const conjugada = ['33/34', '35/36', '37/38'];
    const a = gradeMinWidthPx(simples, gradeTableFont(simples, true), 2);
    const b = gradeMinWidthPx(conjugada, gradeTableFont(conjugada, true), 2);
    expect(b).toBeGreaterThan(a);
  });

  it('a grade do PV-00167 cabe com folga na largura útil da A4', () => {
    const min = gradeMinWidthPx(SIZES_PV167, gradeTableFont(SIZES_PV167, true), 4);
    expect(min).toBeLessThan(A4_CONTENT_WIDTH_PX);
  });
});

describe('thumbsFitBesideGrade — foto ao lado da grade só quando a grade aguenta', () => {
  it('PV-00167: uma miniatura de 92px convive com a grade de 7 numerações', () => {
    expect(
      thumbsFitBesideGrade(1, compactThumbPx(1), SIZES_PV167, gradeTableFont(SIZES_PV167, true), 3),
    ).toBe(true);
  });

  it('a miniatura NÃO encolhe para caber ao lado — 1 modelo continua em 92px', () => {
    // Decisão do dono 22/07/2026 (54 → 92px): o cortador identifica o modelo
    // pela foto. A mudança de 2026-08-29 move a foto, não a reduz.
    expect(compactThumbPx(1)).toBe(92);
  });

  it('grade densa com várias miniaturas volta a EMPILHAR em vez de apertar a grade', () => {
    expect(
      thumbsFitBesideGrade(3, compactThumbPx(3), SIZES_MISTA, gradeTableFont(SIZES_MISTA, true), 4),
    ).toBe(false);
  });

  it('sem miniatura não há linha a formar', () => {
    expect(
      thumbsFitBesideGrade(0, compactThumbPx(0), SIZES_PV167, gradeTableFont(SIZES_PV167, true), 3),
    ).toBe(false);
  });

  it('INVARIANTE: quando aprova, o que sobra para a grade nunca fica abaixo do mínimo', () => {
    for (const n of [1, 2, 3, 4]) {
      for (const cols of [4, 7, 10, 14, 18, 22]) {
        for (const digits of [2, 3, 4, 5]) {
          const sizes = Array.from({ length: cols }, (_, i) => String(22 + i));
          const ft = gradeTableFont(sizes, true);
          const px = compactThumbPx(n);
          if (!thumbsFitBesideGrade(n, px, sizes, ft, digits)) continue;
          const sobra = A4_CONTENT_WIDTH_PX - (n * px + (n - 1) * COMPACT_THUMB_GAP_PX) - COMPACT_THUMB_GAP_PX;
          expect(sobra).toBeGreaterThanOrEqual(gradeMinWidthPx(sizes, ft, digits));
        }
      }
    }
  });

  it('a decisão é monotônica: se não cabe com N miniaturas, não cabe com N+1 da mesma largura', () => {
    const ft = gradeTableFont(SIZES_MISTA, true);
    let jaReprovou = false;
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const cabe = thumbsFitBesideGrade(n, 52, SIZES_MISTA, ft, 4);
      if (jaReprovou) expect(cabe).toBe(false);
      if (!cabe) jaReprovou = true;
    }
  });
});
