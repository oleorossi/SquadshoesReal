import { describe, it, expect } from 'vitest';
import { resolveFicha, CORRUGADOS } from '../fichaSize';

describe('resolveFicha', () => {
  it('exporta os três corrugados físicos canônicos', () => {
    expect([...CORRUGADOS]).toEqual([12, 15, 18]);
  });

  // ── Caso 1: grid JÁ é a curva-base (comportamento que hoje funciona) ──
  it('preserva grid que já é curva-base de 12 (ex.: ficha de 480 = 40 fichas)', () => {
    const curve = { '34': 1, '35': 2, '36': 3, '37': 3, '38': 2, '39': 1 }; // Σ=12
    const r = resolveFicha(480, curve);
    expect(r).toEqual({ corrugado: 12, fichas: 40, baseCurve: curve, exact: true });
  });

  it('preserva curva-base de 15', () => {
    const curve = { '33': 2, '34': 3, '35': 4, '36': 3, '37': 3 }; // Σ=15
    const r = resolveFicha(45, curve);
    expect(r).toEqual({ corrugado: 15, fichas: 3, baseCurve: curve, exact: true });
  });

  it('preserva curva-base de 18', () => {
    const curve = { '34': 3, '35': 4, '36': 5, '37': 4, '38': 2 }; // Σ=18
    const r = resolveFicha(180, curve);
    expect(r).toEqual({ corrugado: 18, fichas: 10, baseCurve: curve, exact: true });
  });

  it('curva-base de 12 com total = 12 → 1 ficha', () => {
    const curve = { '34': 1, '35': 2, '36': 3, '37': 3, '38': 2, '39': 1 };
    const r = resolveFicha(12, curve);
    expect(r).toEqual({ corrugado: 12, fichas: 1, baseCurve: curve, exact: true });
  });

  // ── Caso 2: grid é a GRADE TOTAL do pedido (bug original) ──
  it('caso real TAMARA: total 120 com grade total {10,30,40,20,20} → 10 fichas de 12', () => {
    const r = resolveFicha(120, { '35': 10, '36': 30, '37': 40, '38': 20, '39': 20 });
    expect(r.corrugado).toBe(12);
    expect(r.fichas).toBe(10);
    expect(r.exact).toBe(true);
    expect(r.baseCurve).toEqual({ '35': 1, '36': 3, '37': 4, '38': 2, '39': 2 });
  });

  it('caso real 444: grade total {37,111,148,74,74} → 37 fichas de 12', () => {
    const r = resolveFicha(444, { '35': 37, '36': 111, '37': 148, '38': 74, '39': 74 });
    expect(r.corrugado).toBe(12);
    expect(r.fichas).toBe(37);
    expect(r.exact).toBe(true);
    expect(r.baseCurve).toEqual({ '35': 1, '36': 3, '37': 4, '38': 2, '39': 2 });
  });

  it('caso real 720: grade total {60,180,240,120,120} → 60 fichas de 12', () => {
    const r = resolveFicha(720, { '35': 60, '36': 180, '37': 240, '38': 120, '39': 120 });
    expect(r.corrugado).toBe(12);
    expect(r.fichas).toBe(60);
    expect(r.exact).toBe(true);
    expect(r.baseCurve).toEqual({ '35': 1, '36': 3, '37': 4, '38': 2, '39': 2 });
  });

  it('grade total que só fecha em corrugado de 15 (total 75)', () => {
    // 75 não divide por 12 nem por 18; 75/15 = 5 fichas.
    const r = resolveFicha(75, { '34': 10, '35': 20, '36': 25, '37': 15, '38': 5 });
    expect(r.corrugado).toBe(15);
    expect(r.fichas).toBe(5);
    expect(r.exact).toBe(true);
    expect(r.baseCurve).toEqual({ '34': 2, '35': 4, '36': 5, '37': 3, '38': 1 });
  });

  it('grade total que só fecha em corrugado de 18 (total 54)', () => {
    // 54 não divide por 12; 54/15 não é inteiro; 54/18 = 3 fichas.
    const r = resolveFicha(54, { '34': 9, '35': 12, '36': 15, '37': 12, '38': 6 });
    expect(r.corrugado).toBe(18);
    expect(r.fichas).toBe(3);
    expect(r.exact).toBe(true);
    expect(r.baseCurve).toEqual({ '34': 3, '35': 4, '36': 5, '37': 4, '38': 2 });
  });

  it('preferência 12 > 15 > 18 quando mais de um corrugado divide (total 180)', () => {
    // 180 divide por 12 (15 fichas), 15 (12 fichas) e 18 (10 fichas).
    // Células {15,45,60,30,30}: divisíveis por 15 → corrugado 12 ganha.
    const r = resolveFicha(180, { '35': 15, '36': 45, '37': 60, '38': 30, '39': 30 });
    expect(r.corrugado).toBe(12);
    expect(r.fichas).toBe(15);
    expect(r.exact).toBe(true);
  });

  it('grade total divisível no total mas NÃO célula-a-célula cai no próximo corrugado ou fallback', () => {
    // total 120 divide por 12 (f=10) mas a célula 35:5 não divide por 10.
    // 120/15 = 8 → células {5,35,40,20,20} % 8 ≠ 0. 120/18 não inteiro.
    const r = resolveFicha(120, { '35': 5, '36': 35, '37': 40, '38': 20, '39': 20 });
    expect(r.exact).toBe(false);
    expect(r.corrugado).toBe(12);
    expect(r.fichas).toBe(10); // ceil(120/12)
    expect(r.baseCurve).toBeNull();
  });

  // ── Caso 3: curva multiplicada (Σ ∉ {12,15,18}, total % Σ == 0) ──
  it('curva multiplicada ×2 (Σ=24) reduz pra corrugado 12', () => {
    const r = resolveFicha(240, { '34': 2, '35': 4, '36': 6, '37': 6, '38': 4, '39': 2 }); // Σ=24
    expect(r.corrugado).toBe(12);
    expect(r.fichas).toBe(20); // (240/24) × 2
    expect(r.exact).toBe(true);
    expect(r.baseCurve).toEqual({ '34': 1, '35': 2, '36': 3, '37': 3, '38': 2, '39': 1 });
  });

  it('curva multiplicada ×3 (Σ=45) reduz pra corrugado 15', () => {
    // Σ=45: 45 % 12 ≠ 0; 45 % 15 == 0 (k=3) e células divisíveis por 3.
    const r = resolveFicha(90, { '34': 6, '35': 9, '36': 12, '37': 9, '38': 9 }); // Σ=45
    expect(r.corrugado).toBe(15);
    expect(r.fichas).toBe(6); // (90/45) × 3
    expect(r.exact).toBe(true);
    expect(r.baseCurve).toEqual({ '34': 2, '35': 3, '36': 4, '37': 3, '38': 3 });
  });

  // ── Caso 4: fallback ──
  it('fallback quando nada divide exato (total 130, grid Σ=12)', () => {
    // Σ=12 ∈ corrugados mas 130 % 12 ≠ 0 → última ficha parcial.
    const r = resolveFicha(130, { '34': 2, '35': 2, '36': 2, '37': 2, '38': 2, '39': 2 });
    expect(r).toEqual({ corrugado: 12, fichas: 11, baseCurve: null, exact: false });
  });

  it('fallback com grade total irredutível (total 100)', () => {
    // 100 não divide por 12/15/18 → ceil(100/12) = 9 fichas, última parcial.
    const r = resolveFicha(100, { '35': 30, '36': 40, '37': 30 });
    expect(r).toEqual({ corrugado: 12, fichas: 9, baseCurve: null, exact: false });
  });

  it('grid vazio → fallback com fichas = ceil(total/12)', () => {
    expect(resolveFicha(30, {})).toEqual({ corrugado: 12, fichas: 3, baseCurve: null, exact: false });
    expect(resolveFicha(30, undefined)).toEqual({ corrugado: 12, fichas: 3, baseCurve: null, exact: false });
  });

  it('total 0 → 0 fichas, fallback', () => {
    expect(resolveFicha(0, { '35': 1 })).toEqual({ corrugado: 12, fichas: 0, baseCurve: null, exact: false });
    expect(resolveFicha(0, {})).toEqual({ corrugado: 12, fichas: 0, baseCurve: null, exact: false });
  });

  it('ignora células zeradas/negativas/não-numéricas do grid', () => {
    const r = resolveFicha(120, {
      '34': 0, '35': 10, '36': 30, '37': 40, '38': 20, '39': 20,
      '40': Number.NaN,
    } as Record<string, number>);
    expect(r.corrugado).toBe(12);
    expect(r.fichas).toBe(10);
    expect(r.exact).toBe(true);
    expect(r.baseCurve).toEqual({ '35': 1, '36': 3, '37': 4, '38': 2, '39': 2 });
  });

  it('chaves conjugadas ("33/34") passam intactas na curva', () => {
    const r = resolveFicha(120, { '33/34': 40, '35': 40, '36': 40 });
    expect(r.corrugado).toBe(12);
    expect(r.fichas).toBe(10);
    expect(r.baseCurve).toEqual({ '33/34': 4, '35': 4, '36': 4 });
  });
});
