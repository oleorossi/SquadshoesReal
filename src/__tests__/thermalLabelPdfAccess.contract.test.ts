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

  it('na prévia ZPL oferece Abrir PDF e explica que .zpl não abre no Windows', () => {
    expect(zplDialog).toContain('Abrir PDF');
    expect(zplDialog).toContain('pdfSourceLabels');
    expect(zplDialog).toContain('buildThermalLabelsPdf');
    expect(zplDialog).toContain('openPreview: true');
    expect(zplDialog).toContain('não abre em leitor comum');
    expect(zplDialog).toContain('setCanvasNode');
  });
});

