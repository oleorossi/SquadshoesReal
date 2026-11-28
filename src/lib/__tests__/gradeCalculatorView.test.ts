import { describe, expect, it } from 'vitest';
import { calculateGrade } from '../gradeCalculator';
import {
  buildGradePrintHtml,
  buildGradeSummaryText,
  formatGradeQuantity,
  GRADE_PRINT_WINDOW_FEATURES,
  gradePrintCoveredRows,
  gradePrintDeliveryOptions,
  gradePrintVisibleRows,
  isGradePrintPhoneLayout,
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


describe('buildGradePrintHtml — folha A4 (desktop)', () => {
  it('gera folha em paisagem só com a linha A produzir e oculta o que já está coberto', () => {
    const html = buildGradePrintHtml(draft, calculation);

    expect(html).toContain('@page { size: landscape; margin: 10mm; }');
    expect(html).toContain('Modelo');
    expect(html).toContain('ROSADO');
    expect(html).toContain('Faixa');
    expect(html).toContain('34–40');
    expect(html).toContain('Fichas');
    expect(html).toContain('>60<');
    expect(html).toContain('A produzir');
    expect(html).toContain('class="size">34<');
    expect(html).toContain('class="size">36<');
    expect(html).toContain('class="size">40<');
    expect(html).toContain('class="total">Total<');
    expect(html).toContain('class="produce"');
    expect(html).toContain('710');
    expect(html).toContain('110');
    expect(html).not.toContain('Por ficha');
    expect(html).not.toContain('Já pronta');
    expect(html).not.toContain('Aproveitado');
    expect(html).not.toContain('Sobra');
    expect(html).not.toContain('Necessidade');
    expect(html).not.toContain('size: A4 portrait');
    expect(html).not.toContain('<th>Nº</th>');
    expect(html).not.toContain('Numerações já cobertas');
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
  it('entrega a folha do desktop em paisagem, com nome estável', () => {
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

  it('entrega o arquivo do celular em retrato', () => {
    expect(gradePrintDeliveryOptions('ROSADO', 'phone')).toEqual({
      filename: 'calculadora-grade-rosado',
      title: 'Calculadora Grade',
      landscape: false,
    });
  });
});

describe('isGradePrintPhoneLayout', () => {
  it('usa o recorte de 767px para escolher o arquivo de retrato', () => {
    const original = globalThis.window;
    // @ts-expect-error ambiente de teste
    globalThis.window = {
      matchMedia: (query: string) => ({ matches: query.includes('767px') }),
    };
    expect(isGradePrintPhoneLayout()).toBe(true);
    // @ts-expect-error ambiente de teste
    globalThis.window = {
      matchMedia: () => ({ matches: false }),
    };
    expect(isGradePrintPhoneLayout()).toBe(false);
    if (original) globalThis.window = original;
    else delete (globalThis as { window?: unknown }).window;
  });
});

describe('gradePrintVisibleRows', () => {
  it('mantém numeração parcial e oculta a que já está toda coberta', () => {
    const mixed = calculateGrade(
      [33, 34, 35, 36, 37, 38, 39, 40],
      20,
      { '33': 1, '34': 2, '35': 3, '36': 4, '37': 4, '38': 3, '39': 2, '40': 1 },
      { '33': 20, '34': 10, '36': 80, '37': 20, '39': 40, '40': 5 },
    );
    expect(gradePrintCoveredRows(mixed).map((row) => row.size)).toEqual([33, 36, 39]);
    expect(gradePrintVisibleRows(mixed).map((row) => row.size)).toEqual([34, 35, 37, 38, 40]);
    expect(gradePrintVisibleRows(mixed).find((row) => row.size === 34)?.final).toBe(30);
    expect(gradePrintVisibleRows(mixed).find((row) => row.size === 40)?.final).toBe(15);
  });
});

const mixedDraft = {
  model: 'I90',
  color: 'PRETO',
  from: 33,
  to: 40,
  sheetCount: 20,
};
const mixedNeed = { '33': 1, '34': 2, '35': 3, '36': 4, '37': 4, '38': 3, '39': 2, '40': 1 };
const mixedReady = { '33': 20, '34': 10, '36': 80, '37': 20, '39': 40, '40': 5 };
const mixed = calculateGrade([33, 34, 35, 36, 37, 38, 39, 40], 20, mixedNeed, mixedReady);
const fullGrade = calculateGrade([33, 34, 35, 36, 37, 38, 39, 40], 20, mixedNeed, {});

describe('buildGradePrintHtml — só a quantidade a produzir', () => {
  it('sem palmilha pronta, mostra a grade multiplicada nas 8 numerações', () => {
    const html = buildGradePrintHtml(mixedDraft, fullGrade);
    expect(html).toContain('class="size">33<');
    expect(html).toContain('class="size">40<');
    expect(html).toContain('>20<');
    expect(html).toContain('>40<');
    expect(html).toContain('>60<');
    expect(html).toContain('>80<');
    expect(html).toContain('produce-banner');
    expect(html).toContain('400');
    expect(html).not.toContain('Por ficha');
    expect(html).not.toContain('Já pronta');
    expect(html).not.toContain('Necessidade');
    expect(html).not.toContain('Sobra');
  });

  it('com palmilha pronta, omite colunas zeradas e mostra só o que falta', () => {
    const html = buildGradePrintHtml(mixedDraft, mixed);
    expect(html).not.toContain('class="size">33<');
    expect(html).not.toContain('class="size">36<');
    expect(html).not.toContain('class="size">39<');
    expect(html).toContain('class="size">34<');
    expect(html).toContain('class="size">35<');
    expect(html).toContain('class="size">37<');
    expect(html).toContain('class="size">38<');
    expect(html).toContain('class="size">40<');
    expect(html).toContain('33–40');
    expect(html).toContain('>30<');
    expect(html).toContain('>15<');
    expect(html).toContain('225');
    expect(html).not.toContain('Numerações já cobertas');
    expect(html).not.toContain('Por ficha');
    expect(html).not.toContain('Já pronta');
  });

  it('avisa quando toda a grade já está coberta', () => {
    const covered = calculateGrade(
      [33, 34],
      1,
      { '33': 2, '34': 2 },
      { '33': 2, '34': 5 },
    );
    const html = buildGradePrintHtml({ ...mixedDraft, to: 34, sheetCount: 1 }, covered);
    expect(html).toContain('A palmilha já pronta cobre todas as numerações. Nada a produzir.');
    expect(html).not.toContain('class="size">33<');
    expect(html).not.toContain('class="size">34<');
  });
});

describe('buildGradePrintHtml — arquivo do celular em retrato', () => {
  it('lista na vertical só o que falta cortar, em retrato', () => {
    const html = buildGradePrintHtml(mixedDraft, mixed, 'phone');
    expect(html).toContain('@page { size: A4 portrait; margin: 12mm 10mm; }');
    expect(html).toContain('A cortar');
    expect(html).toContain('class="size">34<');
    expect(html).toContain('class="size">40<');
    expect(html).not.toContain('class="size">33<');
    expect(html).not.toContain('class="size">36<');
    expect(html).not.toContain('class="size">39<');
    expect(html).toContain('>30<');
    expect(html).toContain('>15<');
    expect(html).toContain('225');
    expect(html).toContain('I90');
    expect(html).toContain('PRETO');
    expect(html).not.toContain('size: landscape');
    expect(html).not.toContain('Por ficha');
    expect(html).not.toContain('Já pronta');
    expect(html).not.toContain('Necessidade');
    expect(html).not.toContain('Sobra');
  });

  it('sem palmilha pronta, lista a grade multiplicada em retrato', () => {
    const html = buildGradePrintHtml(mixedDraft, fullGrade, 'phone');
    expect(html).toContain('@page { size: A4 portrait');
    expect(html).toContain('class="size">33<');
    expect(html).toContain('class="size">40<');
    expect(html).toContain('400');
  });
});
