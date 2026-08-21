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

  it('material da ficha oferecido no seletor conta como escolha (SR02, 21/08/2026)', () => {
    // Item NOVO, referência COM variante e material_variant_id nulo: antes era
    // erro bloqueante. Com o material da ficha oferecido como opção, nulo passa
    // a significar "material da ficha" — que é exatamente o que o usuário
    // escolheu na tela ("NAPA SOFT · da ficha") e o PV recusava salvar.
    expect(getMaterialVariantReadinessIssue({
      itemNumber: 9,
      activeVariantCount: 1,
      materialVariantId: null,
      sheetMaterialSelectable: true,
    })).toBeNull();
  });

  it('sem a opção da ficha, item novo sem variante continua bloqueando', () => {
    expect(getMaterialVariantReadinessIssue({
      itemNumber: 9,
      activeVariantCount: 1,
      materialVariantId: null,
      sheetMaterialSelectable: false,
    })).toEqual({ type: 'error', message: 'Item 9: selecione o grupo de material' });
  });
});
