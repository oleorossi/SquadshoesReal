import { describe, expect, it } from 'vitest';
import { buildArtisanalStrapMeasureHubPayload } from '@/lib/saveArtisanalStrapMeasureHubFields';

describe('buildArtisanalStrapMeasureHubPayload', () => {
  it('omite chaves não informadas e preserva null para zerar preço', () => {
    expect(buildArtisanalStrapMeasureHubPayload({
      precoPrestadorPerM: 0.32,
    })).toEqual({ preco_prestador_per_m: 0.32 });

    expect(buildArtisanalStrapMeasureHubPayload({
      precoArtesanalPerM: null,
    })).toEqual({ preco_artesanal_per_m: null });

    expect(buildArtisanalStrapMeasureHubPayload({
      origemPadrao: 'escolhe_no_pv',
      precoArtesanalPerM: 0.8,
      precoPrestadorPerM: null,
    })).toEqual({
      origem_padrao: 'escolhe_no_pv',
      preco_artesanal_per_m: 0.8,
      preco_prestador_per_m: null,
    });
  });
});
