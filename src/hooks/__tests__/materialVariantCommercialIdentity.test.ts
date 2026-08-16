import { describe, expect, it } from 'vitest';
import { normalizeProductSupplierColor } from '@/hooks/useProducts';
import {
  normalizeMaterialVariantSku,
  normalizeVariantMutation,
} from '@/hooks/useReferenceMaterialVariants';

describe('normalização de identidade comercial', () => {
  it('SKU ignora caixa e espaços só para comparação', () => {
    expect(normalizeMaterialVariantSku('  Ds22-Madri  ')).toBe('ds22-madri');
    expect(normalizeMaterialVariantSku(null)).toBe('');
  });

  it('update parcial de ativação não inventa SKU ausente no payload', () => {
    expect(normalizeVariantMutation({ active: true })).toEqual({ active: true });
    expect(() => normalizeVariantMutation({ active: true, sku: '   ' }))
      .toThrow('SKU é obrigatório');
  });

  it('não trunca silenciosamente SKU maior que o limite fiscal externo', () => {
    expect(() => normalizeVariantMutation({ sku: 'S'.repeat(81) }))
      .toThrow('no máximo 80 caracteres');
    expect(normalizeVariantMutation({ sku: `  ${'S'.repeat(80)}  ` })).toEqual({
      sku: 'S'.repeat(80),
    });
  });

  it('código da cor é aparado e vazio vira NULL', () => {
    expect(normalizeProductSupplierColor({
      supplier_id: 'supplier-1',
      supplier_color_code: '  MAD-047  ',
    }).supplier_color_code).toBe('MAD-047');
    expect(normalizeProductSupplierColor({
      supplier_id: 'supplier-1',
      supplier_color_code: '   ',
    }).supplier_color_code).toBeNull();
  });

  it('rejeita código de cor sem fornecedor', () => {
    expect(() => normalizeProductSupplierColor({
      supplier_id: null,
      supplier_color_code: 'MAD-047',
    })).toThrow('Selecione o fornecedor');
  });

  it('permite patch só do código e deixa o banco validar o fornecedor existente', () => {
    expect(normalizeProductSupplierColor({
      supplier_color_code: '  MAD-047  ',
    })).toEqual({ supplier_color_code: 'MAD-047' });
  });

  it('patch que não contém o campo não o inventa nem limpa', () => {
    const patch = { supplier_id: 'supplier-2' };
    expect(normalizeProductSupplierColor(patch)).toBe(patch);
    expect('supplier_color_code' in normalizeProductSupplierColor(patch)).toBe(false);
  });
});
