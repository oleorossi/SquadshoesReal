import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const page = readFileSync(
  resolve(__dirname, '../pages/PurchasePlanning.tsx'),
  'utf8',
);

describe('PurchasePlanning hub — entrada projeção (spec semanal integrada)', () => {
  it('navegação principal só tem projecao, cronograma e saldo-analytics', () => {
    expect(page).toContain("value: 'projecao'");
    expect(page).toContain("value: 'cronograma'");
    expect(page).toContain("value: 'saldo-analytics'");
    expect(page).not.toMatch(/value: 'plano'/);
    expect(page).not.toMatch(/value: 'projecoes'/);
    expect(page).not.toMatch(/value: 'mrp'/);
  });

  it('default e legados de plano/projecoes/mrp redirecionam para projecao', () => {
    expect(page).toContain("LEGACY_TO_PROJECAO");
    expect(page).toContain("'plano'");
    expect(page).toContain("'projecoes'");
    expect(page).toContain("'mrp'");
    expect(page).toContain("activeTab: 'projecao'");
    expect(page).toContain("next.set('tab', 'projecao')");
  });

  it('monta PurchaseProjectionWeeklyContent na aba principal', () => {
    expect(page).toContain('PurchaseProjectionWeeklyContent');
    expect(page).toContain('TabsContent value="projecao"');
  });
});
