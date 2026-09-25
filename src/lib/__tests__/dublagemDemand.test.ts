import { describe, expect, it } from 'vitest';
import {
  computeDublagemFaceQuantities,
  faceColorForDublagem,
  glueCostReais,
  massaBoxColorForPv,
  normalizeDublagemColor,
} from '@/lib/dublagemDemand';
import { dublagemPurchaseNeed, isDublagemPurchaseOrder } from '@/lib/perPvPurchasing';

describe('dublagemDemand — cor e conversão', () => {
  it('normaliza cor ignorando acento e caixa', () => {
    expect(normalizeDublagemColor('  Préto ')).toBe('PRETO');
    expect(normalizeDublagemColor('marfim')).toBe('MARFIM');
  });

  it('Massa Box: PRETO se PV preto; senão MARFIM', () => {
    expect(massaBoxColorForPv('PRETO')).toBe('PRETO');
    expect(massaBoxColorForPv('preto')).toBe('PRETO');
    expect(massaBoxColorForPv('BLACK')).toBe('PRETO');
    expect(massaBoxColorForPv('OFF WHITE')).toBe('MARFIM');
    expect(massaBoxColorForPv('ROSE')).toBe('MARFIM');
    expect(massaBoxColorForPv('')).toBe('MARFIM');
  });

  it('face externa herda cor do PV; interna usa Massa Box', () => {
    expect(faceColorForDublagem('external', 'ROSE')).toBe('ROSE');
    expect(faceColorForDublagem('internal', 'ROSE')).toBe('MARFIM');
    expect(faceColorForDublagem('internal', 'PRETO')).toBe('PRETO');
  });

  it('mesmo dm² nas duas faces; metros pela largura de cada ficha', () => {
    const faces = computeDublagemFaceQuantities({
      upperDm2Total: 274,
      pvColor: 'OFF WHITE',
      externalSheet: {
        dimensions_width: 1370,
        dimensions_length: 1000,
        dimensions_unit: 'mm',
      },
      internalSheet: {
        dimensions_width: 1000,
        dimensions_length: 1500,
        dimensions_unit: 'mm',
      },
    });
    expect(faces).toHaveLength(2);
    expect(faces[0].dm2).toBe(274);
    expect(faces[1].dm2).toBe(274);
    expect(faces[0].color).toBe('OFF WHITE');
    expect(faces[1].color).toBe('MARFIM');
    // 1370 mm → 137 dm²/m → 274/137 ≈ 2
    expect(faces[0].linearM).toBeCloseTo(2, 5);
    // 1000 mm → 100 dm²/m → 2.74
    expect(faces[1].linearM).toBeCloseTo(2.74, 5);
    expect(faces[0].widthMissing).toBe(false);
    expect(faces[1].widthMissing).toBe(false);
  });

  it('sem largura: marca widthMissing e não inventa divisor', () => {
    const faces = computeDublagemFaceQuantities({
      upperDm2Total: 100,
      pvColor: 'PRETO',
      externalSheet: null,
      internalSheet: { dimensions_width: 0, dimensions_unit: 'mm' },
    });
    expect(faces[0].widthMissing).toBe(true);
    expect(faces[0].linearM).toBe(100);
    expect(faces[1].widthMissing).toBe(true);
  });

  it('cola = metros × R$/m', () => {
    expect(glueCostReais(12.5, 2)).toBe(25);
  });
});

describe('dublagemPurchaseNeed / source_type', () => {
  it('externa ignora saldo; interna usa shortage', () => {
    expect(dublagemPurchaseNeed({ mode: 'external', demandLinearM: 10, availableStock: 50 })).toBe(10);
    expect(dublagemPurchaseNeed({ mode: 'internal', demandLinearM: 10, availableStock: 4 })).toBe(6);
    expect(dublagemPurchaseNeed({ mode: 'internal', demandLinearM: 10, availableStock: 20 })).toBe(0);
  });

  it('predicado de OC', () => {
    expect(isDublagemPurchaseOrder({ source_type: 'dublagem' })).toBe(true);
    expect(isDublagemPurchaseOrder({ source_type: 'per_pv' })).toBe(false);
  });
});
