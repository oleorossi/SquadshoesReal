import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HOOKS = readFileSync(resolve('src/hooks/useArtisanalStraps.ts'), 'utf8');
const SALE_ORDER_FORM = readFileSync(resolve('src/pages/SaleOrderForm.tsx'), 'utf8');
const SALE_ORDER_ITEM = readFileSync(resolve('src/components/sale-orders/SaleOrderItemForm.tsx'), 'utf8');
const HUB = readFileSync(resolve('src/pages/ArtisanalStraps.tsx'), 'utf8');

describe('useArtisanalStrapCatalog · legado no PV', () => {
  it('PV não pede o histórico legado (custo morto / timeout)', () => {
    expect(SALE_ORDER_FORM).toContain('includeLegacyHistory: false');
    expect(SALE_ORDER_ITEM).toContain('includeLegacyHistory: false');
  });

  it('Hub continua pedindo o histórico legado explicitamente', () => {
    expect(HUB).toContain('includeLegacyHistory: true');
  });

  it('erro/timeout do legado não propaga throw no catálogo canônico', () => {
    const catalogFn = HOOKS.slice(
      HOOKS.indexOf('export function useArtisanalStrapCatalog'),
      HOOKS.indexOf('export function useStrapBaseGroupCandidates'),
    );
    expect(catalogFn).toContain('histórico legado indisponível');
    expect(catalogFn).not.toMatch(/throw legacyHistoryResult\.error/);
    expect(catalogFn).toContain("legacy_recipes: legacyHistoryError\n          ? []");
  });
});
