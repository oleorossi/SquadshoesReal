import { describe, it, expect } from 'vitest';
import {
  computeStrapRollCut,
  isArtisanalStrap,
  normalizeWidthToMm,
  ROLO_LARGURA_MM,
  ROLO_COMPRIMENTO_M,
  PERDA_PCT,
} from '@/lib/strapRollCut';

/**
 * GATE da fórmula de corte do rolo (tiras artesanais).
 *
 * Fórmula (confirmada pelo Leonardo em 2026-06-14, PV-00140): o valor de saída é a
 * LARGURA cortada do rolo (na dimensão dos 1370 mm), assumindo que cada banda tem o
 * comprimento inteiro do rolo (40 m → 34 m úteis após 15% de perda).
 *   n_bandas    = ceil(metros_necessarios ÷ 34)
 *   cm_a_cortar = (n_bandas × cut_width_mm) ÷ 10
 */

// [cut_width_mm, metros_necessarios, n_bandas, cm_a_cortar] — valores do PV-00140 + extremos.
const TABELA: Array<[number, number, number, number]> = [
  [20, 2448, 72, 144], // PV-00140 (cut=20)
  [20, 2148, 64, 128],
  [20, 1509.6, 45, 90],
  [20, 384, 12, 24],
  [11, 4216, 124, 136.4], // Costurada 11mm — caso máximo de 1 rolo (4216/34 = 124 exatos)
  [25, 1836, 54, 135], // Tira chata 25mm (1836/34 = 54 exatos)
];

describe('constantes', () => {
  it('valores padrão do rolo e perda', () => {
    expect(ROLO_LARGURA_MM).toBe(1370);
    expect(ROLO_COMPRIMENTO_M).toBe(40);
    expect(PERDA_PCT).toBeCloseTo(0.15, 10);
  });

  it('metros úteis por banda = 40 × 0,85 = 34', () => {
    expect(ROLO_COMPRIMENTO_M * (1 - PERDA_PCT)).toBeCloseTo(34, 10);
  });
});

describe('computeStrapRollCut — tabela do PV-00140', () => {
  for (const [largura, metros, nBandas, cmEsperado] of TABELA) {
    it(`cut ${largura}mm · ${metros}m → ${nBandas} bandas → ${cmEsperado} cm`, () => {
      const r = computeStrapRollCut({ largura_mm: largura, metros_necessarios: metros });

      expect(r.valid).toBe(true);
      expect(r.widthMissing).toBe(false);
      expect(r.metros_uteis_por_banda).toBeCloseTo(34, 10);
      expect(r.n_bandas).toBe(nBandas);
      expect(r.cm_a_cortar).toBeCloseTo(cmEsperado, 6);

      // bate com a derivação manual: ceil(metros / 34) × cut_width ÷ 10.
      const cmManual = (Math.ceil(metros / 34) * largura) / 10;
      expect(r.cm_a_cortar).toBeCloseTo(cmManual, 6);
    });
  }
});

describe('computeStrapRollCut — propriedades', () => {
  it('cm_a_cortar é a LARGURA cortada, não o comprimento percorrido', () => {
    // 1 banda atende até 34 m; precisar de exatamente 34 m ⇒ 1 banda = cut_width mm.
    const r = computeStrapRollCut({ largura_mm: 20, metros_necessarios: 34 });
    expect(r.n_bandas).toBe(1);
    expect(r.cm_a_cortar).toBeCloseTo(2, 6); // 20mm = 2cm (NÃO os 40m de comprimento)
  });

  it('uma banda parcial conta inteira (ceil)', () => {
    const r = computeStrapRollCut({ largura_mm: 20, metros_necessarios: 35 });
    expect(r.n_bandas).toBe(2); // ceil(35/34)
    expect(r.cm_a_cortar).toBeCloseTo(4, 6); // 40mm
  });

  it('n_bandas depende só dos metros; o cm escala com a largura da banda', () => {
    const fino = computeStrapRollCut({ largura_mm: 11, metros_necessarios: 1000 });
    const largo = computeStrapRollCut({ largura_mm: 25, metros_necessarios: 1000 });
    expect(fino.n_bandas).toBe(largo.n_bandas); // mesmo consumo ⇒ mesmas bandas
    expect(fino.cm_a_cortar).toBeLessThan(largo.cm_a_cortar); // banda mais fina ⇒ menos cm
  });

  it('multi-rolos: largura cortada > 1370mm ⇒ rolos > 1 (nota informativa)', () => {
    const r = computeStrapRollCut({ largura_mm: 20, metros_necessarios: 2448 });
    expect(r.cm_a_cortar).toBeCloseTo(144, 6); // 1440mm
    expect(r.rolos).toBeCloseTo(1440 / 1370, 6); // ≈ 1,05 rolos
  });

  it('1 rolo: largura cortada ≤ 1370mm ⇒ rolos ≤ 1', () => {
    const r = computeStrapRollCut({ largura_mm: 11, metros_necessarios: 4216 });
    expect(r.cm_a_cortar).toBeCloseTo(136.4, 6); // 1364mm < 1370mm
    expect(r.rolos).toBeLessThanOrEqual(1);
  });
});

describe('computeStrapRollCut — validações', () => {
  it('largura ausente (NULL) → widthMissing + aviso', () => {
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

  it('largura > 1370mm → inválida, aviso "maior que o rolo"', () => {
    const r = computeStrapRollCut({ largura_mm: 1500, metros_necessarios: 100 });
    expect(r.valid).toBe(false);
    expect(r.widthMissing).toBe(false);
    expect(r.warning).toMatch(/maior que.*rolo/i);
    expect(r.cm_a_cortar).toBe(0);
  });

  it('metros_necessarios = 0 → válida, mas cm_a_cortar 0', () => {
    const r = computeStrapRollCut({ largura_mm: 20, metros_necessarios: 0 });
    expect(r.valid).toBe(true);
    expect(r.n_bandas).toBe(0);
    expect(r.cm_a_cortar).toBe(0);
  });

  it('não há mais aviso "abaixo do mínimo" — largura pequena é válida', () => {
    const r = computeStrapRollCut({ largura_mm: 10, metros_necessarios: 100 });
    expect(r.valid).toBe(true);
    expect(r.widthMissing).toBe(false);
    expect(r.warning).toBeUndefined();
    expect(r.n_bandas).toBe(Math.ceil(100 / 34)); // 3
    expect(r.cm_a_cortar).toBeCloseTo(3, 6); // 3 bandas × 10mm = 30mm = 3cm
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
  it('receita artesanal detecta mesmo com nome que o heurístico excluiria', () => {
    // "Tira Trançada" colide com a regex de comprados-prontos (tranç) e o
    // heurístico a marcaria como NÃO-artesanal. Mas se o grupo é resultado de
    // uma receita cadastrada, ela É artesanal — a receita vence o heurístico.
    expect(isArtisanalStrap({ recipeFlag: true, name: 'Tira Trançada' })).toBe(true);
    expect(isArtisanalStrap({ recipeFlag: true, name: 'OVERLOCK 5MM' })).toBe(true);
  });
  it('receita vence o opt-out por grupo, mas não o opt-out explícito por tira', () => {
    expect(isArtisanalStrap({ recipeFlag: true, groupFlag: false, name: 'x' })).toBe(true);
    expect(isArtisanalStrap({ strapFlag: false, recipeFlag: true, name: 'TIRA NAPA' })).toBe(false);
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
