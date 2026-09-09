import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import OperatorWorkSheet, { OPERATOR_PHOTO_PX, operatorGradeSizes } from '../../OperatorWorkSheet';
import { fitBesideGrade } from '../sideBySide';
import { gradeTableFont, A4_CONTENT_WIDTH_PX } from '../adaptiveFont';

/**
 * Montagem e Acabamento eram os dois PIORES maços do sistema em aproveitamento
 * de largura (70% e 74%, com 1.100–1.300px em bandas mal preenchidas). O vazio
 * não estava ao lado da foto — a `density.ts` registrou "a largura é usada" e
 * por isso ninguém mexeu aqui —, estava ABAIXO dos chips, à direita dela.
 *
 * Com a foto em 128px a grade sobe para esse vazio e o maço cai uma folha nos
 * dois setores (medido em OP complexa, 30/08/2026). Estes testes travam as duas
 * pontas: que a grade sobe quando cabe, e que NÃO sobe quando espremeria a
 * tabela — o corte do `table-layout: fixed` é silencioso.
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

const ADULTO: Record<string, number> = { '34': 144, '35': 288, '36': 288, '37': 432, '38': 288, '39': 144, '40': 144 };
/** 16 numerações: o render parte em 2 blocos de 12 e a grade NÃO sobe. */
const MISTA: Record<string, number> = {};
for (let n = 25; n <= 40; n++) MISTA[String(n)] = 144;

const item = (grid: Record<string, number>) => ({
  order: {
    id: '1', op_number: 'OP-2026-03830', sale_order_number: 'PV-00167',
    total_pairs: Object.values(grid).reduce((a, b) => a + b, 0), grid, color: 'OFF WHITE',
    variant: { color_name: 'OFF WHITE', color_hex: '#F1EDE2' },
    master: { name: 'NL01' },
  },
  soleColor: '01', insoleColor: 'OFF WHITE', fichas: 144, corrugado: 12,
}) as never;

/** A linha foto+dados é a única que declara largura rígida nesta ficha. */
const linhaComGrade = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[data-rigid-width]'))
    .find(el => el.querySelector('table') && el.querySelector('img'));

describe('Montagem / Acabamento — grade ao lado da foto', () => {
  it('a foto é de 128px: piso de PRODUTO, não de layout', () => {
    // 64px foi medido (mesma economia de folha, largura um pouco melhor) e
    // recusado: a foto é a imagem pela qual o operador confere o modelo na
    // bancada, não um selo. Não encolher sem decisão do dono.
    expect(OPERATOR_PHOTO_PX).toBe(128);
  });

  it('grade de 7 numerações SOBE para o lado da foto', () => {
    const { container } = render(<OperatorWorkSheet sector="Montagem" items={[item(ADULTO)]} />);
    const linha = linhaComGrade(container);
    expect(linha).toBeTruthy();
    expect(linha!.querySelector('img')).toBeTruthy();
    expect(linha!.querySelectorAll('table').length).toBe(1);
    // e não sai DE NOVO num bloco próprio
    expect(container.querySelectorAll('table').length).toBe(1);
  });

  it('grade partida em 2 blocos de 12 colunas NÃO sobe — fica onde estava', () => {
    const { container } = render(<OperatorWorkSheet sector="Montagem" items={[item(MISTA)]} />);
    expect(linhaComGrade(container)).toBeUndefined();
    expect(container.querySelectorAll('table').length).toBeGreaterThan(0); // continua no papel
  });

  it('vale igual no Acabamento', () => {
    const { container } = render(<OperatorWorkSheet sector="Acabamento" items={[item(ADULTO)]} />);
    expect(linhaComGrade(container)).toBeTruthy();
  });

  it('a linha declara largura suficiente para a foto E o mínimo da grade', () => {
    const { container } = render(<OperatorWorkSheet sector="Montagem" items={[item(ADULTO)]} />);
    const declarada = Number(linhaComGrade(container)!.dataset.rigidWidth);
    const sizes = operatorGradeSizes(ADULTO);
    const esperada = fitBesideGrade({
      asideWidthPx: OPERATOR_PHOTO_PX, sizeKeys: sizes,
      font: gradeTableFont(sizes), maxCellDigits: 3,
    }).rigidWidthPx;
    expect(declarada).toBeGreaterThanOrEqual(OPERATOR_PHOTO_PX);
    expect(declarada).toBeLessThanOrEqual(A4_CONTENT_WIDTH_PX);
    expect(Math.abs(declarada - esperada)).toBeLessThanOrEqual(12); // dígitos podem diferir
  });

  it('a guarda reprova sozinha se a foto crescer demais', () => {
    const sizes = operatorGradeSizes(ADULTO);
    const font = gradeTableFont(sizes);
    expect(fitBesideGrade({ asideWidthPx: OPERATOR_PHOTO_PX, sizeKeys: sizes, font, maxCellDigits: 4 }).fits).toBe(true);
    // uma foto de 500px não deixaria a grade acima do mínimo
    expect(fitBesideGrade({ asideWidthPx: 500, sizeKeys: sizes, font, maxCellDigits: 4 }).fits).toBe(false);
  });

  it('a ficha continua entregando o conteúdo todo', () => {
    const { container } = render(<OperatorWorkSheet sector="Montagem" items={[item(ADULTO)]} />);
    const txt = container.textContent || '';
    expect(txt).toContain('NL01');
    expect(txt).toContain('OFF WHITE');
    expect(txt).toContain('432');            // total do nº 37
    expect(txt).toContain('Controle de Fichas');
  });
});
