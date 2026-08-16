import { describe, expect, it } from 'vitest';
import { calcArtisanalRequirement, type ArtisanalRecipe } from '@/hooks/useArtisanalRecipes';

const recipe = {
  yield_per_meter: 60,
  labor_cost_per_meter: 0.5,
} as ArtisanalRecipe;

describe('calcArtisanalRequirement', () => {
  it('calcula max(0, demanda + mínimo - estoque)', () => {
    const result = calcArtisanalRequirement(recipe, 100, 20, 10);
    expect(result.forOrderMeters).toBe(80);
    expect(result.forStockMeters).toBe(10);
    expect(result.totalToProduce).toBe(90);
    expect(result.baseMetersSend).toBe(1.5);
  });

  it('usa excesso após atender o pedido para preservar o piso', () => {
    const result = calcArtisanalRequirement(recipe, 90, 100, 30);
    expect(result.forOrderMeters).toBe(0);
    expect(result.forStockMeters).toBe(20);
    expect(result.totalToProduce).toBe(20);
  });

  it('não produz quando estoque cobre pedido e piso', () => {
    expect(calcArtisanalRequirement(recipe, 90, 130, 30).totalToProduce).toBe(0);
  });
});
