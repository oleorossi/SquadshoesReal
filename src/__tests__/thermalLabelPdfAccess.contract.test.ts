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
  it('expõe botão PDF na Central (não só ZPL)', () => {
    expect(productionTab).toContain("handlePrintIndividual('pdf')");
    expect(productionTab).toContain('buildThermalLabelsPdf');
    expect(productionTab).toContain('openOrDownloadThermalLabelPdf');
    expect(productionTab).toMatch(/PDF \(/);
    expect(productionTab).toContain('Abre no PC · imprime pelo driver');
    expect(productionTab).toContain('Só p/ Elgin · não abre no Windows');
  });

  it('na prévia ZPL oferece Abrir PDF e explica que .zpl não abre no Windows', () => {
    expect(zplDialog).toContain('Abrir PDF');
    expect(zplDialog).toContain('pdfSourceLabels');
    expect(zplDialog).toContain('buildThermalLabelsPdf');
    expect(zplDialog).toContain('não abre em leitor comum');
    expect(zplDialog).toContain('setCanvasNode');
  });
});
