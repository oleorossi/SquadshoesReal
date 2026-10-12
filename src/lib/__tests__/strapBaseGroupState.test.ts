import { describe, expect, it } from 'vitest';
import {
  strapBaseGroupBlamesSheet,
  strapBaseGroupDependsOnPreview,
  strapBaseGroupState,
} from '@/lib/strapBaseGroupState';

const FOLLOW_REFERENCE = {
  identity_basis: 'reference_base' as const,
  identity_group_id: null,
  color_mode: 'follow_main' as const,
  material_mode: 'follow_reference' as const,
  material_group_id: null,
  allowed_material_group_ids: [],
};
const FIXED_GROUP = {
  ...FOLLOW_REFERENCE,
  material_mode: 'fixed_group' as const,
  material_group_id: '11111111-1111-4111-8111-111111111111',
};
const SELECT_ON_ORDER = {
  ...FOLLOW_REFERENCE,
  material_mode: 'select_on_order' as const,
  allowed_material_group_ids: ['11111111-1111-4111-8111-111111111111'],
};
const FINISHED_GROUP = {
  ...FOLLOW_REFERENCE,
  identity_basis: 'finished_product_group' as const,
  identity_group_id: '22222222-2222-4222-8222-222222222222',
};
const PREVIEW_LINE = { baseGroupId: '33333333-3333-4333-8333-333333333333' };

describe('strapBaseGroupDependsOnPreview', () => {
  it('só a tira que segue a referência depende do servidor', () => {
    expect(strapBaseGroupDependsOnPreview(FOLLOW_REFERENCE)).toBe(true);
    expect(strapBaseGroupDependsOnPreview(FIXED_GROUP)).toBe(false);
    expect(strapBaseGroupDependsOnPreview(SELECT_ON_ORDER)).toBe(false);
    expect(strapBaseGroupDependsOnPreview(FINISHED_GROUP)).toBe(false);
  });
});

describe('strapBaseGroupState', () => {
  it('napa resolvida é resolved, independentemente do preview', () => {
    expect(strapBaseGroupState({
      line: FOLLOW_REFERENCE,
      identityResolved: true,
      previewLine: null,
      previewSettled: false,
    })).toBe('resolved');
  });

  it('preview ainda não respondeu NÃO acusa a ficha', () => {
    const state = strapBaseGroupState({
      line: FOLLOW_REFERENCE,
      identityResolved: false,
      previewLine: null,
      previewSettled: false,
    });
    expect(state).toBe('pending');
    expect(strapBaseGroupBlamesSheet(state)).toBe(false);
  });

  it('preview respondeu sem linha para a tira: âmbar, nunca cadastro', () => {
    const state = strapBaseGroupState({
      line: FOLLOW_REFERENCE,
      identityResolved: false,
      previewLine: undefined,
      previewSettled: true,
    });
    expect(state).toBe('preview_missing');
    expect(strapBaseGroupBlamesSheet(state)).toBe(false);
  });

  it('falha de rede não é ficha incompleta', () => {
    const state = strapBaseGroupState({
      line: FOLLOW_REFERENCE,
      identityResolved: false,
      previewLine: null,
      previewSettled: true,
      previewFailed: true,
    });
    expect(state).toBe('preview_missing');
    expect(strapBaseGroupBlamesSheet(state)).toBe(false);
  });

  // O alarme verdadeiro continua de pé: NAPA SANTORINE e NAPA SOFT COM PU 600
  // são inelegíveis como matéria-prima de tira (medido em 12/10/2026) e o
  // servidor devolve a linha com napa nula.
  it('preview respondeu com napa nula: aí sim é cadastro', () => {
    const state = strapBaseGroupState({
      line: FOLLOW_REFERENCE,
      identityResolved: false,
      previewLine: { baseGroupId: null },
      previewSettled: true,
    });
    expect(state).toBe('unresolved');
    expect(strapBaseGroupBlamesSheet(state)).toBe(true);
  });

  it('o que não depende do preview acusa na hora, sem esperar servidor', () => {
    for (const line of [FIXED_GROUP, SELECT_ON_ORDER, FINISHED_GROUP]) {
      const state = strapBaseGroupState({
        line,
        identityResolved: false,
        previewLine: null,
        previewSettled: false,
      });
      expect(state).toBe('unresolved');
      expect(strapBaseGroupBlamesSheet(state)).toBe(true);
    }
  });

  it('linha resolvida pelo preview fecha o ciclo', () => {
    expect(strapBaseGroupState({
      line: FOLLOW_REFERENCE,
      identityResolved: true,
      previewLine: PREVIEW_LINE,
      previewSettled: true,
    })).toBe('resolved');
  });
});
