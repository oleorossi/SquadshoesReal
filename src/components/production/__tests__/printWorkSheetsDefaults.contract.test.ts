import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_A4_SECTORS, SECTORS } from '../PrintWorkSheetsPage';

/**
 * Defaults de abertura em /imprimir-fichas (pedido do dono):
 * rota do dia a dia + foto grande só em M100 / S-039.
 */
describe('PrintWorkSheetsPage · defaults de abertura', () => {
  const src = readFileSync(
    resolve(__dirname, '../PrintWorkSheetsPage.tsx'),
    'utf8',
  );

  it('DEFAULT_A4_SECTORS traz só a rota do dia a dia', () => {
    expect([...DEFAULT_A4_SECTORS]).toEqual([
      'Palmilha',
      'Corte Cabedal',
      'Acabamento Palmilha',
      'Costura Cabedal',
      'Aviamento',
      'Silk',
      'Colagem',
      'Solagem',
      'Acabamento',
    ]);
  });

  it('Só Fibra, Só Forração, Montagem, Expedição e Relatório ficam de fora', () => {
    const excluded = [
      'Só Fibra',
      'Só Forração',
      'Montagem',
      'Expedição',
      'Relatório Gerencial',
    ] as const;
    for (const s of excluded) {
      expect(SECTORS).toContain(s);
      expect(DEFAULT_A4_SECTORS).not.toContain(s);
    }
  });

  it('foto grande default filtra M100 e S-039 (label normalizado)', () => {
    expect(src).toMatch(/DEFAULT_HERO_PHOTO_LABELS\s*=\s*new Set\(\['M100',\s*'S-039'\]\)/);
    expect(src).toMatch(/normalizeHeroPhotoLabel/);
    // Seed do useEffect: só as labels default — não todas as elegíveis.
    expect(src).toMatch(
      /setHeroPhotoRefKeys\(new Set\(\s*aviamentoHeroEligible\s*\.filter\(\(r\) => DEFAULT_HERO_PHOTO_LABELS\.has\(normalizeHeroPhotoLabel\(r\.label\)\)\)/s,
    );
  });
});
