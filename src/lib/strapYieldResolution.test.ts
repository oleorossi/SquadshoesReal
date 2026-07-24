import { describe, it, expect } from 'vitest';
import { resolveStrapYield, type StrapBaseRecipe } from './strapYieldResolution';

/** Receitas reais da TIRA CHATA 8MM (banco, 23/07/2026): SOFT e MADRID, ambas
 *  rolo de 1000 mm e rendimento 60 m/m. NAPA SUDANI não tem receita nem largura
 *  cadastrada — era o cenário do "7 itens ficaram fora do total" (PV CAPUCCINO). */
const TIRA_CHATA_8MM: StrapBaseRecipe[] = [
  { baseName: 'NAPA SOFT', yieldPerMeter: 60 },
  { baseName: 'NAPA MADRID', yieldPerMeter: 60 },
];

const WIDTHS: Record<string, number> = {
  'napa soft': 1000,
  'napa madrid': 1000,
  'napa sudani': 0, // largura do rolo não cadastrada
};
const widthOf = (b: string) => WIDTHS[b.toLowerCase().trim()] ?? 0;

describe('resolveStrapYield', () => {
  it('usa a receita exata da base quando existe (sem derivedFrom)', () => {
    const r = resolveStrapYield({ baseName: 'NAPA MADRID', recipes: TIRA_CHATA_8MM, rollWidthMm: widthOf })!;
    expect(r.yieldPerMeter).toBe(60);
    expect(r.derivedFrom).toBeUndefined();
  });

  it('receita exata casa sem depender de caixa/acento', () => {
    const r = resolveStrapYield({ baseName: 'napa soft ', recipes: TIRA_CHATA_8MM })!;
    expect(r.yieldPerMeter).toBe(60);
    expect(r.derivedFrom).toBeUndefined();
  });

  it('sem largura do rolo alvo, herda quando as receitas existentes são unânimes (caso NAPA SUDANI)', () => {
    const r = resolveStrapYield({ baseName: 'NAPA SUDANI', recipes: TIRA_CHATA_8MM, rollWidthMm: widthOf })!;
    expect(r.yieldPerMeter).toBe(60);
    expect(r.derivedFrom).toBe('NAPA MADRID / NAPA SOFT');
  });

  it('com largura do rolo alvo IGUAL à de uma base com receita, reusa o rendimento dela', () => {
    const r = resolveStrapYield({
      baseName: 'NAPA SUDANI',
      recipes: TIRA_CHATA_8MM,
      rollWidthMm: (b) => 1000, // SUDANI também 1000 mm
    })!;
    expect(r.yieldPerMeter).toBe(60);
    expect(r.derivedFrom).toBe('NAPA MADRID'); // 1ª em ordem alfabética, determinístico
  });

  it('com larguras conhecidas e diferentes, escala o rendimento pela razão das larguras', () => {
    // Rolo alvo de 1400 mm vs receita medida em rolo de 1000 mm → 60 × 1,4 = 84.
    const r = resolveStrapYield({
      baseName: 'COURO LISO',
      recipes: [{ baseName: 'NAPA SOFT', yieldPerMeter: 60 }],
      rollWidthMm: (b) => (b.toLowerCase().includes('couro') ? 1400 : 1000),
    })!;
    expect(r.yieldPerMeter).toBeCloseTo(84, 2);
    expect(r.derivedFrom).toBe('NAPA SOFT');
  });

  it('NÃO herda quando as receitas existentes divergem e a largura do alvo é desconhecida', () => {
    const r = resolveStrapYield({
      baseName: 'NAPA SUDANI',
      recipes: [
        { baseName: 'NAPA SOFT', yieldPerMeter: 60 },
        { baseName: 'NAPA MADRID', yieldPerMeter: 44 },
      ],
      rollWidthMm: widthOf,
    });
    expect(r).toBeNull();
  });

  it('tira sem receita nenhuma continua pendente (null)', () => {
    expect(resolveStrapYield({ baseName: 'NAPA SUDANI', recipes: [] })).toBeNull();
  });

  it('ignora receitas com rendimento inválido (0/negativo)', () => {
    const r = resolveStrapYield({
      baseName: 'NAPA SUDANI',
      recipes: [
        { baseName: 'NAPA SOFT', yieldPerMeter: 0 },
        { baseName: 'NAPA MADRID', yieldPerMeter: 60 },
      ],
    })!;
    expect(r.yieldPerMeter).toBe(60);
    expect(r.derivedFrom).toBe('NAPA MADRID');
  });

  it('deduplica receitas repetidas da mesma base (via grupo E aplicação) antes de decidir unanimidade', () => {
    const r = resolveStrapYield({
      baseName: 'NAPA SUDANI',
      recipes: [
        { baseName: 'NAPA SOFT', yieldPerMeter: 60 },
        { baseName: 'NAPA SOFT', yieldPerMeter: 60 },
        { baseName: 'NAPA MADRID', yieldPerMeter: 60 },
      ],
    })!;
    expect(r.yieldPerMeter).toBe(60);
  });

  it('base vazia não resolve', () => {
    expect(resolveStrapYield({ baseName: '', recipes: TIRA_CHATA_8MM })).toBeNull();
  });
});
