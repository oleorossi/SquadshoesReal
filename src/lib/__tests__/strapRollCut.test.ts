import { describe, it, expect } from 'vitest';
import {
  computeStrapRollCut,
  isArtisanalStrap,
  normalizeWidthToMm,
  ROLO_LARGURA_MM,
  ROLO_COMPRIMENTO_M,
  TIRA_DIVISOR_MM,
  KERF_MM,
  PERDA_PCT,
} from '@/lib/strapRollCut';

/**
 * GATE da fórmula de corte do rolo (tiras artesanais).
 *
 * Cobre TODOS os valores da tabela que o Leonardo passou e confirma que
 * `metros_uteis` e `cm_a_cortar` batem com o cálculo manual a 13% de perda.
 */

// [largura_mm, tiras_por_rolo esperado] — tabela canônica do Leonardo.
const TABELA: Array<[number, number]> = [
  [100, 4],
  [150, 7],
  [200, 9],
  [250, 11],
  [300, 14],
  [400, 19],
  [500, 23],
  [685, 32],
  [1370, 65],
];

describe('constantes', () => {
  it('valores padrão do rolo e perda', () => {
    expect(ROLO_LARGURA_MM).toBe(1370);
    expect(ROLO_COMPRIMENTO_M).toBe(40);
    expect(TIRA_DIVISOR_MM).toBe(21);
    expect(PERDA_PCT).toBeCloseTo(0.13, 10);
  });

  it('kerf começa em 0 (a confirmar com Leonardo)', () => {
    expect(KERF_MM).toBe(0);
  });
});

describe('computeStrapRollCut — tabela do Leonardo', () => {
  for (const [largura, tirasEsperadas] of TABELA) {
    it(`largura ${largura}mm → ${tirasEsperadas} tiras`, () => {
      // metros_necessarios arbitrário > 0 para também validar cm_a_cortar.
      const metros = 100;
      const r = computeStrapRollCut({ largura_mm: largura, metros_necessarios: metros });

      expect(r.valid).toBe(true);
      expect(r.widthMissing).toBe(false);
      expect(r.tiras_por_rolo).toBe(tirasEsperadas);

      // metros_uteis = tiras × 40 × 0,87
      const metrosUteisManual = tirasEsperadas * 40 * 0.87;
      expect(r.metros_uteis_rolo).toBeCloseTo(metrosUteisManual, 6);

      // cm_a_cortar = (metros × 4000) ÷ metros_uteis
      const cmManual = (metros * 4000) / metrosUteisManual;
      expect(r.cm_a_cortar).toBeCloseTo(cmManual, 6);
    });
  }
});

describe('computeStrapRollCut — propriedades', () => {
  it('rolo cheio: precisar de metros_uteis de tira ⇒ cortar o rolo inteiro (4000 cm)', () => {
    const r1 = computeStrapRollCut({ largura_mm: 100, metros_necessarios: 0 });
    const cheio = computeStrapRollCut({ largura_mm: 100, metros_necessarios: r1.metros_uteis_rolo });
    expect(cheio.cm_a_cortar).toBeCloseTo(4000, 6);
  });

  it('metade do rendimento ⇒ metade do rolo (2000 cm)', () => {
    const r1 = computeStrapRollCut({ largura_mm: 100, metros_necessarios: 0 });
    const metade = computeStrapRollCut({ largura_mm: 100, metros_necessarios: r1.metros_uteis_rolo / 2 });
    expect(metade.cm_a_cortar).toBeCloseTo(2000, 6);
  });

  it('largura no limite do rolo (1370mm) é válida', () => {
    const r = computeStrapRollCut({ largura_mm: ROLO_LARGURA_MM, metros_necessarios: 50 });
    expect(r.valid).toBe(true);
    expect(r.tiras_por_rolo).toBe(65);
  });

  it('com kerf=0 a fórmula equivale a floor(largura/21)', () => {
    for (const [largura, tiras] of TABELA) {
      expect(Math.floor((largura - KERF_MM) / (TIRA_DIVISOR_MM + KERF_MM))).toBe(tiras);
    }
  });
});

describe('computeStrapRollCut — validações', () => {
  it('largura ausente → widthMissing + aviso', () => {
    const r = computeStrapRollCut({ largura_mm: null as any, metros_necessarios: 100 });
    expect(r.valid).toBe(false);
    expect(r.widthMissing).toBe(true);
    expect(r.warning).toMatch(/não cadastrada/i);
    expect(r.cm_a_cortar).toBe(0);
  });

  it('largura 0 → widthMissing', () => {
    const r = computeStrapRollCut({ largura_mm: 0, metros_necessarios: 100 });
    expect(r.valid).toBe(false);
    expect(r.widthMissing).toBe(true);
  });

  it('largura abaixo do mínimo de uma tira (< 21mm) → inválida', () => {
    const r = computeStrapRollCut({ largura_mm: 10, metros_necessarios: 100 });
    expect(r.valid).toBe(false);
    expect(r.widthMissing).toBe(false);
    expect(r.warning).toMatch(/mínimo/i);
  });

  it('largura acima da largura do rolo (> 1370mm) → inválida', () => {
    const r = computeStrapRollCut({ largura_mm: 1500, metros_necessarios: 100 });
    expect(r.valid).toBe(false);
    expect(r.warning).toMatch(/excede/i);
  });

  it('metros_necessarios = 0 → calcula rendimento mas cm_a_cortar 0', () => {
    const r = computeStrapRollCut({ largura_mm: 200, metros_necessarios: 0 });
    expect(r.valid).toBe(true);
    expect(r.tiras_por_rolo).toBe(9);
    expect(r.cm_a_cortar).toBe(0);
  });
});

describe('normalizeWidthToMm', () => {
  it('mm é identidade (default)', () => {
    expect(normalizeWidthToMm(200)).toBe(200);
    expect(normalizeWidthToMm(200, 'mm')).toBe(200);
  });
  it('cm → mm', () => {
    expect(normalizeWidthToMm(20, 'cm')).toBe(200);
  });
  it('m → mm', () => {
    expect(normalizeWidthToMm(1.37, 'm')).toBeCloseTo(1370, 6);
  });
  it('ausente/inválida → 0', () => {
    expect(normalizeWidthToMm(0)).toBe(0);
    expect(normalizeWidthToMm(null)).toBe(0);
    expect(normalizeWidthToMm(undefined, 'cm')).toBe(0);
  });
});

describe('isArtisanalStrap — detecção', () => {
  it('flag por tira true vence tudo', () => {
    expect(isArtisanalStrap({ strapFlag: true, name: 'TIRA STRASS' })).toBe(true);
  });
  it('flag por tira false opta por fora (mesmo com nome de tira)', () => {
    expect(isArtisanalStrap({ strapFlag: false, name: 'TIRA NAPA', groupFlag: true })).toBe(false);
  });
  it('flag de grupo true detecta', () => {
    expect(isArtisanalStrap({ groupFlag: true, name: 'qualquer coisa' })).toBe(true);
  });
  it('heurístico: "tira napa" é artesanal', () => {
    expect(isArtisanalStrap({ name: 'TIRA NAPA CARAMELO' })).toBe(true);
  });
  it('heurístico: "tira artesanal" é artesanal', () => {
    expect(isArtisanalStrap({ name: 'Tira Artesanal' })).toBe(true);
  });
  it('heurístico: itens comprados prontos NÃO são artesanais', () => {
    expect(isArtisanalStrap({ name: 'TIRA STRASS' })).toBe(false);
    expect(isArtisanalStrap({ name: 'TIRA ELÁSTICA' })).toBe(false);
    expect(isArtisanalStrap({ name: 'Tira Trançada' })).toBe(false);
  });
  it('sem nome e sem flag → não detecta', () => {
    expect(isArtisanalStrap({})).toBe(false);
    expect(isArtisanalStrap({ name: '' })).toBe(false);
  });
});
