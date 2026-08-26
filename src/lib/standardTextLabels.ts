/**
 * Etiquetas de texto padronizadas para a L42PRO.
 *
 * Os dois usos (caixa externa e embalagem individual) compartilham exatamente
 * a mesma mídia do menu Etiqueta de Cliente: duas etiquetas físicas de
 * 50 × 30 mm, com vão de 6 mm, em uma carreira de 106 × 30 mm. A única
 * alternância permitida é a organização tipográfica de referência, cor e
 * material — a geometria física nunca muda.
 */

export const STANDARD_TEXT_LABEL_WIDTH_MM = 50;
export const STANDARD_TEXT_LABEL_HEIGHT_MM = 30;
export const STANDARD_TEXT_LABEL_COLUMNS = 2;
export const STANDARD_TEXT_LABEL_COLUMN_GAP_MM = 6;
export const STANDARD_TEXT_LABEL_PAGE_WIDTH_MM = 106;
export const STANDARD_TEXT_LABEL_PAGE_HEIGHT_MM = 30;
export const STANDARD_TEXT_LABEL_ART_WIDTH_MM = 48;
export const STANDARD_TEXT_LABEL_ART_HEIGHT_MM = 28;
export const STANDARD_TEXT_LABEL_SAFE_INSET_MM = 1;

export const STANDARD_TEXT_LABEL_GEOMETRY = Object.freeze({
  labelWidthMm: STANDARD_TEXT_LABEL_WIDTH_MM,
  labelHeightMm: STANDARD_TEXT_LABEL_HEIGHT_MM,
  columns: STANDARD_TEXT_LABEL_COLUMNS,
  columnGapMm: STANDARD_TEXT_LABEL_COLUMN_GAP_MM,
  pageWidthMm: STANDARD_TEXT_LABEL_PAGE_WIDTH_MM,
  pageHeightMm: STANDARD_TEXT_LABEL_PAGE_HEIGHT_MM,
  artWidthMm: STANDARD_TEXT_LABEL_ART_WIDTH_MM,
  artHeightMm: STANDARD_TEXT_LABEL_ART_HEIGHT_MM,
  safeInsetMm: STANDARD_TEXT_LABEL_SAFE_INSET_MM,
});

/** Tiragem máxima por arquivo: evita congelar o navegador com milhares de páginas. */
export const MAX_STANDARD_TEXT_LABELS = 20_000;
/** Limite por amostra: quantidade acima disso normalmente indica erro de digitação. */
export const MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE = 1_000;

/** Pisos de leitura; texto excedente é cortado antes de reduzir abaixo deles. */
export const STANDARD_TEXT_LABEL_FONT_FLOORS = Object.freeze({
  referencePt: 10,
  detailPt: 7,
  microPt: 6,
});

export type StandardTextLabelPreset = 'external_box' | 'individual_package';

export interface StandardTextLabelSample {
  reference: string;
  color: string;
  material: string;
  copies?: number;
}

export interface NormalizedStandardTextLabelSample {
  reference: string;
  color: string;
  material: string;
  copies: number;
}

export interface StandardTextLabelPlacement {
  pageIndex: number;
  column: 0 | 1;
  sampleIndex: number;
  copyIndex: number;
  /** Origem da etiqueta física dentro da carreira. */
  labelXMm: number;
  labelYMm: number;
  /** Origem da arte segura 48 × 28 mm. */
  artXMm: number;
  artYMm: number;
  sample: NormalizedStandardTextLabelSample;
}

export interface StandardTextFit {
  text: string;
  fontSizePt: number;
  truncated: boolean;
}

export interface StandardTextFitOptions {
  maxWidthMm: number;
  idealFontPt: number;
  minFontPt: number;
  fontStyle?: 'normal' | 'bold';
}

export const STANDARD_TEXT_LABEL_PRESETS: Readonly<Record<StandardTextLabelPreset, {
  label: string;
  description: string;
  filenameSlug: string;
}>> = Object.freeze({
  external_box: {
    label: 'Caixa externa',
    description: 'Leitura por linhas para identificação rápida da caixa.',
    filenameSlug: 'caixa-externa',
  },
  individual_package: {
    label: 'Embalagem individual',
    description: 'Composição centralizada para leitura no produto embalado.',
    filenameSlug: 'embalagem-individual',
  },
});

type PdfDoc = import('jspdf').jsPDF;

function compactText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function printableText(value: unknown): string {
  return compactText(value).toLocaleUpperCase('pt-BR');
}

function normalizeCopies(value: number | undefined, sampleIndex: number): number {
  const copies = value === undefined ? 1 : Number(value);
  if (!Number.isFinite(copies) || !Number.isInteger(copies) || copies < 1) {
    throw new Error(`Amostra ${sampleIndex + 1}: informe uma quantidade inteira maior que zero.`);
  }
  if (copies > MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE) {
    throw new Error(
      `Amostra ${sampleIndex + 1}: o limite seguro é ${MAX_STANDARD_TEXT_LABEL_COPIES_PER_SAMPLE.toLocaleString('pt-BR')} cópias.`,
    );
  }
  return copies;
}

export function normalizeStandardTextLabelSample(
  sample: StandardTextLabelSample,
  sampleIndex = 0,
): NormalizedStandardTextLabelSample {
  const reference = printableText(sample?.reference);
  const color = printableText(sample?.color);
  const material = printableText(sample?.material);

  if (!reference) throw new Error(`Amostra ${sampleIndex + 1}: informe a referência.`);
  if (!color) throw new Error(`Amostra ${sampleIndex + 1}: informe a cor.`);
  if (!material) throw new Error(`Amostra ${sampleIndex + 1}: informe o material.`);

  return {
    reference,
    color,
    material,
    copies: normalizeCopies(sample.copies, sampleIndex),
  };
}

export function countStandardTextLabels(samples: StandardTextLabelSample[]): number {
  let total = 0;
  samples.forEach((sample, sampleIndex) => {
    total += normalizeStandardTextLabelSample(sample, sampleIndex).copies;
    if (total > MAX_STANDARD_TEXT_LABELS) {
      throw new Error(
        `A geração teria ${total.toLocaleString('pt-BR')} etiquetas. `
        + `O limite seguro é ${MAX_STANDARD_TEXT_LABELS.toLocaleString('pt-BR')} por PDF.`,
      );
    }
  });
  return total;
}

export function standardTextLabelPageCount(labelCount: number): number {
  const safeCount = Number.isFinite(labelCount) ? Math.max(0, Math.trunc(labelCount)) : 0;
  return Math.ceil(safeCount / STANDARD_TEXT_LABEL_COLUMNS);
}

/**
 * Planeja a imposição sem importar jsPDF nem acessar DOM: esquerda, direita e
 * próxima carreira. Uma tiragem ímpar deixa a coluna direita final em branco.
 */
export function planStandardTextLabelPlacements(
  samples: StandardTextLabelSample[],
): StandardTextLabelPlacement[] {
  countStandardTextLabels(samples);
  const normalized = samples.map(normalizeStandardTextLabelSample);
  const placements: StandardTextLabelPlacement[] = [];

  normalized.forEach((sample, sampleIndex) => {
    for (let copyIndex = 0; copyIndex < sample.copies; copyIndex++) {
      const outputIndex = placements.length;
      const column = (outputIndex % STANDARD_TEXT_LABEL_COLUMNS) as 0 | 1;
      const labelXMm = column * (STANDARD_TEXT_LABEL_WIDTH_MM + STANDARD_TEXT_LABEL_COLUMN_GAP_MM);
      placements.push({
        pageIndex: Math.floor(outputIndex / STANDARD_TEXT_LABEL_COLUMNS),
        column,
        sampleIndex,
        copyIndex,
        labelXMm,
        labelYMm: 0,
        artXMm: labelXMm + STANDARD_TEXT_LABEL_SAFE_INSET_MM,
        artYMm: STANDARD_TEXT_LABEL_SAFE_INSET_MM,
        sample,
      });
    }
  });

  return placements;
}

/**
 * Usa o maior corpo que couber. Se nem o piso couber, preserva o piso e corta
 * o excedente com reticências para nunca invadir a etiqueta vizinha.
 */
export function fitStandardText(
  doc: PdfDoc,
  value: string,
  options: StandardTextFitOptions,
): StandardTextFit {
  const text = compactText(value);
  const fontStyle = options.fontStyle ?? 'normal';
  const idealFontPt = Number(options.idealFontPt);
  const minFontPt = Number(options.minFontPt);
  const maxWidthMm = Number(options.maxWidthMm);

  if (!Number.isFinite(maxWidthMm) || maxWidthMm <= 0) {
    throw new Error('A largura disponível para o texto deve ser maior que zero.');
  }
  if (!Number.isFinite(idealFontPt) || !Number.isFinite(minFontPt) || minFontPt <= 0 || idealFontPt < minFontPt) {
    throw new Error('Os tamanhos de fonte da etiqueta são inválidos.');
  }

  doc.setFont('helvetica', fontStyle);
  for (let pt = idealFontPt; pt >= minFontPt - 0.001; pt -= 0.25) {
    const roundedPt = Math.max(minFontPt, Math.round(pt * 100) / 100);
    doc.setFontSize(roundedPt);
    if (doc.getTextWidth(text) <= maxWidthMm) {
      return { text, fontSizePt: roundedPt, truncated: false };
    }
  }

  doc.setFontSize(minFontPt);
  const glyphs = Array.from(text);
  for (let length = glyphs.length; length >= 0; length--) {
    const prefix = glyphs.slice(0, length).join('').trimEnd();
    const candidate = `${prefix}…`;
    if (doc.getTextWidth(candidate) <= maxWidthMm) {
      return { text: candidate, fontSizePt: minFontPt, truncated: true };
    }
  }

  return { text: '', fontSizePt: minFontPt, truncated: true };
}

interface DrawLineOptions extends StandardTextFitOptions {
  xMm: number;
  yMm: number;
  align?: 'left' | 'center' | 'right';
}

function drawFittedLine(doc: PdfDoc, value: string, options: DrawLineOptions): StandardTextFit {
  const fit = fitStandardText(doc, value, options);
  doc.setTextColor(0, 0, 0);
  const align = options.align ?? 'left';
  const xMm = align === 'center'
    ? options.xMm + options.maxWidthMm / 2
    : align === 'right'
      ? options.xMm + options.maxWidthMm
      : options.xMm;
  if (fit.text) {
    doc.text(fit.text, xMm, options.yMm, { align, baseline: 'top' });
  }
  return fit;
}

function drawExternalBoxLabel(doc: PdfDoc, placement: StandardTextLabelPlacement): void {
  const x = placement.artXMm + 0.8;
  const y = placement.artYMm;
  const width = STANDARD_TEXT_LABEL_ART_WIDTH_MM - 1.6;
  const { sample } = placement;

  drawFittedLine(doc, 'CAIXA EXTERNA · REFERÊNCIA', {
    xMm: x,
    yMm: y + 0.6,
    maxWidthMm: width,
    idealFontPt: 6,
    minFontPt: STANDARD_TEXT_LABEL_FONT_FLOORS.microPt,
    fontStyle: 'bold',
  });
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.25);
  doc.line(x, y + 4.4, x + width, y + 4.4);

  drawFittedLine(doc, sample.reference, {
    xMm: x,
    yMm: y + 5.5,
    maxWidthMm: width,
    idealFontPt: 16,
    minFontPt: STANDARD_TEXT_LABEL_FONT_FLOORS.referencePt,
    fontStyle: 'bold',
  });
  doc.setLineWidth(0.15);
  doc.line(x, y + 12.5, x + width, y + 12.5);

  drawFittedLine(doc, `COR · ${sample.color}`, {
    xMm: x,
    yMm: y + 13.6,
    maxWidthMm: width,
    idealFontPt: 10.5,
    minFontPt: STANDARD_TEXT_LABEL_FONT_FLOORS.detailPt,
    fontStyle: 'bold',
  });
  doc.line(x, y + 19.1, x + width, y + 19.1);

  drawFittedLine(doc, `MATERIAL · ${sample.material}`, {
    xMm: x,
    yMm: y + 20.2,
    maxWidthMm: width,
    idealFontPt: 10,
    minFontPt: STANDARD_TEXT_LABEL_FONT_FLOORS.detailPt,
    fontStyle: 'normal',
  });
}

function drawIndividualPackageLabel(doc: PdfDoc, placement: StandardTextLabelPlacement): void {
  const x = placement.artXMm + 0.8;
  const y = placement.artYMm;
  const width = STANDARD_TEXT_LABEL_ART_WIDTH_MM - 1.6;
  const { sample } = placement;

  drawFittedLine(doc, 'EMBALAGEM INDIVIDUAL', {
    xMm: x,
    yMm: y + 0.6,
    maxWidthMm: width,
    idealFontPt: 6,
    minFontPt: STANDARD_TEXT_LABEL_FONT_FLOORS.microPt,
    fontStyle: 'bold',
    align: 'center',
  });
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.25);
  doc.line(x + 5, y + 4.4, x + width - 5, y + 4.4);

  drawFittedLine(doc, `REF. ${sample.reference}`, {
    xMm: x,
    yMm: y + 5.7,
    maxWidthMm: width,
    idealFontPt: 15.5,
    minFontPt: STANDARD_TEXT_LABEL_FONT_FLOORS.referencePt,
    fontStyle: 'bold',
    align: 'center',
  });
  drawFittedLine(doc, `COR · ${sample.color}`, {
    xMm: x,
    yMm: y + 13.7,
    maxWidthMm: width,
    idealFontPt: 10.5,
    minFontPt: STANDARD_TEXT_LABEL_FONT_FLOORS.detailPt,
    fontStyle: 'bold',
    align: 'center',
  });
  drawFittedLine(doc, `MATERIAL · ${sample.material}`, {
    xMm: x,
    yMm: y + 20.2,
    maxWidthMm: width,
    idealFontPt: 9.5,
    minFontPt: STANDARD_TEXT_LABEL_FONT_FLOORS.detailPt,
    fontStyle: 'normal',
    align: 'center',
  });
}

function assertPreset(preset: StandardTextLabelPreset): void {
  if (!Object.prototype.hasOwnProperty.call(STANDARD_TEXT_LABEL_PRESETS, preset)) {
    throw new Error('Modelo de etiqueta padronizada inválido.');
  }
}

/**
 * Monta um PDF vetorial pronto para a L42PRO. O retorno é um jsPDF para que a
 * camada de UI escolha entre salvar, abrir ou transformar em Blob.
 */
export async function buildStandardTextLabelsPdf(
  samples: StandardTextLabelSample[],
  preset: StandardTextLabelPreset = 'individual_package',
): Promise<PdfDoc> {
  assertPreset(preset);
  if (samples.length === 0) throw new Error('Nada para gerar: adicione pelo menos uma amostra.');

  const placements = planStandardTextLabelPlacements(samples);
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    unit: 'mm',
    format: [STANDARD_TEXT_LABEL_PAGE_WIDTH_MM, STANDARD_TEXT_LABEL_PAGE_HEIGHT_MM],
    orientation: 'landscape',
    compress: true,
  });
  const presetInfo = STANDARD_TEXT_LABEL_PRESETS[preset];
  doc.setProperties({
    title: `Etiquetas L42PRO · ${presetInfo.label} · 2 × 50 × 30 mm`,
    subject: 'Etiquetas padronizadas de referência, cor e material',
    creator: 'Squad Shoes',
  });

  placements.forEach(placement => {
    if (placement.pageIndex > 0 && placement.column === 0) {
      doc.addPage(
        [STANDARD_TEXT_LABEL_PAGE_WIDTH_MM, STANDARD_TEXT_LABEL_PAGE_HEIGHT_MM],
        'landscape',
      );
    }
    if (preset === 'external_box') drawExternalBoxLabel(doc, placement);
    else drawIndividualPackageLabel(doc, placement);
  });

  return doc;
}

export function standardTextLabelsFilename(
  preset: StandardTextLabelPreset,
  date = new Date(),
): string {
  assertPreset(preset);
  if (Number.isNaN(date.getTime())) throw new Error('Data inválida para o nome do arquivo.');
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');
  return `etiquetas-${STANDARD_TEXT_LABEL_PRESETS[preset].filenameSlug}-${stamp}.pdf`;
}
