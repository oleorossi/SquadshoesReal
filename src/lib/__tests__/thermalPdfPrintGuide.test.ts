import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  THERMAL_PDF_PRINT_GUIDE_CONFIRM_LABEL,
  THERMAL_PDF_PRINT_GUIDE_STEPS,
  THERMAL_PDF_PRINT_GUIDE_TITLE,
  buildThermalPdfPrintGuideMarkdown,
} from '@/lib/thermalPdfPrintGuide';
import {
  THERMAL_LABEL_HEIGHT_MM,
  THERMAL_LABEL_WIDTH_MM,
} from '@/lib/printLabels';

describe('thermalPdfPrintGuide', () => {
  it('trava mídia 100×30 e os 4 passos do checklist', () => {
    expect(THERMAL_LABEL_WIDTH_MM).toBe(100);
    expect(THERMAL_LABEL_HEIGHT_MM).toBe(30);
    expect(THERMAL_PDF_PRINT_GUIDE_STEPS).toHaveLength(4);
    expect(THERMAL_PDF_PRINT_GUIDE_TITLE).toMatch(/L42PRO/i);
    expect(THERMAL_PDF_PRINT_GUIDE_CONFIRM_LABEL).toMatch(/abrir PDF/i);

    const bodies = THERMAL_PDF_PRINT_GUIDE_STEPS.map(s => `${s.title} ${s.body}`).join('\n');
    expect(bodies).toMatch(/100/);
    expect(bodies).toMatch(/30/);
    expect(bodies).toMatch(/106/);
    expect(bodies).toMatch(/100%/);
    expect(bodies).toMatch(/Mac/i);
  });

  it('markdown do guia e o docs/ batem nos pontos load-bearing', () => {
    const md = buildThermalPdfPrintGuideMarkdown();
    const doc = readFileSync(
      resolve(__dirname, '../../../docs/ETIQUETA_INDIVIDUAL_PDF_L42PRO.md'),
      'utf8',
    );
    for (const needle of [
      '100 × 30',
      '106 × 30',
      'escala 100%',
      'Ajustar à página',
      'Mac só gera o PDF',
    ]) {
      expect(md).toContain(needle);
      expect(doc).toContain(needle);
    }
  });
});
