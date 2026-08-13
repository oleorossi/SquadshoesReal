import { describe, expect, it } from 'vitest';
import { ArtisanalMaterialPurchaseBlockedError } from './materialAutoPO';

describe('ArtisanalMaterialPurchaseBlockedError', () => {
  it('orienta OS e nunca uma OC para material artesanal', () => {
    const error = new ArtisanalMaterialPurchaseBlockedError('TIRA ARTESANAL');
    expect(error.name).toBe('ArtisanalMaterialPurchaseBlockedError');
    expect(error.message).toMatch(/não pode gerar OC automática/i);
    expect(error.message).toMatch(/OS de produção artesanal/i);
  });
});
