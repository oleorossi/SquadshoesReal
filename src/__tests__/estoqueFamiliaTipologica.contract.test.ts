import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(resolve(__dirname, '../..', relative), 'utf8');

const migration = read('supabase/migrations/20270101064000_estoque_familia_tipologica_setor_no_subgrupo.sql');
const panel = read('src/components/groups/GroupOrganizationPanel.tsx');
const tree = read('src/components/groups/GroupStockTree.tsx');
const move = read('src/components/groups/MoveGroupsDialog.tsx');
const create = read('src/components/groups/GroupCreateDialog.tsx');
const kind = read('src/lib/stockGroupKind.ts');

describe('organização de estoque Família → Subgrupo → Cores', () => {
  it('relaxa o invariante mono-setor e não cascateia setor da família', () => {
    expect(migration).toMatch(/Família › Subgrupo › Cores/);
    expect(migration).toMatch(/NÃO precisa/);
    expect(migration).toMatch(/coincidir com o setor-padrão da família/);
    expect(migration).not.toMatch(/O grupo deve estar no mesmo setor da família/);
    expect(migration).toMatch(/create or replace function public\.fn_group_sector_cascade_children/);
    expect(migration).toMatch(/return null;/);
    expect(migration).toMatch(/NÃO move, NÃO renomeia e NÃO reclassifica/);
  });

  it('escolhe o diálogo de nova cor pelas flags do grupo, não pelo nome TIRA', () => {
    expect(kind).toMatch(/strap_origin === 'comprar_pronto'/);
    expect(panel).toContain('addColorModeForGroup');
    expect(panel).not.toMatch(/const isStrapLikeGroup = \(name/);
    expect(panel).toContain("addColorModeForGroup");
  });

  it('expõe a árvore por família e permite mover subgrupo para família de outro setor', () => {
    expect(tree).toContain('buildFamilyTree');
    expect(tree).toMatch(/Família → Subgrupo → Cores/);
    expect(move).toMatch(/setor de cada subgrupo não muda/);
    expect(create).toMatch(/Nova família principal/);
    expect(create).toMatch(/Novo subgrupo técnico/);
    expect(create).toMatch(/Nova variação de cor/);
  });
});
