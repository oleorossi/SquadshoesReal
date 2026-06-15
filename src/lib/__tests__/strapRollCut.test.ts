import { describe, it, expect } from 'vitest';
import {
  computeStrapRollCut,
  isArtisanalStrap,
  normalizeWidthToMm,
  ROLO_LARGURA_MM,
  ROLO_COMPRIMENTO_M,
  KERF_MM,
  PERDA_PCT,
} from '@/lib/strapRollCut';

/**
 * GATE da fórmula de corte do rolo (tiras artesanais).
 *
 * Fórmula (confirmada pelo Leonardo em 2026-06-14): cada banda de `cut_width_mm`
 * cortada ao longo da LARGURA do rolo vira UMA tira pronta.
 *   tiras_por_rolo = floor(1370 ÷ cut_width_mm)
 *   metros_uteis   = tiras_por_rolo × 40 × 0,85   // 15% de perda
 */

// [cut_width_mm, tiras_por_rolo, metros_uteis] — receitas reais + limites do rolo.
// (15% de perda: metros_uteis = tiras × 40 × 0,85.)
const TABELA: Array<[number, number, number]> = [
  [11, 124, 4216], // Tira chata Costurada 11mm (cut=11)
  [20, 68, 2312], // Tira Overlock 5mm / Tira chata 8mm (cut=20)
  [23, 59, 2006], // TRANÇA (cut=23)
  [25, 54, 1836], // Tira chata 25mm (cut=25)
  [685, 2, 68], // metade da largura do rolo → 2 bandas
  [1370, 1, 34], // banda = rolo inteiro → 1 tira
];

describe('constantes', () => {
  it('valores padrão do rolo e perda', () => {
    expect(ROLO_LARGURA_MM).toBe(1370);
    expect(ROLO_COMPRIMENTO_M).toBe(40);
    expect(PERDA_PCT).toBeCloseTo(0.15, 10);
  });

  it('sem kerf (descartado pelo Leonardo)', () => {
    expect(KERF_MM).toBe(0);
  });
});

describe('computeStrapRollCut — tabela do Leonardo', () => {
  for (const [largura, tirasEsperadas, metrosUteisEsperado] of TABELA) {
    it(`largura ${largura}mm → ${tirasEsperadas} tiras → ${metrosUteisEsperado} m`, () => {
      // metros_necessarios arbitrário > 0 para também validar cm_a_cortar.
      const metros = 100;
      const r = computeStrapRollCut({ largura_mm: largura, metros_necessarios: metros });

      expect(r.valid).toBe(true);
      expect(r.widthMissing).toBe(false);
      expect(r.tiras_por_rolo).toBe(tirasEsperadas);

      // metros_uteis cravado na tabela do Leonardo (15% de perda).
      expect(r.metros_uteis_rolo).toBeCloseTo(metrosUteisEsperado, 6);
      // e bate com a derivação manual tiras × 40 × 0,85.
      expect(r.metros_uteis_rolo).toBeCloseTo(tirasEsperadas * 40 * 0.85, 6);

      // cm_a_cortar = (metros × 4000) ÷ metros_uteis
      const cmManual = (metros * 4000) / metrosUteisEsperado;
      expect(r.cm_a_cortar).toBeCloseTo(cmManual, 6);
    });
  }
});

describe('computeStrapRollCut — propriedades', () => {
  it('rolo cheio: precisar de metros_uteis de tira ⇒ cortar o rolo inteiro (4000 cm)', () => {
    const r1 = computeStrapRollCut({ largura_mm: 20, metros_necessarios: 0 });
    const cheio = computeStrapRollCut({ largura_mm: 20, metros_necessarios: r1.metros_uteis_rolo });
    expect(cheio.cm_a_cortar).toBeCloseTo(4000, 6);
  });

  it('metade do rendimento ⇒ metade do rolo (2000 cm)', () => {
    const r1 = computeStrapRollCut({ largura_mm: 20, metros_necessarios: 0 });
    const metade = computeStrapRollCut({ largura_mm: 20, metros_necessarios: r1.metros_uteis_rolo / 2 });
    expect(metade.cm_a_cortar).toBeCloseTo(2000, 6);
  });

  it('largura no limite do rolo (1370mm) é válida → 1 tira', () => {
    const r = computeStrapRollCut({ largura_mm: ROLO_LARGURA_MM, metros_necessarios: 50 });
    expect(r.valid).toBe(true);
    expect(r.tiras_por_rolo).toBe(1);
  });

  it('tiras_por_rolo = floor(1370 / cut_width)', () => {
    for (const [largura, tiras] of TABELA) {
      expect(Math.floor(ROLO_LARGURA_MM / largura)).toBe(tiras);
    }
  });

  it('largura menor ⇒ mais tiras (monotonicidade inversa)', () => {
    const fino = computeStrapRollCut({ largura_mm: 11, metros_necessarios: 0 });
    const largo = computeStrapRollCut({ largura_mm: 25, metros_necessarios: 0 });
    expect(fino.tiras_por_rolo).toBeGreaterThan(largo.tiras_por_rolo);
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

  it('largura pequena (< 21mm) agora é VÁLIDA — vira muitas tiras', () => {
    const r = computeStrapRollCut({ largura_mm: 10, metros_necessarios: 100 });
    expect(r.valid).toBe(true);
    expect(r.widthMissing).toBe(false);
    expect(r.warning).toBeUndefined();
    expect(r.tiras_por_rolo).toBe(137); // floor(1370 / 10)
  });

  it('largura acima da largura do rolo (> 1370mm) → inválida', () => {
    const r = computeStrapRollCut({ largura_mm: 1500, metros_necessarios: 100 });
    expect(r.valid).toBe(false);
    expect(r.warning).toMatch(/excede/i);
  });

  it('metros_necessarios = 0 → calcula rendimento mas cm_a_cortar 0', () => {
    const r = computeStrapRollCut({ largura_mm: 20, metros_necessarios: 0 });
    expect(r.valid).toBe(true);
    expect(r.tiras_por_rolo).toBe(68);
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
