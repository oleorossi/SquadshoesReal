import {
  ART_WIDTH_MM,
  COUCHE_ART_HEIGHT_MM,
  COUCHE_COLUMN_GAP_MM,
  COUCHE_COLUMNS,
  COUCHE_LABEL_HEIGHT_MM,
  COUCHE_LABEL_WIDTH_MM,
  COUCHE_PAGE_HEIGHT_MM,
  COUCHE_PAGE_WIDTH_MM,
} from '@/lib/babyNalinLabels';
import {
  MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE,
  MAX_STANDARD_TEXT_LABELS,
  STANDARD_TEXT_LABEL_ART_HEIGHT_MM,
  STANDARD_TEXT_LABEL_ART_WIDTH_MM,
  STANDARD_TEXT_LABEL_COLUMN_GAP_MM,
  STANDARD_TEXT_LABEL_COLUMNS,
  STANDARD_TEXT_LABEL_FONT_FLOORS,
  STANDARD_TEXT_LABEL_HEIGHT_MM,
  STANDARD_TEXT_LABEL_PAGE_HEIGHT_MM,
  STANDARD_TEXT_LABEL_PAGE_WIDTH_MM,
  STANDARD_TEXT_LABEL_PRESETS,
  STANDARD_TEXT_LABEL_SAFE_INSET_MM,
  STANDARD_TEXT_LABEL_WIDTH_MM,
  buildStandardTextLabelsPdf,
  countStandardTextLabels,
  fitStandardText,
  normalizeStandardTextLabelSample,
  planStandardTextLabelPlacements,
  standardTextLabelPageCount,
  standardTextLabelsFilename,
  type StandardTextLabelSample,
} from '@/lib/standardTextLabels';

const samples: StandardTextLabelSample[] = [
  { reference: 'sp130', color: 'off white', material: 'napa soft', copies: 2 },
  { reference: 'i90', color: 'new whisky', material: 'napa floater', copies: 1 },
];

describe('standardTextLabels — contrato físico L42PRO', () => {
  it('usa exatamente a mesma mídia 2-up do menu Etiqueta de Cliente', () => {
    expect(STANDARD_TEXT_LABEL_WIDTH_MM).toBe(COUCHE_LABEL_WIDTH_MM);
    expect(STANDARD_TEXT_LABEL_HEIGHT_MM).toBe(COUCHE_LABEL_HEIGHT_MM);
    expect(STANDARD_TEXT_LABEL_COLUMNS).toBe(COUCHE_COLUMNS);
    expect(STANDARD_TEXT_LABEL_COLUMN_GAP_MM).toBe(COUCHE_COLUMN_GAP_MM);
    expect(STANDARD_TEXT_LABEL_PAGE_WIDTH_MM).toBe(COUCHE_PAGE_WIDTH_MM);
    expect(STANDARD_TEXT_LABEL_PAGE_HEIGHT_MM).toBe(COUCHE_PAGE_HEIGHT_MM);
    expect(STANDARD_TEXT_LABEL_ART_WIDTH_MM).toBe(ART_WIDTH_MM);
    expect(STANDARD_TEXT_LABEL_ART_HEIGHT_MM).toBe(COUCHE_ART_HEIGHT_MM);
    expect(STANDARD_TEXT_LABEL_SAFE_INSET_MM).toBe(1);
  });

  it('mantém os dois usos padronizados na mesma geometria física', () => {
    expect(Object.keys(STANDARD_TEXT_LABEL_PRESETS)).toEqual([
      'external_box',
      'individual_package',
    ]);
    expect(STANDARD_TEXT_LABEL_PRESETS.external_box.label).toBe('Caixa externa');
    expect(STANDARD_TEXT_LABEL_PRESETS.individual_package.label).toBe('Embalagem individual');
  });
});

describe('standardTextLabels — amostras e imposição', () => {
  it('normaliza campos para leitura térmica e usa uma cópia por padrão', () => {
    expect(normalizeStandardTextLabelSample({
      reference: '  sp  130 ',
      color: ' off white ',
      material: ' napa  soft ',
    })).toEqual({
      reference: 'SP 130',
      color: 'OFF WHITE',
      material: 'NAPA SOFT',
      copies: 1,
    });
  });

  it('distribui cópias da esquerda para a direita e deixa a última direita vazia', () => {
    const placements = planStandardTextLabelPlacements(samples);
    expect(placements).toHaveLength(3);
    expect(placements.map(({ pageIndex, column, sampleIndex, copyIndex }) => ({
      pageIndex,
      column,
      sampleIndex,
      copyIndex,
    }))).toEqual([
      { pageIndex: 0, column: 0, sampleIndex: 0, copyIndex: 0 },
      { pageIndex: 0, column: 1, sampleIndex: 0, copyIndex: 1 },
      { pageIndex: 1, column: 0, sampleIndex: 1, copyIndex: 0 },
    ]);
    expect(placements[0]).toMatchObject({ labelXMm: 0, artXMm: 1, artYMm: 1 });
    expect(placements[1]).toMatchObject({ labelXMm: 56, artXMm: 57, artYMm: 1 });
    expect(standardTextLabelPageCount(placements.length)).toBe(2);
  });

  it('rejeita campos obrigatórios vazios e cópias ambíguas', () => {
    expect(() => normalizeStandardTextLabelSample({ reference: ' ', color: 'preto', material: 'napa' }))
      .toThrow('informe a referência');
    expect(() => normalizeStandardTextLabelSample({ reference: 'SP1', color: '', material: 'napa' }))
      .toThrow('informe a cor');
    expect(() => normalizeStandardTextLabelSample({ reference: 'SP1', color: 'preto', material: '' }))
      .toThrow('informe o material');
    expect(() => normalizeStandardTextLabelSample({ reference: 'SP1', color: 'preto', material: 'napa', copies: 1.5 }))
      .toThrow('quantidade inteira');
    expect(() => normalizeStandardTextLabelSample({ reference: 'SP1', color: 'preto', material: 'napa', copies: 0 }))
      .toThrow('maior que zero');
  });

  it('impõe limite por amostra e por PDF antes de alocar as páginas', () => {
    const base = { reference: 'SP1', color: 'preto', material: 'napa' };
    expect(() => countStandardTextLabels([{
      ...base,
      copies: MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE + 1,
    }])).toThrow('limite seguro');

    const tooMany = Array.from(
      { length: Math.floor(MAX_STANDARD_TEXT_LABELS / MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE) + 1 },
      (_, index) => ({ ...base, reference: `SP${index}`, copies: MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE }),
    );
    expect(() => planStandardTextLabelPlacements(tooMany)).toThrow(
      MAX_STANDARD_TEXT_LABELS.toLocaleString('pt-BR'),
    );
  });
});

describe('standardTextLabels — tipografia e PDF', () => {
  it('mantém o corpo ideal quando cabe e corta no piso quando não cabe', async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: [106, 30], orientation: 'landscape' });

    const short = fitStandardText(doc, 'SP130', {
      maxWidthMm: 46.4,
      idealFontPt: 16,
      minFontPt: STANDARD_TEXT_LABEL_FONT_FLOORS.referencePt,
      fontStyle: 'bold',
    });
    expect(short).toEqual({ text: 'SP130', fontSizePt: 16, truncated: false });

    const long = fitStandardText(
      doc,
      'MATERIAL · NAPA EXTREMAMENTE LONGA COM ACABAMENTO ESPECIAL METALIZADO',
      {
        maxWidthMm: 20,
        idealFontPt: 10,
        minFontPt: STANDARD_TEXT_LABEL_FONT_FLOORS.detailPt,
      },
    );
    expect(long.fontSizePt).toBe(STANDARD_TEXT_LABEL_FONT_FLOORS.detailPt);
    expect(long.truncated).toBe(true);
    expect(long.text.endsWith('…')).toBe(true);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(long.fontSizePt);
    expect(doc.getTextWidth(long.text)).toBeLessThanOrEqual(20);
  });

  it.each(['external_box', 'individual_package'] as const)(
    'gera %s em páginas 106 × 30 mm, duas etiquetas por carreira',
    async preset => {
      const doc = await buildStandardTextLabelsPdf(samples, preset);
      expect(doc.getNumberOfPages()).toBe(2);
      for (let pageNumber = 1; pageNumber <= doc.getNumberOfPages(); pageNumber++) {
        const mediaBox = doc.getPageInfo(pageNumber).pageContext.mediaBox;
        const widthMm = (mediaBox.topRightX - mediaBox.bottomLeftX) * 25.4 / 72;
        const heightMm = (mediaBox.topRightY - mediaBox.bottomLeftY) * 25.4 / 72;
        expect(widthMm).toBeCloseTo(106, 1);
        expect(heightMm).toBeCloseTo(30, 1);
      }
      expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1_000);
    },
  );

  it('recusa PDF vazio e nomeia cada finalidade sem caracteres frágeis', async () => {
    await expect(buildStandardTextLabelsPdf([], 'external_box')).rejects.toThrow('Nada para gerar');
    const date = new Date(2026, 7, 26, 12);
    expect(standardTextLabelsFilename('external_box', date))
      .toBe('etiquetas-caixa-externa-20260826.pdf');
    expect(standardTextLabelsFilename('individual_package', date))
      .toBe('etiquetas-embalagem-individual-20260826.pdf');
  });
});
