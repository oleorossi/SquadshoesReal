import { describe, it, expect } from 'vitest';
import { parseBrlNumber, parseBrlNumberNonNeg } from './parseBrlNumber';

describe('parseBrlNumber', () => {
  it('formato BRL com milhar e decimal (o bug original)', () => {
    expect(parseBrlNumber('2.500,00')).toBe(2500);
    expect(parseBrlNumber('12.345,67')).toBe(12345.67);
    expect(parseBrlNumber('1.500,00')).toBe(1500);
    expect(parseBrlNumber('1.000.000,50')).toBe(1000000.5);
  });

  it('decimal com vírgula, sem milhar', () => {
    expect(parseBrlNumber('1500,50')).toBe(1500.5);
    expect(parseBrlNumber('2,5')).toBe(2.5);
    expect(parseBrlNumber('980,00')).toBe(980);
  });

  it('só milhares com ponto, sem decimal', () => {
    expect(parseBrlNumber('2.500')).toBe(2500);
    expect(parseBrlNumber('12.000')).toBe(12000);
    expect(parseBrlNumber('2.500.000')).toBe(2500000);
  });

  it('ponto como decimal quando não é padrão de milhar', () => {
    expect(parseBrlNumber('2.5')).toBe(2.5);
    expect(parseBrlNumber('0.75')).toBe(0.75);
    expect(parseBrlNumber('1500')).toBe(1500);
    expect(parseBrlNumber('10.50')).toBe(10.5); // 2 casas decimais, não milhar
  });

  it('símbolo de moeda, espaços, número e vazios', () => {
    expect(parseBrlNumber('R$ 2.500,00')).toBe(2500);
    expect(parseBrlNumber('  1.200,00 ')).toBe(1200);
    expect(parseBrlNumber(1500)).toBe(1500);
    expect(parseBrlNumber('')).toBe(0);
    expect(parseBrlNumber(null)).toBe(0);
    expect(parseBrlNumber(undefined)).toBe(0);
    expect(parseBrlNumber('abc')).toBe(0);
  });

  it('negativos: parseBrlNumber preserva, parseBrlNumberNonNeg zera', () => {
    expect(parseBrlNumber('-50')).toBe(-50);
    expect(parseBrlNumberNonNeg('-50')).toBe(0);
    expect(parseBrlNumberNonNeg('-2.500,00')).toBe(0);
    expect(parseBrlNumberNonNeg('1500,50')).toBe(1500.5);
  });
});
