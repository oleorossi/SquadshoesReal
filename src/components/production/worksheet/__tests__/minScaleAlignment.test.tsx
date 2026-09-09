import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { gradeTableFont, floorSafeScale } from '../adaptiveFont';
import { PalmilhaWorkSheet, palmilhaGroupSizes } from '../../PalmilhaWorkSheet';
import { SolagemWorkSheet, solagemBandSizes } from '../../SolagemWorkSheet';
import { SilkMontageWorkSheet, gradeSizesOf, gradeSourceGrid } from '../../SilkMontageWorkSheet';
import OperatorWorkSheet, { operatorGradeSizes } from '../../OperatorWorkSheet';

/**
 * O `minScale` que cada ficha passa ao `PaginatedSheet` é o PISO tipográfico:
 * abaixo dele o auto-fit encolheria o número da grade além do legível no chão
 * de fábrica (decisão do dono, 31/07/2026). Ele é derivado da quantidade de
 * colunas — então tem de sair da MESMA lista de numerações que a tabela
 * desenha.
 *
 * Estavam divergindo em QUATRO das cinco fichas (só a Expedição acertava):
 * o piso vinha de `Object.keys(grade)`, que conta numeração zerada, ignora as
 * que só existem na curva-base, e não sabe que Corte Cabedal e Aviamento
 * desenham por FACA/segmento. Dependendo do cadastro isso deixava o auto-fit
 * FURAR o piso, ou gastava folha à toa.
 *
 * Estes testes travam a fonte única. jsdom não faz layout, mas o número de
 * COLUNAS é estrutura — é exatamente o que precisa bater.
 */

beforeAll(() => {
  const g = globalThis as unknown as { ResizeObserver?: unknown; matchMedia?: unknown };
  g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  g.matchMedia ??= (query: string) => ({
    matches: false, media: query,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
    onchange: null, dispatchEvent: () => false,
  });
});

const ALL = ['23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40'];
/** Grade com numeração ZERADA no meio — o caso que a conta antiga contava. */
const COM_ZEROS: Record<string, number> = { '33': 0, '34': 144, '35': 288, '36': 288, '37': 432, '38': 288, '39': 144, '40': 144 };
const BASE_CURVA: Record<string, number> = { '34': 1, '35': 2, '36': 2, '37': 3, '38': 2, '39': 1, '40': 1 };

/** Colunas de numeração da 1ª grade renderizada (thead menos "Nº" e "Total"). */
const colunasDaGrade = (c: HTMLElement) => {
  const thead = c.querySelector('table thead tr');
  expect(thead).toBeTruthy();
  return thead!.querySelectorAll('th').length - 2;
};

describe('minScale sai da MESMA lista que a grade desenha', () => {
  it('Palmilha: numeração zerada fora, numeração só-da-curva-base dentro', () => {
    const group = { grade: COM_ZEROS, baseGrade: { ...BASE_CURVA, '32': 1 } } as never;
    const sizes = palmilhaGroupSizes(ALL, group);
    expect(sizes).not.toContain('33');   // zerada na grade e ausente da base
    expect(sizes).toContain('32');       // só existe na curva-base
    expect(sizes).toContain('40');

    const { container } = render(
      <PalmilhaWorkSheet
        groups={[{
          soleName: '01', insoleColor: 'OFF WHITE', totalPairs: 1728,
          grade: COM_ZEROS, baseGrade: { ...BASE_CURVA, '32': 1 }, baseGradeSum: 13,
          fichas: 144, refs: [], opNumbers: ['OP-1'], pvNumbers: ['PV-1'],
        } as never]}
        allSizes={ALL}
      />,
    );
    expect(colunasDaGrade(container)).toBe(sizes.length);
  });

  it('Solagem: mesma regra da palmilha', () => {
    const band = { grade: COM_ZEROS, baseGrade: BASE_CURVA } as never;
    const sizes = solagemBandSizes(ALL, band);
    expect(sizes).not.toContain('33');

    const { container } = render(
      <SolagemWorkSheet
        bands={[{
          soleColor: 'PRETO', grade: COM_ZEROS, baseGrade: BASE_CURVA, baseGradeSum: 12,
          totalPairs: 1728, fichas: 144, refs: [], opNumbers: ['OP-1'],
        } as never]}
        allSizes={ALL}
        grandTotal={1728}
      />,
    );
    expect(colunasDaGrade(container)).toBe(sizes.length);
  });

  it('SilkMontage: zerada fora', () => {
    const cg = { combinedGrid: COM_ZEROS } as never;
    const sizes = gradeSizesOf(cg, 'Corte Forração');
    expect(sizes).not.toContain('33');

    const { container } = render(
      <SilkMontageWorkSheet
        sector="Corte Forração"
        groups={[{
          soleName: '01', totalPairs: 1728,
          colorGroups: [{
            color: 'OFF WHITE', combinedGrid: COM_ZEROS, baseGrid: BASE_CURVA, baseGradeSum: 12,
            fichas: 144, totalPairs: 1728, opNumbers: ['OP-1'],
          }],
        } as never]}
      />,
    );
    expect(colunasDaGrade(container)).toBe(sizes.length);
  });

  it('SilkMontage: Corte Cabedal desenha por FACA, não por numeração', () => {
    const cg = { combinedGrid: COM_ZEROS, knifeGrid: { P: 432, M: 720, G: 576 } } as never;
    expect(gradeSourceGrid(cg, 'Corte Cabedal')).toEqual({ P: 432, M: 720, G: 576 });
    expect(gradeSizesOf(cg, 'Corte Cabedal')).toEqual(['P', 'M', 'G']);
    // O mesmo grupo noutro setor volta a ser por numeração.
    expect(gradeSizesOf(cg, 'Corte Forração')).not.toContain('P');
  });

  it('SilkMontage: Aviamento desenha por segmento quando há aviamentoGrid', () => {
    const cg = { combinedGrid: COM_ZEROS, aviamentoGrid: { P: 100, G: 200 } } as never;
    expect(gradeSizesOf(cg, 'Aviamento')).toEqual(['P', 'G']);
    expect(gradeSizesOf(cg, 'Costura Cabedal')).not.toContain('P');
  });

  it('SilkMontage: grade de faca/segmento VAZIA cai de volta na numeração', () => {
    const cg = { combinedGrid: COM_ZEROS, knifeGrid: {}, aviamentoGrid: {} } as never;
    expect(gradeSizesOf(cg, 'Corte Cabedal')).toContain('34');
    expect(gradeSizesOf(cg, 'Aviamento')).toContain('34');
  });

  it('Operator: zerada fora', () => {
    const sizes = operatorGradeSizes(COM_ZEROS);
    expect(sizes).not.toContain('33');
    expect(sizes).toHaveLength(7);

    const { container } = render(
      <OperatorWorkSheet
        sector="Montagem"
        items={[{
          order: {
            id: '1', op_number: 'OP-1', total_pairs: 1728, grid: COM_ZEROS, color: 'PRETO',
            variant: { color_name: 'PRETO', color_hex: '#111' },
            master: { name: 'NL01' },
          },
        } as never]}
      />,
    );
    expect(colunasDaGrade(container)).toBe(sizes.length);
  });

  it('grade sem numeração alguma não quebra nenhum dos derivadores', () => {
    expect(palmilhaGroupSizes(ALL, { grade: {} } as never)).toEqual([]);
    expect(solagemBandSizes(ALL, { grade: {} } as never)).toEqual([]);
    expect(gradeSizesOf({ combinedGrid: {} } as never, 'Corte Forração')).toEqual([]);
    expect(operatorGradeSizes({})).toEqual([]);
  });

  /**
   * A magnitude do que estava errado, para não virar "detalhe de refatoração".
   * A forma comum de cadastro é a grade carregar a FAIXA INTEIRA com zero nas
   * numerações não vendidas — e aí a conta antiga contava 18 colunas onde o
   * papel desenha 7.
   */
  it('o piso antigo travava o auto-fit: 18 colunas contadas onde o papel desenha 7', () => {
    const FAIXA = ['23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40'];
    const DESENHADAS = ['34','35','36','37','38','39','40'];

    // Palmilha / Solagem (bucket normal): o piso proibia encolher abaixo de 0,94.
    const antesPalmilha = floorSafeScale(gradeTableFont(FAIXA));
    const depoisPalmilha = floorSafeScale(gradeTableFont(DESENHADAS));
    expect(antesPalmilha).toBeCloseTo(0.938, 3);
    expect(depoisPalmilha).toBeCloseTo(0.75, 3);

    // Layout compacto: o piso antigo era 1,0 — o auto-fit não podia encolher NADA.
    const antesCompacto = floorSafeScale(gradeTableFont(FAIXA, true));
    const depoisCompacto = floorSafeScale(gradeTableFont(DESENHADAS, true));
    expect(antesCompacto).toBe(1);
    expect(depoisCompacto).toBeCloseTo(0.833, 3);

    // Em todos os casos o piso antigo era MAIS restritivo: gastava folha à toa.
    expect(antesPalmilha).toBeGreaterThan(depoisPalmilha);
    expect(antesCompacto).toBeGreaterThan(depoisCompacto);
  });

  it('a direção do erro depende do cadastro — pode ficar PERMISSIVO também', () => {
    // Quando a curva-base cobre numerações que a grade não tem, a conta antiga
    // (só `Object.keys(grade)`) via MENOS colunas do que o papel desenha, e o
    // piso saía frouxo: o auto-fit podia encolher abaixo do legível.
    const grade = { '34': 144, '35': 288 };
    const baseGrade = { '34': 1, '35': 2, '36': 2, '37': 3, '38': 2, '39': 1, '40': 1,
                        '30': 1, '31': 1, '32': 1, '33': 1, '29': 1, '28': 1, '27': 1 };
    const ALL_ = ['27','28','29','30','31','32','33','34','35','36','37','38','39','40'];
    const antes = floorSafeScale(gradeTableFont(Object.keys(grade)));
    const depois = floorSafeScale(gradeTableFont(palmilhaGroupSizes(ALL_, { grade, baseGrade } as never)));
    expect(antes).toBeLessThan(depois);
  });
});
