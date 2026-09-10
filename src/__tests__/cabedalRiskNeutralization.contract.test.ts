import { describe, expect, it } from 'vitest';
import {
  averagePositiveConsumption,
  isSuspectPerFoot,
  needsCabedalParConfirmation,
  sheetLooksLikePerFoot,
} from '@/lib/cabedalParPeGuard';
import { linearUnitOrDm2 } from '@/lib/materialConsumption';

describe('Anular risco ~100× (sem largura)', () => {
  it('linearUnitOrDm2 nunca devolve metro quando widthMissing', () => {
    expect(linearUnitOrDm2(true)).toBe('dm2');
    expect(linearUnitOrDm2(false)).toBe('metro');
  });
});

describe('Anular risco ~2× (cadastro por pé)', () => {
  it('detecta suspeita 40–60% do peer', () => {
    expect(isSuspectPerFoot(6, 12)).toBe(true);
    expect(isSuspectPerFoot(5, 12)).toBe(true);
    expect(isSuspectPerFoot(12, 12)).toBe(false);
    expect(isSuspectPerFoot(3, 12)).toBe(false); // 25% — fora da faixa
  });

  it('sheetLooksLikePerFoot usa a média do escalar + per-size', () => {
    expect(sheetLooksLikePerFoot({
      upperConsumption: 6,
      upperConsumptionPerSize: { '36': 5.5, '38': 6.5 },
      peerMaxForMaterial: 12,
    })).toBe(true);
  });

  it('needsCabedalParConfirmation exige confirmação com consumo > 0', () => {
    expect(needsCabedalParConfirmation({
      hasUpperMaterial: true,
      upperConsumption: 6,
    })).toBe(true);
    expect(needsCabedalParConfirmation({
      hasUpperMaterial: true,
      upperConsumption: 0,
      upperConsumptionPerSize: {},
    })).toBe(false);
    expect(needsCabedalParConfirmation({
      hasUpperMaterial: false,
      upperConsumption: 6,
    })).toBe(false);
  });

  it('averagePositiveConsumption ignora zeros e outliers', () => {
    expect(averagePositiveConsumption(0, { '36': 6, '38': 0, '40': 200 })).toBe(6);
  });
});
