import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HIDDEN_STOCK_ORGANIZATION_SECTORS,
  organizationSectorOptions,
  SECTOR_OPTIONS,
} from '@/lib/categoryFromGroup';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/**
 * Embalagem saiu da organização de estoque (12/09/2026): caixa não é família
 * de `products`. O bloco vazio competia com `/embalagens`. Este contrato trava
 * a árvore e os seletores de criar/mover grupo — sem reabrir a porta de
 * cadastrar família de Embalagem pelo `+ Família`.
 */
describe('Embalagem fora da organização do estoque', () => {
  it('organizationSectorOptions omite Embalagem e SECTOR_OPTIONS a mantém', () => {
    expect(HIDDEN_STOCK_ORGANIZATION_SECTORS).toEqual(['Embalagem']);
    expect(SECTOR_OPTIONS.some((s) => s.value === 'Embalagem')).toBe(true);
    expect(organizationSectorOptions().some((s) => s.value === 'Embalagem')).toBe(false);
    expect(organizationSectorOptions()).toHaveLength(SECTOR_OPTIONS.length - 1);
  });

  it('a árvore não força o setor vazio', () => {
    const rollup = read('src/lib/groupRollup.ts');
    expect(rollup).toContain('organizationSectorOptions()');
    expect(rollup).not.toMatch(/SECTOR_OPTIONS\.forEach\(\(option\) => ensure/);
  });

  it('criar e mover grupo não oferecem Embalagem', () => {
    const create = read('src/components/groups/GroupCreateDialog.tsx');
    const edit = read('src/components/groups/GroupEditDialog.tsx');
    const quick = read('src/components/inventory/QuickFamilyDialog.tsx');
    const move = read('src/components/groups/MoveGroupsDialog.tsx');

    expect(create).toContain('organizationSectorOptions()');
    expect(create).not.toMatch(/SECTOR_OPTIONS\.map/);
    expect(edit).toContain('organizationSectorOptions()');
    expect(edit).not.toMatch(/SECTOR_OPTIONS\.map/);
    expect(quick).toContain('organizationSectorOptions()');
    expect(quick).not.toMatch(/SECTOR_OPTIONS\.map/);
    expect(move).toContain('organizationSectorOptions()');
  });
});
