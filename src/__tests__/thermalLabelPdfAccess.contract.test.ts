import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const productionTab = readFileSync(
  resolve(ROOT, 'components/label-system/LabelProductionTab.tsx'),
  'utf8',
);
const zplDialog = readFileSync(
  resolve(ROOT, 'components/label-system/ZplPreviewDialog.tsx'),
  'utf8',
);

describe('etiqueta individual — PDF abrível no Windows', () => {
  it('Etiqueta Individual gera PDF no cliente (não passa pelo /api/render-pdf)', () => {
    expect(productionTab).toContain("handlePrintIndividual('pdf')");
    expect(productionTab).toContain('buildThermalLabelsPdf');
    expect(productionTab).toContain('openOrDownloadThermalLabelPdf');
    // O botão principal NÃO usa o caminho HTML→servidor (estoura Storage em lote grande).
    expect(productionTab).not.toMatch(/handlePrintIndividual\('html'\)/);
    expect(productionTab).toContain('PDF no navegador · sem fila do servidor');
    expect(productionTab).toContain('Só p/ Elgin · não abre no Windows');
  });

  it('checklist L42PRO é obrigatório antes do PDF (Produção e prévia ZPL)', () => {
    expect(productionTab).toContain('ThermalPdfPrintGuideDialog');
    expect(productionTab).toContain('setThermalPdfGuideOpen(true)');
    expect(productionTab).toContain("handlePrintIndividual('pdf')");
    expect(zplDialog).toContain('ThermalPdfPrintGuideDialog');
    expect(zplDialog).toContain('setPdfGuideOpen(true)');
  });

  it('na prévia ZPL oferece Abrir PDF e explica que .zpl não abre no Windows', () => {
    expect(zplDialog).toContain('Abrir PDF');
    expect(zplDialog).toContain('pdfSourceLabels');
    expect(zplDialog).toContain('buildThermalLabelsPdf');
    expect(zplDialog).not.toContain('openPreview');
    expect(zplDialog).toContain('não abre em leitor comum');
    expect(zplDialog).toContain('setCanvasNode');
  });

  it('PDF, HTML e ZPL leem o deslocamento de 3 mm da mesma constante', () => {
    const printLabels = readFileSync(resolve(ROOT, 'lib/printLabels.ts'), 'utf8');
    expect(printLabels).toContain('THERMAL_ART_OFFSET_X_MM = 3');
    expect(printLabels).toContain('thermalHorizontalPads(safePadX)');
    expect(printLabels).toContain('thermalHorizontalPads(1.5)');
    expect(zplDialog).toContain('L.barcodeW');
    expect(zplDialog).not.toContain('L.W - L.padX - L.barcodeX');
  });
});

