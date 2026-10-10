import { describe, expect, it } from 'vitest';
import { calcArtisanalRequirement, type ArtisanalRecipe } from '@/hooks/useArtisanalRecipes';

const recipe = {
  yield_per_meter: 60,
  labor_cost_per_meter: 0.5,
} as ArtisanalRecipe;

describe('calcArtisanalRequirement — só demanda (estoque mínimo removido)', () => {
  it('calcula max(0, demanda - estoque)', () => {
    const result = calcArtisanalRequirement(recipe, 100, 20);
    expect(result.forOrderMeters).toBe(80);
    expect(result.totalToProduce).toBe(80);
    expect(result.baseMetersSend).toBeCloseTo(80 / 60);
    expect(result.laborCost).toBe(40);
    expect(result.stockOk).toBe(false);
  });

  it('não produz para recompor piso quando o estoque cobre o pedido', () => {
    const result = calcArtisanalRequirement(recipe, 90, 100);
    expect(result.forOrderMeters).toBe(0);
    expect(result.totalToProduce).toBe(0);
    expect(result.stockOk).toBe(true);
    expect(result).not.toHaveProperty('forStockMeters');
  });
});
