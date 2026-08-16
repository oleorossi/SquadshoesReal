import { describe, expect, it } from 'vitest';
import { getMaterialVariantReadinessIssue } from '@/lib/saleOrderCommercialReadiness';

describe('prontidão comercial da variação de material', () => {
  it('bloqueia item novo sem variação quando a referência oferece materiais', () => {
    expect(getMaterialVariantReadinessIssue({
      itemNumber: 2,
      activeVariantCount: 3,
      materialVariantId: null,
    })).toEqual({ type: 'error', message: 'Item 2: selecione o grupo de material' });
  });

  it('mantém item histórico editável e emite aviso', () => {
    expect(getMaterialVariantReadinessIssue({
      itemNumber: 1,
      itemId: 'item-historico',
      activeVariantCount: 2,
      materialVariantId: null,
    })).toEqual({ type: 'warning', message: 'Item 1: sem grupo de material' });
  });

  it('não emite pendência quando não há escolha ou a variação foi selecionada', () => {
    expect(getMaterialVariantReadinessIssue({ itemNumber: 1, activeVariantCount: 0 })).toBeNull();
    expect(getMaterialVariantReadinessIssue({
      itemNumber: 1,
      activeVariantCount: 2,
      materialVariantId: 'variant-1',
    })).toBeNull();
  });
});
