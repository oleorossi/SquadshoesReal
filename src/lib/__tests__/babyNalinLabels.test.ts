import { describe, it, expect } from 'vitest';
import { CODE128_PATTERNS, code128Bars, encodeCode128 } from '@/lib/code128';
import {
  ART_WIDTH_MM,
  BARCODE_FORMAT,
  COUCHE_ART_HEIGHT_MM,
  COUCHE_BARCODE_TOP_Y_MM,
  COUCHE_COLUMN_GAP_MM,
  COUCHE_LABEL_HEIGHT_MM,
  COUCHE_LABEL_WIDTH_MM,
  COUCHE_OFFSET_X_MM,
  COUCHE_OFFSET_Y_MM,
  COUCHE_PAGE_HEIGHT_MM,
  COUCHE_PAGE_WIDTH_MM,
  LAYOUT,
  MEDIA_HEIGHT_MM,
  MEDIA_WIDTH_MM,
  MIN_FONT_PT,
  MODULE_MM,
  OFFSET_X_MM,
  OFFSET_Y_MM,
  QUIET_ZONE_MIN_MM,
  analyzeClientSkus,
  assertBarcodeFits,
  buildBabyNalinPdf,
  clientSkuKey,
  decodeOrderBytes,
  expandRows,
  fitText,
  graphicPageCount,
  graphicPdfFilename,
  measureBarcode,
  parseOrderCsv,
  planGraphicLabelPlacements,
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
  it('mantém CODE128 como formato obrigatório do cliente', () => {
    expect(BARCODE_FORMAT).toBe('CODE128');
  });

  it('segue o módulo de 0,296 mm do padrão do cliente', () => {
    expect(MODULE_MM).toBeCloseTo(0.296, 4);
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
    expect(fit.widthMm).toBeCloseTo(36.41, 1);
    expect(fit.quietZoneMm).toBeGreaterThanOrEqual(QUIET_ZONE_MIN_MM);
    expect(fit.fits).toBe(true);
  });

  it('preserva zona de silêncio de pelo menos 3,1 mm em cada lado', () => {
    const fit = measureBarcode(EAN);
    expect(fit.quietZoneMm).toBeGreaterThanOrEqual(3.1);
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

  it('aplica o multiplicador de etiquetas por par', () => {
    expect(expandRows(rows, true, 2)).toHaveLength(10);
    expect(expandRows(rows, true, 0)).toHaveLength(5);
  });
});

describe('arquivo para gráfica por SKU', () => {
  const rows: BabyNalinRow[] = [
    { tamanho: '34', cor: 'PRETO', referencia: 'NL02', codProduto: '905301', codigoBarra: '2260000303222', quantidade: 144 },
    { tamanho: '34', cor: ' preto ', referencia: 'nl02', codProduto: '905301', codigoBarra: '2260000303222', quantidade: 288 },
    { tamanho: '35', cor: 'PRETO', referencia: 'NL02', codProduto: '905301', codigoBarra: '2260000303239', quantidade: 288 },
    { tamanho: '36', cor: 'PRETO', referencia: 'NL02', codProduto: '905301', codigoBarra: '2260000303246', quantidade: 432 },
  ];

  it('mantém uma arte por referência, cor e tamanho, na ordem do arquivo', () => {
    const analysis = analyzeClientSkus(rows);
    expect(analysis.conflicts).toHaveLength(0);
    expect(analysis.rows).toHaveLength(3);
    expect(analysis.rows.map(row => row.tamanho)).toEqual(['34', '35', '36']);
  });

  it('normaliza a identidade do SKU sem esconder conflito de código de barras', () => {
    expect(clientSkuKey(rows[0])).toBe(clientSkuKey(rows[1]));
    expect(clientSkuKey(rows[0])).not.toBe(clientSkuKey(rows[2]));
  });

  it('detecta código de barras conflitante no mesmo SKU', () => {
    const conflitantes = [
      rows[0],
      { ...rows[0], codigoBarra: '2260000303291' },
    ];
    const analysis = analyzeClientSkus(conflitantes);
    expect(analysis.conflicts).toHaveLength(1);
    expect(analysis.conflicts[0].codigosBarra).toEqual(['2260000303222', '2260000303291']);
    expect(() => planGraphicLabelPlacements(conflitantes)).toThrow(/mais de um código de barras/);
  });

  it('impõe duas etiquetas couchê 50×30 lado a lado e avança a carreira quando fica cheia', () => {
    const placements = planGraphicLabelPlacements(rows);

    expect(placements.map(({ pageIndex, column, xMm, yMm, row }) => ({
      pageIndex,
      column,
      xMm,
      yMm,
      tamanho: row.tamanho,
    }))).toEqual([
      { pageIndex: 0, column: 0, xMm: COUCHE_OFFSET_X_MM, yMm: COUCHE_OFFSET_Y_MM, tamanho: '34' },
      {
        pageIndex: 0,
        column: 1,
        xMm: COUCHE_LABEL_WIDTH_MM + COUCHE_COLUMN_GAP_MM + COUCHE_OFFSET_X_MM,
        yMm: COUCHE_OFFSET_Y_MM,
        tamanho: '35',
      },
      { pageIndex: 1, column: 0, xMm: COUCHE_OFFSET_X_MM, yMm: COUCHE_OFFSET_Y_MM, tamanho: '36' },
    ]);
    expect(graphicPageCount(placements.length)).toBe(2);
  });

  it('mantém toda a arte dentro de cada etiqueta física 50×30', () => {
    expect(COUCHE_OFFSET_X_MM + ART_WIDTH_MM).toBeLessThanOrEqual(COUCHE_LABEL_WIDTH_MM);
    expect(COUCHE_OFFSET_Y_MM + COUCHE_ART_HEIGHT_MM).toBeLessThanOrEqual(COUCHE_LABEL_HEIGHT_MM);
    expect(COUCHE_OFFSET_Y_MM + COUCHE_BARCODE_TOP_Y_MM + LAYOUT.barcode.heightMm)
      .toBeLessThanOrEqual(COUCHE_LABEL_HEIGHT_MM);
  });

  it('gera PDF 2-up no passo do rolo, ignorando quantidade e multiplicador', async () => {
    const doc = await buildBabyNalinPdf(rows, { mode: 'graphic', repeatByQuantity: true, repeatMultiplier: 10 });
    expect(doc.getNumberOfPages()).toBe(2);
    for (let pageNumber = 1; pageNumber <= doc.getNumberOfPages(); pageNumber++) {
      const mediaBox = doc.getPageInfo(pageNumber).pageContext.mediaBox;
      const widthMm = (mediaBox.topRightX - mediaBox.bottomLeftX) * 25.4 / 72;
      const heightMm = (mediaBox.topRightY - mediaBox.bottomLeftY) * 25.4 / 72;
      expect(widthMm).toBeCloseTo(COUCHE_PAGE_WIDTH_MM, 1);
      expect(heightMm).toBeCloseTo(COUCHE_PAGE_HEIGHT_MM, 1);
    }
  });

  it('preserva o PDF de produção 50×40 com quantidade vezes multiplicador', async () => {
    const pequenas = rows.map((row, index) => ({ ...row, quantidade: index + 1 }));
    const doc = await buildBabyNalinPdf(pequenas, { mode: 'production', repeatByQuantity: true, repeatMultiplier: 2 });
    expect(doc.getNumberOfPages()).toBe((1 + 2 + 3 + 4) * 2);
    const page = doc.internal.pageSize;
    expect(page.getWidth()).toBeCloseTo(MEDIA_WIDTH_MM, 1);
    expect(page.getHeight()).toBeCloseTo(MEDIA_HEIGHT_MM, 1);
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

  it('nomeia separadamente o arquivo para a gráfica', () => {
    expect(graphicPdfFilename('Exp_Etiquetas_PedCompra_303222.xlsx'))
      .toBe('Artes_SKU_Exp_Etiquetas_PedCompra_303222.pdf');
  });
});
