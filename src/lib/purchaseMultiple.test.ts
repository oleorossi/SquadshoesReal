import { describe, it, expect } from 'vitest';
import {
  effectivePurchaseMultiple,
  roundUpToPurchaseMultiple,
  applyPurchaseMultiple,
} from './purchaseMultiple';

describe('effectivePurchaseMultiple', () => {
  it('usa o múltiplo do item quando > 0', () => {
    expect(effectivePurchaseMultiple(50, 10)).toBe(50);
  });
  it('cai pro grupo quando o item é 0/null/undefined', () => {
    expect(effectivePurchaseMultiple(0, 10)).toBe(10);
    expect(effectivePurchaseMultiple(null, 10)).toBe(10);
    expect(effectivePurchaseMultiple(undefined, 10)).toBe(10);
  });
  it('retorna 0 quando nenhum está definido', () => {
    expect(effectivePurchaseMultiple(null, null)).toBe(0);
    expect(effectivePurchaseMultiple(undefined, undefined)).toBe(0);
    expect(effectivePurchaseMultiple(0, 0)).toBe(0);
  });
});

describe('roundUpToPurchaseMultiple', () => {
  it('arredonda 187 → 200 com múltiplo 50 (caso Caixa Colmeia)', () => {
    expect(roundUpToPurchaseMultiple(187, 50)).toBe(200);
  });
  it('mantém quando já é múltiplo exato', () => {
    expect(roundUpToPurchaseMultiple(200, 50)).toBe(200);
    expect(roundUpToPurchaseMultiple(100, 100)).toBe(100);
  });
  it('arredonda pra cima até o primeiro pacote', () => {
    expect(roundUpToPurchaseMultiple(1, 50)).toBe(50);
    expect(roundUpToPurchaseMultiple(0.1, 10)).toBe(10);
    expect(roundUpToPurchaseMultiple(1001, 1000)).toBe(2000);
  });
  it('múltiplo 0/1/null/undefined = sem arredondamento', () => {
    expect(roundUpToPurchaseMultiple(187, 0)).toBe(187);
    expect(roundUpToPurchaseMultiple(187, 1)).toBe(187);
    expect(roundUpToPurchaseMultiple(187, null)).toBe(187);
    expect(roundUpToPurchaseMultiple(187, undefined)).toBe(187);
  });
  it('não mexe em quantidades ≤ 0 ou inválidas', () => {
    expect(roundUpToPurchaseMultiple(0, 50)).toBe(0);
    expect(roundUpToPurchaseMultiple(-5, 50)).toBe(-5);
    expect(roundUpToPurchaseMultiple(Number.NaN, 50)).toBeNaN();
  });
  it('funciona com múltiplos fracionários (ex.: 2,5)', () => {
    expect(roundUpToPurchaseMultiple(6, 2.5)).toBe(7.5);
  });
});

describe('applyPurchaseMultiple', () => {
  it('resolve item→grupo e arredonda', () => {
    expect(applyPurchaseMultiple(187, 50, 10)).toBe(200); // item 50 vence
    expect(applyPurchaseMultiple(187, 0, 100)).toBe(200); // cai pro grupo 100
    expect(applyPurchaseMultiple(187, null, null)).toBe(187); // sem múltiplo
  });
});
