import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Grupos canônicos de tira (`is_artisanal_strap`) são identidade de produto
 * acabado (TIRA CHATA 20MM), não napa-base. O atalho Estoque → Grupos → Hub
 * que mandava só `baseGroupId` sem `identityBasis` abria Prestador com a tira
 * no campo "Material-base", cor canônica vazia e "Salvar e ativar" bloqueado.
 */
const groupEdit = readFileSync('src/components/groups/GroupEditDialog.tsx', 'utf8');
const editor = readFileSync('src/components/artisanal-straps/ArtisanalStrapEditor.tsx', 'utf8');

describe('atalho Grupos → Hub trata tira acabada como finished_product_group', () => {
  it('links do GroupEditDialog passam identityBasis=finished_product_group', () => {
    const links = groupEdit.match(/\/tiras-artesanais\?tab=cadastro&editor=1[^`'"]+/g) || [];
    expect(links.length).toBeGreaterThanOrEqual(3);
    links.forEach((link) => {
      expect(link).toContain('identityBasis=finished_product_group');
      expect(link).toContain('purpose=stock_variant');
      expect(link).toContain('origin=grupos');
    });
  });

  it('editor promove grupo is_artisanal_strap da URL a identidade acabada', () => {
    expect(editor).toContain('urlGroupIsFinishedStrap');
    expect(editor).toContain('is_artisanal_strap === true');
    expect(editor).toContain("resolvedIdentityBasis");
  });

  it('seletor de material-base exclui famílias de tira e usa candidatos elegíveis', () => {
    expect(editor).toContain('useStrapBaseGroupCandidates');
    expect(editor).toContain('napaBaseGroups');
    expect(editor).toContain('is_artisanal_strap !== true');
    expect(editor).not.toMatch(
      /Material-base que será debitado[\s\S]{0,400}catalog\.groups\.map/,
    );
  });

  it('review sem variante prévia ainda ativa (rótulo Salvar e ativar)', () => {
    expect(editor).toContain("mode === 'review' || exactBuyReadyProductPrefill");
    expect(editor).not.toContain('(mode === \'review\' && variant) || exactBuyReadyProductPrefill');
  });
});
