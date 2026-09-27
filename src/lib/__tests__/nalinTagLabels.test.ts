import { describe, expect, it } from 'vitest';
import {
  NALIN_TAG_DEFAULT_BRANDING,
  defaultPatternForKey,
  type ClientOrderLine,
} from '@/lib/clientLabelPattern';
import {
  NALIN_TAG_ART_DOTS,
  NALIN_TAG_DPI,
  buildNalinTagPdf,
  buildNalinTagZpl,
  composeNalinTagLabelCopy,
  countNalinTagLabels,
  formatNalinTagMainPrice,
  formatNalinTagSecondaryPrice,
  nalinTagPdfFilename,
  nalinTagRailCodes,
  nalinTagZplFilename,
  splitNalinExchangeLines,
  stripNalinTagAccents,
} from '@/lib/nalinTagLabels';

function sampleRow(overrides: Partial<ClientOrderLine> = {}): ClientOrderLine {
  return {
    tamanho: '37',
    cor: 'BROWN',
    referencia: '4031-40195',
    codProduto: '900280',
    codigoBarra: '2260093784242',
    quantidade: 3,
    descricao: 'TAMANCO FEMININO',
    valor: '89,99',
    valorSecundario: '18,00',
    tipo: 'CR',
    categoria: 'FEM',
    grupo: 'JEA',
    ...overrides,
  };
}

describe('nalinTagLabels · copy da Tag física', () => {
  it('espelha a foto (900280 / TAM 37 / R$ 89.99 / 18,00)', () => {
    const copy = composeNalinTagLabelCopy(sampleRow(), NALIN_TAG_DEFAULT_BRANDING);
    expect(copy.codProduto).toBe('900280');
    expect(copy.referencia).toBe('4031-40195');
    expect(copy.descricao).toBe('TAMANCO FEMININO');
    expect(copy.cor).toBe('BROWN');
    expect(copy.tamanho).toBe('37');
    expect(copy.codigoBarra).toBe('2260093784242');
    expect(copy.railCodes).toEqual(['CR', 'FEM', 'JEA']);
    expect(copy.priceMain).toBe('89.99');
    expect(copy.priceSecondary).toBe('18,00');
    expect(copy.exchangeLines).toEqual([
      'TROCA EM ATÉ 10 DIAS COM',
      'ETIQUETA E CUPOM FISCAL',
    ]);
  });

  it('formata preço principal com ponto e secundário com vírgula', () => {
    expect(formatNalinTagMainPrice('89,99')).toBe('89.99');
    expect(formatNalinTagMainPrice('89.99')).toBe('89.99');
    expect(formatNalinTagSecondaryPrice('18,00')).toBe('18,00');
    expect(formatNalinTagSecondaryPrice('')).toBe('');
  });

  it('quebra o texto de troca como na Tag física', () => {
    expect(splitNalinExchangeLines(NALIN_TAG_DEFAULT_BRANDING.exchangeText)).toEqual([
      'TROCA EM ATÉ 10 DIAS COM',
      'ETIQUETA E CUPOM FISCAL',
    ]);
  });

  it('trilho corta códigos longos e ignora vazios', () => {
    expect(
      nalinTagRailCodes(
        sampleRow({ tipo: 'CATEGORIA_LONGA', categoria: '', grupo: 'AB' }),
      ),
    ).toEqual(['CATEGO', 'AB']);
  });

  it('stripNalinTagAccents só remove diacríticos', () => {
    expect(stripNalinTagAccents('FEMININO')).toBe('FEMININO');
    expect(stripNalinTagAccents('ATÉ')).toBe('ATE');
  });
});

describe('nalinTagLabels · mídia L42PRO 40×60', () => {
  it('grade 320×480 dots a 203 dpi', () => {
    expect(NALIN_TAG_DPI).toBe(203);
    expect(NALIN_TAG_ART_DOTS.gridW).toBe(320);
    expect(NALIN_TAG_ART_DOTS.gridH).toBe(480);
    const pattern = defaultPatternForKey('nalin_tag');
    expect(pattern.geometry.labelWidthMm).toBe(40);
    expect(pattern.geometry.labelHeightMm).toBe(60);
  });

  it('conta etiquetas com e sem repetição por quantidade', () => {
    const rows = [sampleRow({ quantidade: 3 }), sampleRow({ tamanho: '38', quantidade: 2 })];
    expect(countNalinTagLabels(rows, true)).toBe(5);
    expect(countNalinTagLabels(rows, false)).toBe(2);
  });

  it('gera PDF binário válido (header %PDF)', async () => {
    const pattern = defaultPatternForKey('nalin_tag');
    const doc = await buildNalinTagPdf([sampleRow()], {
      geometry: pattern.geometry,
      branding: pattern.branding,
      repeatByQuantity: false,
    });
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(nalinTagPdfFilename('pedido.csv')).toMatch(/Nalin_Tag/i);
  });

  it('gera ZPL com mídia 40×60 e CODE128 rotacionado', () => {
    const pattern = defaultPatternForKey('nalin_tag');
    const zpl = buildNalinTagZpl([sampleRow()], {
      geometry: pattern.geometry,
      branding: pattern.branding,
      repeatByQuantity: false,
    });
    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^XZ');
    expect(zpl).toContain('^PW320');
    expect(zpl).toContain('^LL480');
    expect(zpl).toContain('^BCB');
    expect(zpl).toContain('2260093784242');
    expect(zpl).toContain('89.99');
    expect(zpl).toContain('18,00');
    expect(zpl).toContain('TAM.:');
    expect(nalinTagZplFilename('pedido.csv')).toMatch(/L42PRO\.zpl$/);
  });

  it('omite preço secundário quando o CSV não traz', () => {
    const pattern = defaultPatternForKey('nalin_tag');
    const zpl = buildNalinTagZpl([sampleRow({ valorSecundario: undefined })], {
      geometry: pattern.geometry,
      branding: pattern.branding,
      repeatByQuantity: false,
    });
    expect(zpl).toContain('89.99');
    expect(zpl).not.toContain('18,00');
  });
});
