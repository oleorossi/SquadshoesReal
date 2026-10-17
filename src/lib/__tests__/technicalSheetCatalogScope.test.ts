import { describe, expect, it } from 'vitest';
import {
  isDraftCatalogFicha,
  isPublishedCatalogFicha,
  isPublishBlockedByDraftMaterials,
  matchesCatalogScope,
} from '@/lib/technicalSheetCatalogScope';

describe('technicalSheetCatalogScope', () => {
  it('hub só aceita publicada', () => {
    expect(isPublishedCatalogFicha('publicada')).toBe(true);
    expect(isPublishedCatalogFicha('validada')).toBe(false);
    expect(isPublishedCatalogFicha('rascunho')).toBe(false);
    expect(matchesCatalogScope('publicada', 'published')).toBe(true);
    expect(matchesCatalogScope('em_revisao', 'published')).toBe(false);
  });

  it('área de rascunhos inclui rascunho, em_revisao e validada', () => {
    expect(isDraftCatalogFicha('rascunho')).toBe(true);
    expect(isDraftCatalogFicha('em_revisao')).toBe(true);
    expect(isDraftCatalogFicha('validada')).toBe(true);
    expect(isDraftCatalogFicha('publicada')).toBe(false);
    expect(isDraftCatalogFicha('arquivada')).toBe(false);
    expect(matchesCatalogScope('validada', 'drafts')).toBe(true);
  });

  it('detecta bloqueio de publicar com material sem estoque', () => {
    expect(isPublishBlockedByDraftMaterials(
      'Não é possível publicar a ficha: 2 material(is) ainda sem vínculo com o estoque (COLA, FRETE). Vincule ou desative/remova as linhas-rascunho na Precificação.',
    )).toBe(true);
    expect(isPublishBlockedByDraftMaterials('rede indisponível')).toBe(false);
  });
});
