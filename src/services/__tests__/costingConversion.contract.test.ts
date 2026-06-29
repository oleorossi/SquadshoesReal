import { describe, it, expect } from 'vitest';

/**
 * CONTRATO DO CUSTEIO ↔ SQL convert_to_product_unit
 *
 * Espelha em TypeScript a função PL/pgSQL public.convert_to_product_unit(qty, src, tgt)
 * — fonte: supabase/migrations/20260627125000_convert-to-product-unit-null-on-mismatch.sql.
 *
 * Por quê: o custeio (calculate_order_cost_item) chama essa função ANTES de
 * multiplicar `required × unit_price`. Se a conversão divergir (ou voltar a
 * devolver o valor cru em vez de NULL na incompatibilidade), o custo infla/
 * deflaciona até 1000× — bug histórico CRÍTICO da COLA (sole_standard_items em
 * `g` multiplicados por unit_price em `R$/kg`). Este teste TRAVA o contrato:
 *  - g↔kg, ml↔L, cm↔m, dm²↔m²/cm², contagem → fatores exatos;
 *  - kinds incompatíveis (massa↔contagem etc.) → NULL (caller pula a linha);
 *  - mesma unidade / unidade vazia / qty NULL → casos-base;
 *  - unidade desconhecida → devolve cru (compatibilidade com cadastros legados).
 *
 * Se a migration SQL mudar a tabela de fatores, este mirror deve mudar junto —
 * a divergência é o sinal de regressão.
 */

/** Porta 1:1 da SQL convert_to_product_unit. NULL = incompatível (caller trata). */
function convertToProductUnit(
  qty: number | null,
  sourceUnit: string | null | undefined,
  targetUnit: string | null | undefined,
): number | null {
  const src = (sourceUnit ?? '').trim().toLowerCase();
  const tgt = (targetUnit ?? '').trim().toLowerCase();

  if (qty === null || qty === undefined) return 0;
  if (src === tgt || src === '' || tgt === '') return qty;

  const pair = `${src}->${tgt}`;
  const factors: Record<string, number> = {
    // massa
    'g->kg': 1 / 1000, 'mg->kg': 1 / 1_000_000, 'mg->g': 1 / 1000,
    'kg->g': 1000, 'kg->mg': 1_000_000, 'g->mg': 1000,
    // volume
    'ml->l': 1 / 1000, 'l->ml': 1000,
    // comprimento
    'cm->m': 1 / 100, 'm->cm': 100, 'mm->m': 1 / 1000, 'm->mm': 1000,
    'mm->cm': 1 / 10, 'cm->mm': 10,
    // área
    'dm²->m²': 1 / 100, 'm²->dm²': 100, 'cm²->dm²': 1 / 100, 'dm²->cm²': 100,
    'cm²->m²': 1 / 10000, 'm²->cm²': 10000, 'mm²->cm²': 1 / 100, 'cm²->mm²': 100,
    'mm²->dm²': 1 / 10000, 'mm²->m²': 1 / 1_000_000,
    // contagem
    'mil->un': 1000, 'un->mil': 1 / 1000, 'cento->un': 100, 'un->cento': 1 / 100,
    'dz->un': 12, 'un->dz': 1 / 12, 'cento->mil': 1 / 10, 'mil->cento': 10,
  };
  if (pair in factors) return qty * factors[pair];

  const kindOf = (u: string): string => {
    if (['g', 'mg', 'kg'].includes(u)) return 'mass';
    if (['ml', 'l'].includes(u)) return 'volume';
    if (['mm', 'cm', 'm'].includes(u)) return 'length';
    if (['mm²', 'cm²', 'dm²', 'm²'].includes(u)) return 'area';
    if (['un', 'mil', 'cento', 'dz', 'par'].includes(u)) return 'count';
    return 'unknown';
  };
  const sk = kindOf(src);
  const tk = kindOf(tgt);

  // Incompatível (kinds conhecidos e diferentes) → NULL: força tratamento no caller.
  if (sk !== tk && sk !== 'unknown' && tk !== 'unknown') return null;

  // Desconhecido → cru (compat com cadastros não-padrão antigos).
  return qty;
}

describe('convert_to_product_unit — contrato de custeio (mirror SQL)', () => {
  describe('massa (cola/químicos) — g↔kg é onde mora o bug 1000×', () => {
    it('25 g → 0.025 kg (NÃO multiplica por 1000)', () => {
      expect(convertToProductUnit(25, 'g', 'kg')).toBeCloseTo(0.025, 9);
    });
    it('23330 g (cola PVC × pares) → 23.33 kg', () => {
      // sole_standard_items: 23,33 g/par × 1000 pares = 23330 g
      expect(convertToProductUnit(23330, 'g', 'kg')).toBeCloseTo(23.33, 6);
    });
    it('REGRESSÃO: sem conversão, 23330 g tratados como kg = 1000× a mais', () => {
      const correto = convertToProductUnit(23330, 'g', 'kg')!;
      const cru = 23330; // o que aconteceria se a fn devolvesse p_qty cru
      expect(cru / correto).toBeCloseTo(1000, 3);
    });
    it('1.5 kg → 1500 g; 2 g → 2000 mg', () => {
      expect(convertToProductUnit(1.5, 'kg', 'g')).toBeCloseTo(1500, 6);
      expect(convertToProductUnit(2, 'g', 'mg')).toBeCloseTo(2000, 6);
    });
  });

  describe('volume / comprimento / área', () => {
    it('volume: 250 ml → 0.25 L; 1 L → 1000 ml', () => {
      expect(convertToProductUnit(250, 'ml', 'l')).toBeCloseTo(0.25, 9);
      expect(convertToProductUnit(1, 'l', 'ml')).toBeCloseTo(1000, 6);
    });
    it('comprimento: 110 cm → 1.1 m (tiras); 1.5 m → 1500 mm', () => {
      expect(convertToProductUnit(110, 'cm', 'm')).toBeCloseTo(1.1, 9);
      expect(convertToProductUnit(1.5, 'm', 'mm')).toBeCloseTo(1500, 6);
    });
    it('área: 78 dm² → 0.78 m²; 5 dm² → 500 cm²', () => {
      expect(convertToProductUnit(78, 'dm²', 'm²')).toBeCloseTo(0.78, 9);
      expect(convertToProductUnit(5, 'dm²', 'cm²')).toBeCloseTo(500, 6);
    });
    it('contagem: 2 dz → 24 un; 3000 un → 3 mil', () => {
      expect(convertToProductUnit(2, 'dz', 'un')).toBeCloseTo(24, 9);
      expect(convertToProductUnit(3000, 'un', 'mil')).toBeCloseTo(3, 9);
    });
  });

  describe('incompatibilidade → NULL (caller pula a linha, não infla custo)', () => {
    it('kg → un (massa → contagem) = NULL', () => {
      expect(convertToProductUnit(10, 'kg', 'un')).toBeNull();
    });
    it('dm² → m (área → comprimento) = NULL — dispara fallback A4 no custeio', () => {
      expect(convertToProductUnit(78, 'dm²', 'm')).toBeNull();
    });
    it('cm → kg (comprimento → massa) = NULL', () => {
      expect(convertToProductUnit(100, 'cm', 'kg')).toBeNull();
    });
    it('ml → un (volume → contagem) = NULL', () => {
      expect(convertToProductUnit(500, 'ml', 'un')).toBeNull();
    });
  });

  describe('casos-base', () => {
    it('mesma unidade devolve o valor (kg → kg)', () => {
      expect(convertToProductUnit(42, 'kg', 'kg')).toBe(42);
    });
    it('unidade de origem vazia/null devolve cru (sem unidade de consumo)', () => {
      expect(convertToProductUnit(7, '', 'kg')).toBe(7);
      expect(convertToProductUnit(7, null, 'kg')).toBe(7);
    });
    it('unidade de destino vazia devolve cru', () => {
      expect(convertToProductUnit(7, 'g', '')).toBe(7);
    });
    it('qty null → 0 (não NULL)', () => {
      expect(convertToProductUnit(null, 'g', 'kg')).toBe(0);
    });
    it('unidade desconhecida (rolo) → devolve cru, NÃO NULL', () => {
      expect(convertToProductUnit(3, 'rolo', 'kg')).toBe(3);
      expect(convertToProductUnit(3, 'g', 'rolo')).toBe(3);
    });
    it('case/trim-insensível: " KG " → "kg"', () => {
      expect(convertToProductUnit(2, ' KG ', 'g')).toBeCloseTo(2000, 6);
    });
  });
});
