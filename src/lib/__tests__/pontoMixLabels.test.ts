import { describe, expect, it } from 'vitest';
import {
  buildPontoMixTextSource,
  composePontoMixLabelCopy,
  detectPontoMixDelimiter,
  formatPontoMixPrice,
  isPontoMixInternalSku,
  isPontoMixOrderHeader,
  isValidEan13,
  parsePontoMixOrderCsv,
  renderPontoMixTemplate,
  resolvePontoMixBarcodeSymbology,
  wrapPontoMixText,
  buildPontoMixZpl,
  PONTO_MIX_ART_DOTS,
  PONTO_MIX_TEXT_CHARS,
} from '@/lib/pontoMixLabels';
import {
  PONTO_MIX_DEFAULT_TEMPLATES,
  defaultPatternForKey,
} from '@/lib/clientLabelPattern';

/** Recorte fiel do Padrao.txt que a cliente exporta do sistema dela. */
const PADRAO_REAL = [
  'id;qtde;codigo;descricao;marca;valor;campo;campo2;campo3;campo4;campo5;campo6;campo7;grupo;departamento;gradex;gradey;ncm;codigo_ean;data_alteracao;id_usuario;id_produto_grade_estoque;estoque;id_entidade;entidade  ',
  '',
  ';12;105742;SANDALIA CALCADOS  FEM SQUARD SHOES SP201 PRETO 34  34;;39.99;;;;;;;;;;PRETO;34;64041900-00-0000000;;;;;;;;',
  ';24;105743;SANDALIA CALCADOS  FEM SQUARD SHOES SP201 PRETO 35  35;;39.99;;;;;;;;;;PRETO;35;64041900-00-0000000;;;;;;;;',
].join('\n');

describe('pontoMixLabels', () => {
  const sampleCsv = [
    'Descricao;Referencia;Cor;Tamanho;Codigo Barra;Preco;Qtd',
    'SANDALIA CALCADOS FEM;SQUARD SHOES SP201;PRETO;34;105742;39.99;2',
  ].join('\n');

  it('detecta cabeçalho com código e tamanho', () => {
    expect(isPontoMixOrderHeader(sampleCsv.split('\n')[0]!.split(';'))).toBe(true);
    expect(isPontoMixOrderHeader(['foo', 'bar'])).toBe(false);
  });

  it('parseia CSV e monta linhas canônicas', () => {
    const rows = parsePontoMixOrderCsv(sampleCsv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codigoBarra).toBe('105742');
    expect(rows[0]!.tamanho).toBe('34');
    expect(rows[0]!.valor).toBe('39.99');
    expect(rows[0]!.quantidade).toBe(2);
  });

  it('Padrao.txt real: gradex/gradey viram cor e tamanho, NCM não vira referência', () => {
    const rows = parsePontoMixOrderCsv(PADRAO_REAL, undefined, 'Padrao.txt');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.codigoBarra).toBe('105742');
    expect(rows[0]!.cor).toBe('PRETO');
    expect(rows[0]!.tamanho).toBe('34');
    expect(rows[0]!.valor).toBe('39.99');
    expect(rows[0]!.quantidade).toBe(12);
    expect(rows[0]!.referencia).not.toContain('64041900');
    expect(rows[1]!.tamanho).toBe('35');
  });

  it('as 3 linhas saem da descrição LITERAL, com espaço duplo preservado', () => {
    const rows = parsePontoMixOrderCsv(PADRAO_REAL, undefined, 'Padrao.txt');
    const copy = composePontoMixLabelCopy(rows[0]!, PONTO_MIX_DEFAULT_TEMPLATES);
    expect(copy.textSource).toBe('SANDALIA CALCADOS  FEM SQUARD SHOES SP201 PRETO 34  34');
    expect(copy.line1).toBe('SANDALIA CALCADOS  FEM');
    expect(copy.line2).toBe('SQUARD SHOES SP201');
    expect(copy.line3).toBe('PRETO 34  34');
    expect(copy.priceText).toBe('R$ 39.99');
    expect(copy.tamanho).toBe('34');
  });

  it('NCM (código fiscal) nunca entra no texto da arte', () => {
    expect(isPontoMixInternalSku('64041900-00-0000000')).toBe(true);
    expect(isPontoMixInternalSku('SQUARD SHOES SP201')).toBe(false);
    const source = buildPontoMixTextSource({
      descricao: 'SANDALIA CALCADOS  FEM SQUARD SHOES SP201 PRETO 34  34',
      referencia: '64041900-00-0000000',
      cor: 'PRETO',
      tamanho: '34',
      codigoBarra: '105742',
      codProduto: '105742',
      quantidade: 1,
      valor: '39.99',
    });
    expect(source).not.toContain('64041900');
  });

  it('descrição curta é completada com referência, cor e tamanho ausentes', () => {
    const rows = parsePontoMixOrderCsv(sampleCsv);
    const source = buildPontoMixTextSource(rows[0]!);
    expect(source).toContain('SANDALIA CALCADOS FEM');
    expect(source).toContain('SQUARD SHOES SP201');
    expect(source).toContain('PRETO');
    expect(source).toContain('34');
  });

  it('wrap respeita a largura e não engole espaços internos', () => {
    const wrapped = wrapPontoMixText(
      'SANDALIA CALCADOS  FEM SQUARD SHOES SP201 PRETO 34  34',
      PONTO_MIX_TEXT_CHARS,
      s => s.length,
    );
    expect(wrapped).toEqual([
      'SANDALIA CALCADOS  FEM',
      'SQUARD SHOES SP201',
      'PRETO 34  34',
    ]);
  });

  it('wrap corta em 3 linhas com reticências quando o texto excede', () => {
    const wrapped = wrapPontoMixText(
      'AAA BBB CCC DDD EEE FFF GGG HHH III JJJ KKK LLL MMM NNN OOO PPP',
      10,
      s => s.length,
    );
    expect(wrapped).toHaveLength(3);
  });

  it('105742 usa Code128; EAN-13 válido troca simbologia', () => {
    expect(resolvePontoMixBarcodeSymbology('105742')).toBe('code128');
    expect(isValidEan13('105742')).toBe(false);
    const ean = '7891234567895';
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(ean[i]) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    const valid = `${ean.slice(0, 12)}${check}`;
    expect(isValidEan13(valid)).toBe(true);
    expect(resolvePontoMixBarcodeSymbology(valid)).toBe('ean13');
  });

  it('preço sai exatamente como no arquivo da cliente', () => {
    expect(formatPontoMixPrice('39.99')).toBe('R$ 39.99');
    expect(formatPontoMixPrice('39,99', { prefix: 'R$ ', decimalSeparator: ',' })).toBe('R$ 39,99');
  });

  it('renderPontoMixTemplate limpa espaços', () => {
    expect(
      renderPontoMixTemplate('{cor}  {tamanho}', {
        tamanho: '34',
        cor: 'PRETO',
        referencia: 'X',
        codProduto: 'X',
        codigoBarra: '1',
        quantidade: 1,
      }),
    ).toBe('PRETO 34');
  });

  it('detecta delimitador tab/pipe', () => {
    expect(detectPontoMixDelimiter('a\tb\tc')).toBe('\t');
    expect(detectPontoMixDelimiter('a|b|c')).toBe('|');
    expect(detectPontoMixDelimiter('a;b;c')).toBe(';');
  });

  it('grade de arte é a medida na etiqueta impressa (203 dpi, 320×480 dots)', () => {
    const D = PONTO_MIX_ART_DOTS;
    expect(D.gridW).toBe(320);
    expect(D.gridH).toBe(480);
    // Módulo do código de barras: 2 dots, como na etiqueta da cliente.
    expect(D.barcode.module).toBe(2);
    // Faixas recuadas, não sangradas até a borda.
    expect(D.headerBand.x).toBeGreaterThan(0);
    expect(D.priceBand.x).toBeGreaterThan(0);
    expect(D.headerBand.x + D.headerBand.w).toBeLessThan(D.gridW);
    expect(D.priceBand.x + D.priceBand.w).toBeLessThan(D.gridW);
    // Nada pode invadir a faixa de preço.
    expect(D.hri.top + D.hri.capH).toBeLessThan(D.priceBand.y);
    expect(D.barcode.y + D.barcode.h).toBeLessThan(D.hri.top);
    // O código sai do 35 da cliente para ~8 mm (64 dots), a pedido do dono.
    expect(D.barcode.x).toBe(64);
  });

  it('ZPL espelha a grade: faixa, 3 linhas, caixa, código e preço', () => {
    const rows = parsePontoMixOrderCsv(PADRAO_REAL, undefined, 'Padrao.txt');
    const zpl = buildPontoMixZpl([rows[0]!], { repeatByQuantity: false });
    expect(zpl).toContain('SANDALIA CALCADOS  FEM');
    expect(zpl).toContain('SQUARD SHOES SP201');
    expect(zpl).toContain('PRETO 34  34');
    expect(zpl).not.toContain('64041900');
    expect(zpl).toMatch(/R\$\s*39\.99/);
    expect(zpl).toContain('^BY2');
    expect(zpl).toContain('^BCN');
    // Duas faixas pretas sólidas: logo e preço.
    const bands = zpl.match(/\^GB\d+,\d+,\d+,B\^FS/g) ?? [];
    expect(bands.length).toBeGreaterThanOrEqual(2);
    expect(defaultPatternForKey('ponto_mix').key).toBe('ponto_mix');
  });
});
