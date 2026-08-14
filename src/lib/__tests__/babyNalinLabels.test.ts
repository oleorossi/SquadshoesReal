import { describe, it, expect } from 'vitest';
import { CODE128_PATTERNS, code128Bars, encodeCode128 } from '@/lib/code128';
import {
  ART_WIDTH_MM,
  MEDIA_HEIGHT_MM,
  MEDIA_WIDTH_MM,
  MIN_FONT_PT,
  MODULE_MM,
  OFFSET_X_MM,
  OFFSET_Y_MM,
  QUIET_ZONE_MIN_MM,
  assertBarcodeFits,
  decodeOrderBytes,
  expandRows,
  fitText,
  measureBarcode,
  parseOrderCsv,
  pdfFilename,
  type BabyNalinRow,
} from '@/lib/babyNalinLabels';

/** Código real do padrão do cliente: 13 dígitos, prefixo 226. */
const EAN = '2260000303222';

describe('tabela CODE128', () => {
  it('tem os 107 símbolos', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
  });

  it('cada símbolo soma 11 módulos — menos o STOP, que soma 13', () => {
    CODE128_PATTERNS.forEach((padrao, i) => {
      const soma = [...padrao].reduce((t, d) => t + Number(d), 0);
      expect(soma, `símbolo ${i}`).toBe(i === 106 ? 13 : 11);
      expect(padrao.length, `símbolo ${i}`).toBe(i === 106 ? 7 : 6);
    });
  });

  it('os símbolos de start e stop são os canônicos', () => {
    expect(CODE128_PATTERNS[103]).toBe('211412'); // Start A
    expect(CODE128_PATTERNS[104]).toBe('211214'); // Start B
    expect(CODE128_PATTERNS[105]).toBe('211232'); // Start C
    expect(CODE128_PATTERNS[106]).toBe('2331112'); // Stop
  });
});

describe('encodeCode128', () => {
  it('usa o conjunto C em cadeia par de dígitos e fecha com o checksum certo', () => {
    // Start C + 12 34 56 78 → checksum (105 + 1·12 + 2·34 + 3·56 + 4·78) mod 103 = 47
    const { values, checksum } = encodeCode128('12345678');
    expect(values).toEqual([105, 12, 34, 56, 78, 47, 106]);
    expect(checksum).toBe(47);
  });

  it('volta pro conjunto B no dígito ímpar que sobra', () => {
    const { values } = encodeCode128(EAN);
    expect(values[0]).toBe(105); // Start C
    expect(values.slice(1, 7)).toEqual([22, 60, 0, 3, 3, 22]); // 6 pares = 12 dígitos
    expect(values[7]).toBe(100); // CODE_B pro último dígito
    expect(values[8]).toBe('2'.charCodeAt(0) - 32);
    expect(values[values.length - 1]).toBe(106); // Stop
  });

  it('13 dígitos dão 123 módulos', () => {
    const { moduleCount, modules } = encodeCode128(EAN);
    expect(moduleCount).toBe(123);
    expect(modules).toHaveLength(123);
  });

  it('começa e termina em barra (nunca em espaço)', () => {
    const { modules } = encodeCode128(EAN);
    expect(modules.startsWith('11')).toBe(true);
    expect(modules.endsWith('11')).toBe(true);
  });

  it('recusa caractere não imprimível em vez de gerar código ilegível', () => {
    expect(() => encodeCode128('ABC')).toThrow(/não imprimível/);
    expect(() => encodeCode128('')).toThrow();
  });

  it('code128Bars cobre exatamente os módulos de barra', () => {
    const { modules } = encodeCode128(EAN);
    const totalBarras = code128Bars(EAN).reduce((t, b) => t + b.width, 0);
    expect(totalBarras).toBe([...modules].filter(m => m === '1').length);
  });
});

describe('geometria da etiqueta', () => {
  it('o módulo é 2 dots a 203 dpi = 0,2502 mm', () => {
    expect(MODULE_MM).toBeCloseTo(0.2502, 4);
  });

  it('a arte 46×38 fica centralizada na mídia 50×40', () => {
    expect(OFFSET_X_MM).toBe(2);
    expect(OFFSET_Y_MM).toBe(1);
    expect(MEDIA_WIDTH_MM).toBe(50);
    expect(MEDIA_HEIGHT_MM).toBe(40);
  });

  it('o código de 13 dígitos cabe com folga na zona de silêncio', () => {
    const fit = measureBarcode(EAN);
    expect(fit.moduleCount).toBe(123);
    expect(fit.widthMm).toBeCloseTo(30.78, 1);
    expect(fit.quietZoneMm).toBeGreaterThanOrEqual(QUIET_ZONE_MIN_MM);
    expect(fit.fits).toBe(true);
  });

  it('3 dots não caberiam — é por isso que o módulo está travado em 2', () => {
    const tresDots = 123 * (25.4 / 203) * 3;
    expect(tresDots).toBeGreaterThan(ART_WIDTH_MM);
  });

  it('barra a geração quando o código não respeita a zona de silêncio', () => {
    const longo = '1234567890'.repeat(6); // 60 dígitos
    expect(measureBarcode(longo).fits).toBe(false);
    expect(() => assertBarcodeFits(longo)).toThrow(/zona de silêncio/);
  });
});

describe('leitura do arquivo do pedido', () => {
  const CABECALHO = 'Referencia;Cor;Tamanho;Cod. Produto;Codigo Barra;Qt. Solicitada';
  const CSV = [
    CABECALHO,
    'S-039;Preto;34;12345;2260000303222;24',
    'S-039;Off White;35;12346;2260000303239;12',
    'TOTAL;;;;;36', // rodapé sem código de barras
  ].join('\r\n');

  it('lê CSV com ; e ignora linha sem código de barras', () => {
    const rows = parseOrderCsv(CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      referencia: 'S-039',
      cor: 'PRETO',
      tamanho: '34',
      codProduto: '12345',
      codigoBarra: '2260000303222',
      quantidade: 24,
    });
  });

  it('põe cor e referência em caixa alta, como a etiqueta física', () => {
    expect(parseOrderCsv(CSV)[1].cor).toBe('OFF WHITE');
  });

  it('acha as colunas mesmo com acento e ponto no cabeçalho', () => {
    const comAcento = 'Referência;Cor;Tamanho;Cód. Produto;Código Barra\n S-1;Azul;36;99;2260000303246';
    const rows = parseOrderCsv(comAcento);
    expect(rows[0].codigoBarra).toBe('2260000303246');
    expect(rows[0].codProduto).toBe('99');
  });

  it('respeita aspas duplas no campo', () => {
    const csv = 'Cor;Codigo Barra\n"PRETO; FOSCO";2260000303222';
    expect(parseOrderCsv(csv)[0].cor).toBe('PRETO; FOSCO');
  });

  it('explica o erro quando falta a coluna Codigo Barra', () => {
    expect(() => parseOrderCsv('Referencia;Cor\nS-039;Preto')).toThrow(/Codigo Barra/);
  });

  it('quantidade ausente ou inválida vira 1', () => {
    const rows = parseOrderCsv('Cor;Codigo Barra\nPRETO;2260000303222');
    expect(rows[0].quantidade).toBe(1);
  });
});

describe('decodeOrderBytes', () => {
  const bytesDe = (parts: number[]) => new Uint8Array(parts).buffer;

  it('lê UTF-16LE com BOM (o formato usual do ERP)', () => {
    const texto = 'Codigo Barra';
    const bytes = [0xff, 0xfe];
    for (const ch of texto) bytes.push(ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8);
    expect(decodeOrderBytes(bytesDe(bytes))).toBe(texto);
  });

  it('lê UTF-8 com BOM sem deixar o BOM no texto', () => {
    const utf8 = new TextEncoder().encode('Codigo Barra');
    expect(decodeOrderBytes(bytesDe([0xef, 0xbb, 0xbf, ...utf8]))).toBe('Codigo Barra');
  });

  it('cai pra CP1252 quando os bytes não são UTF-8 válido', () => {
    // 0xC7 0xC3 = "ÇÃ" em CP1252, sequência inválida em UTF-8
    expect(decodeOrderBytes(bytesDe([0xc7, 0xc3]))).toBe('ÇÃ');
  });
});

describe('expansão por quantidade', () => {
  const rows: BabyNalinRow[] = [
    { tamanho: '34', cor: 'PRETO', referencia: 'S-039', codProduto: '1', codigoBarra: EAN, quantidade: 3 },
    { tamanho: '35', cor: 'PRETO', referencia: 'S-039', codProduto: '2', codigoBarra: EAN, quantidade: 2 },
  ];

  it('sem repetição, uma etiqueta por linha', () => {
    expect(expandRows(rows, false)).toHaveLength(2);
  });

  it('com repetição, uma etiqueta por par solicitado', () => {
    expect(expandRows(rows, true)).toHaveLength(5);
  });
});

describe('fitText — texto nunca sai da arte', () => {
  /** Largura útil real da linha de texto: da coluna x=15 até a margem direita. */
  const LARGURA_UTIL = ART_WIDTH_MM - 2.0 - 15.0;

  async function novoDoc() {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: [MEDIA_WIDTH_MM, MEDIA_HEIGHT_MM], orientation: 'landscape' });
    doc.setFont('helvetica', 'normal');
    return doc;
  }

  it('mantém o corpo ideal quando o texto cabe', async () => {
    const doc = await novoDoc();
    const { pt, texto } = fitText(doc, 'TAM 34', 10, LARGURA_UTIL);
    expect(pt).toBe(10);
    expect(texto).toBe('TAM 34');
  });

  it('encolhe até caber, sem cortar', async () => {
    const doc = await novoDoc();
    const { pt, texto } = fitText(doc, 'NEW WHISKY ESCURO', 10, LARGURA_UTIL);
    expect(pt).toBeLessThan(10);
    expect(pt).toBeGreaterThanOrEqual(MIN_FONT_PT);
    expect(texto).toBe('NEW WHISKY ESCURO');
  });

  it('corta com reticências quando nem no piso cabe — em rolo, texto que vaza invade a etiqueta vizinha', async () => {
    const doc = await novoDoc();
    const longo = 'Ref: REFERENCIA BEM LONGA XYZ ABCDEFGHIJ';
    const { pt, texto } = fitText(doc, longo, 10, LARGURA_UTIL);
    expect(pt).toBe(MIN_FONT_PT);
    expect(texto.endsWith('…')).toBe(true);
    expect(texto.length).toBeLessThan(longo.length);

    doc.setFontSize(pt);
    expect(doc.getTextWidth(texto)).toBeLessThanOrEqual(LARGURA_UTIL);
  });

  it('nenhuma das três linhas ultrapassa a largura útil, por mais longa que venha', async () => {
    const doc = await novoDoc();
    const linhas = ['TAM 34', 'NEW WHISKY / OFF WHITE ESCURO METALIZADO', 'Ref: S-039-VARIANTE-LONGA-DEMAIS'];
    for (const linha of linhas) {
      const { pt, texto } = fitText(doc, linha, 10, LARGURA_UTIL);
      doc.setFontSize(pt);
      expect(doc.getTextWidth(texto), linha).toBeLessThanOrEqual(LARGURA_UTIL);
    }
  });
});

describe('pdfFilename', () => {
  it('deriva do arquivo de origem', () => {
    expect(pdfFilename('Exp_Etiquetas_PedCompra_303222.csv')).toBe('Etiquetas_Exp_Etiquetas_PedCompra_303222.pdf');
  });

  it('não quebra com nome estranho', () => {
    expect(pdfFilename('---.csv')).toBe('Etiquetas_pedido.pdf');
  });
});
