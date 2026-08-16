import { describe, expect, it } from 'vitest';
import { normalizeArtisanalStrapVariant } from '@/hooks/useArtisanalStraps';
import { isPurchasedReadyStrap, strapIdentityBasis } from '@/lib/strapIdentity';

describe('normalizeArtisanalStrapVariant', () => {
  it('preserva o contrato legado como reference_base com produção interna', () => {
    const normalized = normalizeArtisanalStrapVariant({
      id: 'variant-legacy',
      base_group_id: 'group-soft',
    });

    expect(normalized.identity_basis).toBe('reference_base');
    expect(normalized.internal_production_enabled).toBe(true);
    expect(normalized.base_group_id).toBe('group-soft');
  });

  it('preserva a capacidade explícita da tira comprada pronta', () => {
    const normalized = normalizeArtisanalStrapVariant({
      id: 'variant-strass',
      base_group_id: 'group-strass',
      identity_basis: 'finished_product_group',
      internal_production_enabled: false,
    });

    expect(normalized.identity_basis).toBe('finished_product_group');
    expect(normalized.internal_production_enabled).toBe(false);
  });

  it('mantém reference_base sem produção interna como compra fixa sem trocar sua base', () => {
    const normalized = normalizeArtisanalStrapVariant({
      id: 'variant-commercial-only',
      base_group_id: 'group-soft',
      identity_basis: 'reference_base',
      internal_production_enabled: false,
    });

    expect(strapIdentityBasis(normalized)).toBe('reference_base');
    expect(isPurchasedReadyStrap(normalized)).toBe(true);
    expect(normalized.base_group_id).toBe('group-soft');
  });
});
