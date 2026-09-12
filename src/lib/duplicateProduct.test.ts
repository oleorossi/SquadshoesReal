import { describe, expect, it } from 'vitest';
import { copySkuCandidates } from './productSku';
import {
  artisanalBlockReason,
  buildDuplicateCatalog,
  copiedColor,
  copiedName,
  variantLineEnforcesUniqueColor,
} from './duplicateProduct';

describe('copySkuCandidates', () => {
  it('sufixa -COPIA e incrementa', () => {
    expect(copySkuCandidates('NAPA-PRET')).toEqual([
      'NAPA-PRET-COPIA',
      'NAPA-PRET-COPIA2',
      'NAPA-PRET-COPIA3',
      'NAPA-PRET-COPIA4',
      'NAPA-PRET-COPIA5',
      'NAPA-PRET-COPIA6',
      'NAPA-PRET-COPIA7',
      'NAPA-PRET-COPIA8',
      'NAPA-PRET-COPIA9',
    ]);
  });

  it('não empilha -COPIA em cima de outra cópia', () => {
    expect(copySkuCandidates('NAPA-PRET-COPIA')[0]).toBe('NAPA-PRET-COPIA');
    expect(copySkuCandidates('NAPA-PRET-COPIA3')[0]).toBe('NAPA-PRET-COPIA');
  });
});

describe('copiedColor', () => {
  it('mantém a cor fora da linha com variantes', () => {
    expect(copiedColor('PRETO', false)).toEqual({ color: 'PRETO', colorSuffixed: false });
  });

  it('sufixa CÓPIA na linha com variantes', () => {
    expect(copiedColor('PRETO', true)).toEqual({ color: 'PRETO CÓPIA', colorSuffixed: true });
  });

  it('incrementa CÓPIA já existente', () => {
    expect(copiedColor('PRETO CÓPIA', true)).toEqual({ color: 'PRETO CÓPIA2', colorSuffixed: true });
    expect(copiedColor('PRETO CÓPIA2', true)).toEqual({ color: 'PRETO CÓPIA3', colorSuffixed: true });
  });

  it('cor vazia não inventa sufixo', () => {
    expect(copiedColor('', true)).toEqual({ color: '', colorSuffixed: false });
    expect(copiedColor(null, true)).toEqual({ color: '', colorSuffixed: false });
  });
});

describe('copiedName', () => {
  it('troca o sufixo de cor no nome', () => {
    expect(copiedName('NAPA MADRID PRETO', 'PRETO', 'PRETO CÓPIA')).toBe('NAPA MADRID PRETO CÓPIA');
    expect(copiedName('NAPA MADRID: PRETO', 'PRETO', 'PRETO CÓPIA')).toBe('NAPA MADRID: PRETO CÓPIA');
  });

  it('não mexe quando a cor não está no nome', () => {
    expect(copiedName('NAPA MADRID', 'PRETO', 'PRETO CÓPIA')).toBe('NAPA MADRID');
  });
});

describe('variantLineEnforcesUniqueColor', () => {
  it('vale só em linha com variantes não agnóstica', () => {
    expect(variantLineEnforcesUniqueColor({ shared_specs: true })).toBe(true);
    expect(variantLineEnforcesUniqueColor({ is_bom_color_source: true })).toBe(true);
    expect(variantLineEnforcesUniqueColor({ shared_specs: true, is_color_agnostic: true })).toBe(false);
    expect(variantLineEnforcesUniqueColor({ name: 'COLA' })).toBe(false);
    expect(variantLineEnforcesUniqueColor(null)).toBe(false);
  });
});

describe('artisanalBlockReason', () => {
  it('recusa tira artesanal do produto ou do grupo', () => {
    expect(artisanalBlockReason({ is_artisanal: true }, null)).toMatch(/Hub de Tiras/);
    expect(artisanalBlockReason({}, { is_artisanal_strap: true })).toMatch(/Hub de Tiras/);
    expect(artisanalBlockReason({ is_artisanal: false }, { is_artisanal_strap: false })).toBeNull();
  });
});

describe('buildDuplicateCatalog', () => {
  it('zera saldo e omite identidade física', () => {
    const payload = buildDuplicateCatalog({
      id: 'src',
      sku: 'NAPA-PRET',
      name: 'NAPA MADRID PRETO',
      color: 'PRETO',
      category: 'Cabedal',
      unit: 'm',
      unit_price: 12.5,
      quantity: 80,
      reserved_stock: 10,
      current_stock: 80,
      stock_grade: { '34': 4 },
      blocked_qty: 1,
      quarantine_qty: 2,
      gestaoclick_id: 'gc-1',
      strap_migration_status: 'done',
      search_norm: 'napamadridpreto',
      group_id: 'g1',
      location: 'Almoxarifado A',
    }, { sku: 'NAPA-PRET-COPIA', color: 'PRETO CÓPIA', name: 'NAPA MADRID PRETO CÓPIA' });

    expect(payload.quantity).toBe(0);
    expect(payload.reserved_stock).toBe(0);
    expect(payload.current_stock).toBe(0);
    expect(payload.blocked_qty).toBe(0);
    expect(payload.quarantine_qty).toBe(0);
    expect(payload.stock_grade).toEqual({});
    expect(payload.sku).toBe('NAPA-PRET-COPIA');
    expect(payload.color).toBe('PRETO CÓPIA');
    expect(payload.name).toBe('NAPA MADRID PRETO CÓPIA');
    expect(payload.unit_price).toBe(12.5);
    expect(payload.group_id).toBe('g1');
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('gestaoclick_id');
    expect(payload).not.toHaveProperty('search_norm');
    expect(payload).not.toHaveProperty('strap_migration_status');
  });
});
