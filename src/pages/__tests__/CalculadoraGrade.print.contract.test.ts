import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(__dirname, '../CalculadoraGrade.tsx'), 'utf8');

describe('CalculadoraGrade — contrato de impressão', () => {
  it('entrega a folha pelo fluxo oficial e escolhe retrato no celular', () => {
    expect(page).toContain("from '@/lib/htmlPrintDelivery'");
    expect(page).toContain('deliverHtmlDocument');
    expect(page).toContain('gradePrintDeliveryOptions');
    expect(page).toContain('buildGradePrintHtml');
    expect(page).toContain('isGradePrintPhoneLayout');
    expect(page).toContain("isGradePrintPhoneLayout() ? 'phone' : 'sheet'");
    expect(page).not.toMatch(/window\.open\s*\(/);
  });

  it('deixa o botão Imprimir visível no celular, fora do menu', () => {
    expect(page).toContain('Imprimir quantidade a cortar');
    expect(page).toContain('flex w-full min-w-0 items-center gap-2 md:hidden');
    expect(page).toContain('className="h-11 min-h-11 flex-1"');
  });
});
