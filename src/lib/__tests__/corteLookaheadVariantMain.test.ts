import { describe, expect, it } from 'vitest';
import { resolveCorteMaterialPins } from '@/lib/corteLookahead';

/**
 * Precedência de material da Fila de Corte = a dos resolvedores SQL.
 *
 * Teste de COMPORTAMENTO, não de texto: o contrato que lia só o arquivo da
 * migration passava verde enquanto a função viva perdia a guarda (lição do
 * CLAUDE.md). Aqui a função é chamada de verdade.
 */

const GLOW = 'grupo-glow-metalic';
const NAPA = 'grupo-napa-soft';
const PIN_FICHA = 'produto-pin-da-ficha';
const PIN_VARIANTE = 'produto-pin-da-variante';

/** Caso vivo medido em 13/10/2026: ficha S300 + variante GLOW METALIC. */
const SHEET_S300 = {
  upper_material_product_id: null,
  upper_material_group_id: NAPA,
  lining_material_product_id: null,
  insole_material: '',
  insole_plate_product: null,
  variant_drives_upper: true,
  variant_drives_lining: true,
};

const VARIANTE_GLOW = {
  upper_material_product_id: null,
  upper_material_group_id: null,
  lining_material_product_id: null,
  lining_material_group_id: null,
  insole_material_product_id: null,
  insole_material_group_id: null,
  main_material_group_id: GLOW,
};

describe('resolveCorteMaterialPins — espelho dos resolvedores do motor', () => {
  it('cabedal: ficha delega à variante e a variante só tem main → usa o main', () => {
    const pins = resolveCorteMaterialPins({
      sector: 'Corte Cabedal',
      sheet: SHEET_S300,
      variant: VARIANTE_GLOW,
    });
    // Era aqui que a Fila caía em NAPA SOFT (grupo da ficha) e mandava cortar
    // a napa errada, enquanto o motor resolvia GLOW METALIC por `variant_main`.
    expect(pins.groupId).toBe(GLOW);
    expect(pins.productId).toBeNull();
  });

  it('forração: mesmo ramo, pela flag própria da forração', () => {
    const pins = resolveCorteMaterialPins({
      sector: 'Corte Forração',
      sheet: SHEET_S300,
      variant: VARIANTE_GLOW,
    });
    expect(pins.groupId).toBe(GLOW);
  });

  it('o main NÃO entra quando a ficha não delega o componente', () => {
    const pins = resolveCorteMaterialPins({
      sector: 'Corte Cabedal',
      sheet: { ...SHEET_S300, variant_drives_upper: false },
      variant: VARIANTE_GLOW,
    });
    expect(pins.groupId).toBe(NAPA);
  });

  it('grupo da variante vence o main', () => {
    const pins = resolveCorteMaterialPins({
      sector: 'Corte Cabedal',
      sheet: SHEET_S300,
      variant: { ...VARIANTE_GLOW, upper_material_group_id: NAPA },
    });
    expect(pins.groupId).toBe(NAPA);
  });

  it('pin da variante vence tudo', () => {
    const pins = resolveCorteMaterialPins({
      sector: 'Corte Cabedal',
      sheet: SHEET_S300,
      variant: { ...VARIANTE_GLOW, upper_material_product_id: PIN_VARIANTE },
    });
    expect(pins.productId).toBe(PIN_VARIANTE);
    expect(pins.groupId).toBeNull();
  });

  it('⚠ pin da FICHA é fallback TARDIO: perde do grupo da variante e do main', () => {
    // Divergência nº 2 do gate SQL, que existia igual aqui porque o chamador
    // tenta `productId` antes de `groupId`. Por isso a precedência inteira mora
    // no resolvedor e quem resolveu por grupo devolve productId null.
    const pins = resolveCorteMaterialPins({
      sector: 'Corte Cabedal',
      sheet: { ...SHEET_S300, upper_material_product_id: PIN_FICHA },
      variant: VARIANTE_GLOW,
    });
    expect(pins.groupId).toBe(GLOW);
    expect(pins.productId).toBeNull();
  });

  it('pin da ficha vale quando a variante não resolve nada', () => {
    const pins = resolveCorteMaterialPins({
      sector: 'Corte Cabedal',
      sheet: { ...SHEET_S300, upper_material_product_id: PIN_FICHA },
      variant: { ...VARIANTE_GLOW, main_material_group_id: null },
    });
    expect(pins.productId).toBe(PIN_FICHA);
  });

  it('sem variante: cai no pin e no grupo da ficha, como antes', () => {
    expect(
      resolveCorteMaterialPins({ sector: 'Corte Cabedal', sheet: SHEET_S300, variant: null }).groupId,
    ).toBe(NAPA);
    expect(
      resolveCorteMaterialPins({
        sector: 'Corte Cabedal',
        sheet: { ...SHEET_S300, upper_material_product_id: PIN_FICHA },
        variant: null,
      }).productId,
    ).toBe(PIN_FICHA);
  });

  it('⚠ PALMILHA não tem ramo main — `variant_drives_insole` foi removida do banco', () => {
    // mig 20261027120800_drop-variant-drives-insole. Dar ramo `main` à palmilha
    // "por simetria" poria a tela à frente de resolve_insole_material_for_variant.
    const pins = resolveCorteMaterialPins({
      sector: 'Corte Palmilha',
      sheet: SHEET_S300,
      variant: VARIANTE_GLOW,
    });
    expect(pins.groupId).toBeNull();
    expect(pins.productId).toBeNull();
  });

  it('forração não tem grupo na ficha: sem variante devolve null e o chamador casa por nome', () => {
    const pins = resolveCorteMaterialPins({
      sector: 'Corte Forração',
      sheet: SHEET_S300,
      variant: null,
    });
    expect(pins.groupId).toBeNull();
  });
});
