import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const table = read('src/components/inventory/ProductTable.tsx');
const bar = read('src/components/inventory/ProductBulkActionsBar.tsx');
const tree = read('src/components/groups/GroupStockTree.tsx');
const org = read('src/components/groups/GroupOrganizationPanel.tsx');
const manager = read('src/components/groups/GroupItemsManager.tsx');
const bulkBar = read('src/components/ui/bulk-actions-bar.tsx');

describe('estoque — seleção e duplicar materiais', () => {
  it('a aba Materiais tem checkbox por SKU, selecionar todos e Duplicar', () => {
    expect(table).toContain("from '@/components/ui/checkbox'");
    expect(table).toContain('onToggleSelect');
    expect(table).toContain('aria-label="Selecionar todos"');
    expect(table).toContain('aria-label="Duplicar material"');
    expect(table).toContain("from '@/components/inventory/ProductBulkActionsBar'");
    expect(table).toContain('<ProductBulkActionsBar');
    expect(table).toContain('toggleItem(id, shiftKey)');
    expect(table).toContain('addIds(keys)');
    expect(table, 'marquee não pode mais substituir a seleção').not.toMatch(/setSelectedIds\(new Set\(keys\)\)/);
  });

  it('a barra em massa inclui Duplicar e fica acima do dock', () => {
    expect(bar).toContain("label: 'Duplicar'");
    expect(bar).toContain("variant === 'simple'");
    expect(bar).toContain('As cópias nascem com estoque zerado e SKU novo');
    expect(bulkBar).toContain('fixed bottom-20');
  });

  it('a árvore de Organização seleciona SKU no detalhe, sem misturar com grupo', () => {
    expect(tree).toContain('aria-label="Selecionar todos os materiais"');
    expect(tree).toContain('onToggleProduct');
    expect(org).toContain('selectedProductIds');
    expect(org).toContain('setSelectedProductIds(new Set())');
    expect(org).toContain('setSelectedLeafIds(new Set())');
    expect(org).toContain('variant="simple"');
    expect(org).toContain('<ProductBulkActionsBar');
  });

  it('Gerir materiais duplica os SKUs selecionados pela barra existente', () => {
    expect(manager).toContain('useDuplicateProduct');
    expect(manager).toContain('<Copy className="h-3.5 w-3.5" /> Duplicar');
    expect(manager).toContain('Cópias com estoque zerado e SKU novo');
  });
});
