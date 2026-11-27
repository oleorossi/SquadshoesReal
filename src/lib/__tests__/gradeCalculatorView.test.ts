import { describe, expect, it } from 'vitest';
import { calculateGrade } from '../gradeCalculator';
import {
  buildGradePrintHtml,
  buildGradeSummaryText,
  formatGradeQuantity,
  GRADE_PRINT_WINDOW_FEATURES,
  gradePrintDeliveryOptions,
} from '../gradeCalculatorView';

const draft = {
  model: 'ROSADO',
  color: 'ROSADO',
  from: 34,
  to: 40,
  sheetCount: 60,
};

const calculation = calculateGrade(
  [34, 35, 36, 37, 38, 39, 40],
  60,
  { '34': 1, '35': 1, '36': 2, '37': 3, '38': 2, '39': 2, '40': 1 },
  { '36': 10 },
);

describe('formatGradeQuantity', () => {
  it('formata no padrão brasileiro', () => {
    expect(formatGradeQuantity(720)).toBe('720');
    expect(formatGradeQuantity(1234)).toBe('1.234');
  });
});

describe('buildGradeSummaryText', () => {
  it('copia a grade na horizontal com numerações nas colunas e a linha A produzir', () => {
    const text = buildGradeSummaryText(draft, calculation);

    expect(text).toContain('CALCULADORA GRADE · SQUAD SHOES');
    expect(text).toContain('Modelo: ROSADO');
    expect(text).toContain('Cor: ROSADO');
    expect(text).toContain('Faixa: 34–40');
    expect(text).toContain('Fichas: 60');
    expect(text).toContain(['', '34', '35', '36', '37', '38', '39', '40', 'TOTAL'].join('\t'));
    expect(text).toContain(['Por ficha', '1', '1', '2', '3', '2', '2', '1', '12'].join('\t'));
    expect(text).toContain(['Necessidade', '60', '60', '120', '180', '120', '120', '60', '720'].join('\t'));
    expect(text).toContain(['Já pronta', '0', '0', '10', '0', '0', '0', '0', '10'].join('\t'));
    expect(text).toContain(['A produzir', '60', '60', '110', '180', '120', '120', '60', '710'].join('\t'));
    expect(text).toContain('Necessidade total: 720');
    expect(text).toContain('A produzir: 710');
    expect(text).not.toContain('Nº\tPor ficha\tNecessidade');
  });
});

describe('buildGradePrintHtml', () => {
  it('gera folha em paisagem com matriz horizontal e A produzir em destaque', () => {
    const html = buildGradePrintHtml(draft, calculation);

    expect(html).toContain('@page { size: landscape; margin: 10mm; }');
    expect(html).toContain('Modelo');
    expect(html).toContain('ROSADO');
    expect(html).toContain('Faixa');
    expect(html).toContain('34–40');
    expect(html).toContain('Fichas');
    expect(html).toContain('>60<');
    expect(html).toContain('Necessidade');
    expect(html).toContain('Aproveitado');
    expect(html).toContain('Sobra');
    expect(html).toContain('A produzir');
    expect(html).toContain('class="size">34<');
    expect(html).toContain('class="size">40<');
    expect(html).toContain('class="total">Total<');
    expect(html).toContain('class="produce"');
    expect(html).toContain('710');
    expect(html).toContain('Por ficha');
    expect(html).toContain('Já pronta');
    expect(html).not.toContain('size: A4 portrait');
    expect(html).not.toContain('<th>Nº</th>');
  });

  it('escapa modelo e cor para não quebrar o HTML', () => {
    const html = buildGradePrintHtml(
      { ...draft, model: '<script>alert(1)</script>', color: 'PRETO & BRANCO' },
      calculation,
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('PRETO &amp; BRANCO');
  });
});

describe('GRADE_PRINT_WINDOW_FEATURES', () => {
  it('abre a prévia em janela larga, no formato paisagem', () => {
    expect(GRADE_PRINT_WINDOW_FEATURES).toContain('width=1400');
    expect(GRADE_PRINT_WINDOW_FEATURES).toContain('height=900');
  });
});

describe('gradePrintDeliveryOptions', () => {
  it('entrega a impressão sempre em paisagem, com nome estável', () => {
    expect(gradePrintDeliveryOptions('ROSADO')).toEqual({
      filename: 'calculadora-grade-rosado',
      title: 'Calculadora Grade',
      landscape: true,
    });
    expect(gradePrintDeliveryOptions('  ')).toEqual({
      filename: 'calculadora-grade',
      title: 'Calculadora Grade',
      landscape: true,
    });
  });
});
