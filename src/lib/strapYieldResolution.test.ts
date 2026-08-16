import { describe, expect, it } from 'vitest';
import { resolveStrapYield, type StrapBaseRecipe } from './strapYieldResolution';

const SOFT = '11111111-1111-4111-8111-111111111111';
const MADRID = '22222222-2222-4222-8222-222222222222';
const recipes: StrapBaseRecipe[] = [
  { baseName: 'NAPA SOFT', baseGroupId: SOFT, yieldPerMeter: 60 },
  { baseName: 'NAPA MADRID', baseGroupId: MADRID, yieldPerMeter: 58 },
];

describe('resolveStrapYield — somente receita exata', () => {
  it('resolve por ID imutável quando disponível', () => {
    expect(resolveStrapYield({ baseGroupId: MADRID, recipes })).toEqual({ yieldPerMeter: 58 });
  });

  it('mantém leitura nominal apenas para relatório legado exato', () => {
    expect(resolveStrapYield({ baseName: ' napa soft ', recipes })).toEqual({ yieldPerMeter: 60 });
  });

  it('não herda rendimento unânime nem escala pela largura', () => {
    expect(resolveStrapYield({
      baseName: 'NAPA GLOW METALIC',
      recipes,
      rollWidthMm: (base) => base.includes('GLOW') ? 1400 : 1000,
    })).toBeNull();
  });

  it('rejeita rendimento inválido e alvo vazio', () => {
    expect(resolveStrapYield({ baseName: 'X', recipes: [{ baseName: 'X', yieldPerMeter: 0 }] })).toBeNull();
    expect(resolveStrapYield({ baseName: '', recipes })).toBeNull();
  });
});
