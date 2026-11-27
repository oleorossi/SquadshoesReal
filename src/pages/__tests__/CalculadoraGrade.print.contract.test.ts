import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(__dirname, '../CalculadoraGrade.tsx'), 'utf8');

describe('CalculadoraGrade — contrato de impressão', () => {
  it('entrega a folha horizontal em paisagem pelo fluxo oficial, inclusive no iPhone', () => {
    expect(page).toContain("from '@/lib/htmlPrintDelivery'");
    expect(page).toContain('deliverHtmlDocument');
    expect(page).toContain('gradePrintDeliveryOptions');
    expect(page).toContain('buildGradePrintHtml');
    expect(page).not.toMatch(/window\.open\s*\(/);
  });
});
