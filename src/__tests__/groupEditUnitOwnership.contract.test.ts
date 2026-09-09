import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/groups/GroupEditDialog.tsx', 'utf8');
const groupsHook = readFileSync('src/hooks/useGroups.ts', 'utf8');

function saveGroupSource(): string {
  const start = source.indexOf('const handleSave = async () =>');
  // Âncora pós-save: o rename inline de produto saiu com a tabela crua
  // (porta única = VariantListPanel). O próximo statement do componente é o return.
  const end = source.indexOf('\n  return (', start);
  if (start < 0 || end < 0) throw new Error('handleSave do grupo não encontrado');
  return source.slice(start, end);
}

function updateGroupHookSource(): string {
  const start = groupsHook.indexOf('export function useUpdateGroup()');
  const end = groupsHook.indexOf('export function useDeleteGroup()', start);
  if (start < 0 || end < 0) throw new Error('useUpdateGroup não encontrado');
  return groupsHook.slice(start, end);
}

describe('propriedade das unidades no editor de grupo', () => {
  it('salva consumption_unit no grupo sem regravar products', () => {
    const handleSave = saveGroupSource();

    expect(handleSave).toContain('consumption_unit: finalUnit');
    expect(handleSave).not.toContain(".from('products')");
    expect(handleSave).not.toContain('updateData.consumption_unit');
  });

  it('explica que definida por item preserva as variantes', () => {
    expect(source).toContain('A unidade de cada item será preservada.');
    // Cópia viva (pós alinhamento unidade de consumo): aponta a edição por
    // variante na aba dedicada em vez da frase antiga “são preservadas”.
    expect(source).toContain('As unidades das variantes continuam editáveis');
  });

  it('não permite linha de variantes sem unidade explícita', () => {
    expect(source).toContain('if (sharedSpecs && !finalUnit)');
    expect(source).toContain('Se as unidades forem individuais, escolha “Coleção de itens”');
    expect(source).toContain('value="__none__" disabled={sharedSpecs}');
  });

  it('atualiza as projeções de produto que incorporam os dados do grupo', () => {
    expect(updateGroupHookSource()).toContain("invalidateQueries({ queryKey: ['products'] })");
  });
});
