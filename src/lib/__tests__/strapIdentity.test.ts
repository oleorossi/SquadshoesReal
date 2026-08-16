import { describe, expect, it } from 'vitest';
import {
  isNominalBuyReadyStrapIdentity,
  NOMINAL_BUY_READY_STRAP_GROUP_IDS,
  NOMINAL_BUY_READY_STRAP_PRODUCT_IDS,
} from '@/lib/strapIdentity';

describe('gate nominal de tiras compradas prontas', () => {
  it('espelha exatamente os 7 produtos e 2 grupos decididos na migração 044', () => {
    expect(NOMINAL_BUY_READY_STRAP_PRODUCT_IDS).toEqual([
      '9962fc0e-e95c-4e0a-8162-1a21c79f64dc',
      'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5',
      '9028a544-5de5-4798-a37b-edc3b51e82f3',
      '4a60b9c5-eacd-4cd8-82de-b8176ee217b2',
      'e7056d1b-28a3-462a-b3af-f28d298194b8',
      '6e958e62-fc9d-4bdd-be01-43561adc5b36',
      'd47aaf48-644c-473d-b903-8f289270555b',
    ]);
    expect(NOMINAL_BUY_READY_STRAP_GROUP_IDS).toEqual([
      'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
      '6e43bbda-0f1f-412c-8d4a-ec009114530d',
    ]);
    NOMINAL_BUY_READY_STRAP_PRODUCT_IDS.forEach((id) => {
      expect(isNominalBuyReadyStrapIdentity(id, null)).toBe(true);
    });
    NOMINAL_BUY_READY_STRAP_GROUP_IDS.forEach((id) => {
      expect(isNominalBuyReadyStrapIdentity(null, id)).toBe(true);
    });
  });

  it('não promove produto por nome, cor ou UUID fora da allow-list', () => {
    expect(isNominalBuyReadyStrapIdentity('00000000-0000-4000-8000-000000000000', null)).toBe(false);
    expect(isNominalBuyReadyStrapIdentity(null, '00000000-0000-4000-8000-000000000000')).toBe(false);
    expect(isNominalBuyReadyStrapIdentity(null, null)).toBe(false);
  });
});
