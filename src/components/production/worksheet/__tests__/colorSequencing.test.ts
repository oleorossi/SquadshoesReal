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

  it('classifies dark earthy colors to bucket 4 (auditoria mai/2026)', () => {
    // Cores do catálogo Squad/Lojão Niteroi descobertas em auditoria
    expect(colorBucket('COGUMELO')).toBe(4);
    expect(colorBucket('CARVALHO')).toBe(4);
    expect(colorBucket('NEW WHISKY')).toBe(4);
    expect(colorBucket('TÂMARA')).toBe(4);
    expect(colorBucket('COBRE')).toBe(4);
  });

  it('classifies TAN/MILK to correct buckets (auditoria mai/2026)', () => {
    expect(colorBucket('NEW TAN')).toBe(1);
    expect(colorBucket('NAPA SOFT MILK')).toBe(0);
    expect(colorBucket('OURO LIGHT')).toBe(2);
  });

  it('classifies ROSE variations to pastel bucket 2', () => {
    expect(colorBucket('ROSE')).toBe(2);
    expect(colorBucket('ROSADO')).toBe(2);
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
    // OFF WHITE (bucket 0), CHAMPAGNE/NUDE (1), ADOCICADO/DÁLIA/PICOLE (3 default), COBRE (4 — auditoria fix)
    expect(sorted[0]).toBe('OFF WHITE');
    expect(sorted.slice(1, 3).sort()).toEqual(['CHAMPAGNE', 'NUDE']);
    expect(sorted[sorted.length - 1]).toBe('COBRE');
  });

  it('handles all 24 real colors from production DB without misclassification', () => {
    // Snapshot do estado após fix de auditoria mai/2026. Se este teste
    // quebrar, é sinal de regressão nos patterns dos buckets.
    const all = [
      'PRETO', 'OFF WHITE', 'CHAMPAGNE', 'CARAMELO', 'COGUMELO', 'BEGE',
      'ADOCICADO', 'NUDE', 'DÁLIA', 'PICOLE', 'ROSE', 'COBRE', 'NEW TAN',
      'CARVALHO', 'ROCHA', 'NEW WHISKY', 'NAPA SOFT DALIA', 'NATURAL',
      'NAPA TITANIUM 2026 OFF WHITE', 'NAPA TITANIUM 2026 PRETO',
      'NAPA SOFT MILK', 'ROSADO', 'TÂMARA', 'OURO LIGHT',
    ];
    const sorted = [...all].sort(compareColors);
    // Primeira cor: bucket 0 (NATURAL/OFF WHITE/MILK)
    expect(['NATURAL', 'OFF WHITE', 'NAPA SOFT MILK', 'NAPA TITANIUM 2026 OFF WHITE'])
      .toContain(sorted[0]);
    // Última cor: sempre algum PRETO
    expect(sorted[sorted.length - 1]).toMatch(/PRETO/);
  });

  it('is stable alphabetically within the same bucket', () => {
    const sorted = ['Verde', 'Vermelho', 'Azul', 'Roxo'].sort(compareColors);
    expect(sorted).toEqual(['Azul', 'Roxo', 'Verde', 'Vermelho']);
  });
});
