import { describe, it, expect } from 'vitest';
import { compareColors, colorBucket } from '../colorSequencing';

describe('colorBucket', () => {
  it('assigns whites to bucket 0', () => {
    expect(colorBucket('Branco')).toBe(0);
    expect(colorBucket('Off White')).toBe(0);
    expect(colorBucket('CRU')).toBe(0);
    expect(colorBucket('Marfim')).toBe(0);
  });

  it('assigns pastels to bucket 1', () => {
    expect(colorBucket('Bege')).toBe(1);
    expect(colorBucket('Nude')).toBe(1);
    expect(colorBucket('CHAMPAGNE')).toBe(1);
  });

  it('assigns dark colors to bucket 4', () => {
    expect(colorBucket('Marrom')).toBe(4);
    expect(colorBucket('Café')).toBe(4);
    expect(colorBucket('Vinho')).toBe(4);
    expect(colorBucket('CARAMELO')).toBe(4);
  });

  it('assigns black to bucket 5', () => {
    expect(colorBucket('Preto')).toBe(5);
    expect(colorBucket('PRETO')).toBe(5);
    expect(colorBucket('black')).toBe(5);
  });

  it('defaults unknown colors to bucket 3', () => {
    expect(colorBucket('Marsala')).toBe(3);
    expect(colorBucket('Adocicado')).toBe(3);
    expect(colorBucket('')).toBe(3);
  });
});

describe('compareColors', () => {
  it('sorts whites before pastels before darks before black', () => {
    const colors = ['Preto', 'Marrom', 'Bege', 'Branco', 'Off White', 'Vermelho'];
    const sorted = [...colors].sort(compareColors);
    expect(sorted[0]).toMatch(/branco|off white/i);
    expect(sorted[sorted.length - 1]).toBe('Preto');
  });

  it('matches real PV-2026-00093 case (CARAMELO, OFF WHITE, PRETO)', () => {
    const sorted = ['CARAMELO', 'OFF WHITE', 'PRETO'].sort(compareColors);
    expect(sorted).toEqual(['OFF WHITE', 'CARAMELO', 'PRETO']);
  });

  it('matches real PV-2026-00052 case (7 colors covering most buckets)', () => {
    const sorted = ['ADOCICADO', 'CHAMPAGNE', 'COBRE', 'DÁLIA', 'NUDE', 'OFF WHITE', 'PICOLE'].sort(compareColors);
    // OFF WHITE deve vir primeiro (bucket 0); CHAMPAGNE+NUDE depois (bucket 1);
    // restantes (default bucket 3) por ordem alfabética.
    expect(sorted[0]).toBe('OFF WHITE');
    expect(sorted.slice(1, 3).sort()).toEqual(['CHAMPAGNE', 'NUDE']);
  });

  it('is stable alphabetically within the same bucket', () => {
    const sorted = ['Verde', 'Vermelho', 'Azul', 'Roxo'].sort(compareColors);
    expect(sorted).toEqual(['Azul', 'Roxo', 'Verde', 'Vermelho']);
  });
});
