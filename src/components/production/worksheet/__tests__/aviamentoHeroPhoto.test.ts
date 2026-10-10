import { describe, it, expect } from 'vitest';
import type { SoleSilkGroup } from '../../SilkMontageWorkSheet';
import {
  aviamentoGroupKey,
  aviamentoGroupHasResolvablePhoto,
  pickAviamentoHeroPhotoSources,
  listAviamentoHeroEligibleGroups,
} from '../aviamentoHeroPhoto';

function group(partial: Partial<SoleSilkGroup> & { soleName: string }): SoleSilkGroup {
  return {
    totalPairs: 12,
    groupKind: 'reference',
    colorGroups: [],
    ...partial,
  };
}

describe('aviamentoHeroPhoto helpers', () => {
  it('chave estável: prefira sheetId de refImages; senão soleName', () => {
    expect(aviamentoGroupKey(group({
      soleName: 'G01',
      colorGroups: [{
        color: 'DÁLIA',
        combinedGrid: {},
        totalPairs: 12,
        opNumbers: [],
        refImages: [{ sheetId: 'sheet-g01', variantImageUrl: 'https://cdn/x.jpg' }],
      }],
    }))).toBe('sheet-g01');

    expect(aviamentoGroupKey(group({
      soleName: 'G02',
      colorGroups: [{
        color: 'PRETO',
        combinedGrid: {},
        totalPairs: 12,
        opNumbers: [],
      }],
    }))).toBe('G02');
  });

  it('elegível só com URL real; pick usa a 1ª cor com imagem', () => {
    const g = group({
      soleName: 'G01',
      colorGroups: [
        {
          color: 'SEM FOTO',
          combinedGrid: {},
          totalPairs: 6,
          opNumbers: [],
          variantImageUrl: null,
          alternateVariants: [],
          technicalSheetImageUrl: null,
        },
        {
          color: 'DÁLIA',
          combinedGrid: {},
          totalPairs: 6,
          opNumbers: [],
          variantImageUrl: 'https://cdn/dalia.jpg',
          alternateVariants: [],
          technicalSheetImageUrl: null,
          refImages: [{ sheetId: 'sheet-g01' }],
        },
      ],
    });

    expect(aviamentoGroupHasResolvablePhoto(g)).toBe(true);
    expect(pickAviamentoHeroPhotoSources(g)).toEqual({
      variantImageUrl: 'https://cdn/dalia.jpg',
      alternateVariants: [],
      technicalSheetImageUrl: null,
      orderColor: 'DÁLIA',
    });

    const bare = group({
      soleName: 'SEM',
      colorGroups: [{
        color: 'X',
        combinedGrid: {},
        totalPairs: 1,
        opNumbers: [],
      }],
    });
    expect(aviamentoGroupHasResolvablePhoto(bare)).toBe(false);
    expect(pickAviamentoHeroPhotoSources(bare)).toBeNull();
  });

  it('lista elegíveis omite ref sem foto e deduplica chave', () => {
    const withPhoto = group({
      soleName: 'G01',
      colorGroups: [{
        color: 'DÁLIA',
        combinedGrid: {},
        totalPairs: 12,
        opNumbers: [],
        variantImageUrl: 'https://cdn/dalia.jpg',
        refImages: [{ sheetId: 'sheet-g01' }],
      }],
    });
    const noPhoto = group({
      soleName: 'G02',
      colorGroups: [{
        color: 'PRATA',
        combinedGrid: {},
        totalPairs: 12,
        opNumbers: [],
      }],
    });
    const listed = listAviamentoHeroEligibleGroups([withPhoto, noPhoto, withPhoto]);
    expect(listed).toEqual([{ key: 'sheet-g01', label: 'G01' }]);
    expect(listAviamentoHeroEligibleGroups(null)).toEqual([]);
  });
});
