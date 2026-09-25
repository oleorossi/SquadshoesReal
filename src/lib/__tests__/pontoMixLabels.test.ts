import { describe, expect, it } from 'vitest';
import {
  composePontoMixLabelCopy,
  detectPontoMixDelimiter,
  formatPontoMixPrice,
  isPontoMixInternalSku,
  isPontoMixOrderHeader,
  isValidEan13,
  normalizePontoMixArtLines,
  parsePontoMixOrderCsv,
  renderPontoMixTemplate,
  resolvePontoMixBarcodeSymbology,
  splitPontoMixDescricaoIntoArtLines,
  buildPontoMixZpl,
} from '@/lib/pontoMixLabels';
import {
  PONTO_MIX_DEFAULT_TEMPLATES,
  defaultPatternForKey,
} from '@/lib/clientLabelPattern';

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

  it('templates renderizam placeholders da arte', () => {
    const rows = parsePontoMixOrderCsv(sampleCsv);
    const copy = composePontoMixLabelCopy(rows[0]!, PONTO_MIX_DEFAULT_TEMPLATES);
    expect(copy.line1).toBe('SANDALIA CALCADOS FEM');
    expect(copy.line2).toBe('SQUARD SHOES SP201');
    expect(copy.line3).toBe('PRETO 34 34');
    expect(copy.tamanho).toBe('34');
    expect(copy.priceText).toBe('R$ 39.99');
    expect(copy.barcodeSymbology).toBe('code128');
  });

  it('reconstrói as 3 linhas da arte quando descrição vem completa + SKU interno', () => {
    // Caso do PDF errado: descricao dump + referencia 64841968-00-0000000
    const row = {
      descricao: 'SANDALIA CALCADOS FEM SQUARD SHOES SP201 PRETO 34 34',
      referencia: '64841968-00-0000000',
      cor: 'PRETO',
      tamanho: '34',
      codigoBarra: '105742',
      codProduto: '105742',
      quantidade: 1,
      valor: '39.99',
    };
    expect(isPontoMixInternalSku(row.referencia)).toBe(true);
    const split = splitPontoMixDescricaoIntoArtLines(row.descricao, row.cor, row.tamanho);
    expect(split).toEqual({
      line1: 'SANDALIA CALCADOS FEM',
      line2: 'SQUARD SHOES SP201',
      line3: 'PRETO 34 34',
    });
    const copy = composePontoMixLabelCopy(row, PONTO_MIX_DEFAULT_TEMPLATES);
    expect(copy.line1).toBe('SANDALIA CALCADOS FEM');
    expect(copy.line2).toBe('SQUARD SHOES SP201');
    expect(copy.line3).toBe('PRETO 34 34');
    expect(copy.line2).not.toMatch(/64841968/);
  });

  it('normalizePontoMixArtLines não mexe no CSV já canônico', () => {
    const rows = parsePontoMixOrderCsv(sampleCsv);
    const rendered = {
      line1: 'SANDALIA CALCADOS FEM',
      line2: 'SQUARD SHOES SP201',
      line3: 'PRETO 34 34',
    };
    expect(normalizePontoMixArtLines(rendered, rows[0]!)).toEqual(rendered);
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

  it('formato de preço honra separador', () => {
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

  it('parseia Padrao.txt sem cabeçalho (BarTender) por inferência', () => {
    const padrao = [
      'SANDALIA CALCADOS FEM\tSQUARD SHOES SP201\tPRETO\t34\t105742\t39.99\t2',
      'SANDALIA CALCADOS FEM\tSQUARD SHOES SP201\tPRETO\t35\t105743\t39.99\t1',
    ].join('\n');
    const rows = parsePontoMixOrderCsv(padrao, undefined, 'Padrao.txt');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.codigoBarra).toBe('105742');
    expect(rows[0]!.tamanho).toBe('34');
    expect(rows[0]!.valor).toBe('39.99');
    expect(rows[0]!.quantidade).toBe(2);
    expect(rows[1]!.tamanho).toBe('35');
  });

  it('aceita cabeçalho CodigoBarras estilo BarTender', () => {
    const txt = [
      'Descricao|Referencia|Cor|Tamanho|CodigoBarras|Preco|Quantidade',
      'SANDALIA CALCADOS FEM|SQUARD SHOES SP201|PRETO|34|105742|39.99|2',
    ].join('\n');
    const rows = parsePontoMixOrderCsv(txt);
    expect(rows[0]!.codigoBarra).toBe('105742');
    expect(rows[0]!.descricao).toBe('SANDALIA CALCADOS FEM');
  });

  it('pula linhas de comando %BTW% do BarTender', () => {
    const txt = [
      '%BTW% /AF="Etiqueta_com_logo.btw" /P',
      '%END%',
      'Descricao;Referencia;Cor;Tamanho;Codigo Barra;Preco;Qtd',
      'SANDALIA CALCADOS FEM;SQUARD SHOES SP201;PRETO;34;105742;39.99;1',
    ].join('\n');
    const rows = parsePontoMixOrderCsv(txt);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codigoBarra).toBe('105742');
  });

  it('detecta delimitador tab/pipe', () => {
    expect(detectPontoMixDelimiter('a\tb\tc')).toBe('\t');
    expect(detectPontoMixDelimiter('a|b|c')).toBe('|');
    expect(detectPontoMixDelimiter('a;b;c')).toBe(';');
  });

  it('ZPL da arte errada não embute o SKU interno nas linhas', () => {
    const zpl = buildPontoMixZpl([
      {
        descricao: 'SANDALIA CALCADOS FEM SQUARD SHOES SP201 PRETO 34 34',
        referencia: '64841968-00-0000000',
        cor: 'PRETO',
        tamanho: '34',
        codigoBarra: '105742',
        codProduto: '105742',
        quantidade: 1,
        valor: '39.99',
      },
    ]);
    expect(zpl).toContain('SANDALIA CALCADOS FEM');
    expect(zpl).toContain('SQUARD SHOES SP201');
    expect(zpl).toContain('PRETO 34 34');
    expect(zpl).not.toContain('64841968');
    expect(defaultPatternForKey('ponto_mix').key).toBe('ponto_mix');
  });
});
