import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec `grupo-cor-obrigatoria.md` (dono, 11/10/2026). O comportamento da lib
 * está em `lib/__tests__/createGroupWithColors.test.ts` e
 * `lib/__tests__/groupColorProducts.firstColor.test.ts`; aqui só a FIAÇÃO das
 * telas, que não dá pra exercitar sem montar o app.
 */
const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('grupo de material — porta única de criação, nasce com cor', () => {
  it('o cadastro rápido paralelo não existe mais (D1)', () => {
    expect(existsSync(resolve(ROOT, 'src/components/inventory/QuickFamilyDialog.tsx'))).toBe(false);
    const materials = read('src/components/inventory/tabs/MaterialsTab.tsx');
    expect(materials).not.toContain('QuickFamilyDialog');
    expect(materials).not.toContain('Cadastro rápido: grupo + cores');
    expect(materials).not.toContain('Novo grupo / linha vazio');
    expect(materials).toContain('Novo grupo');
  });

  it('a janela de criar grupo decide a cor pelo setor e grava pela lib com compensação (D2–D4)', () => {
    const create = read('src/components/groups/GroupCreateDialog.tsx');
    expect(create).toContain('colorRequirement({');
    expect(create).toContain('createGroupWithColors({');
    expect(create).toContain("requirement === 'ask' && variesByColor === null");
    expect(create).toContain('Boolean(colorBlocker)');
    // A gravação de produto não vive na tela: passa pela fronteira de estoque.
    expect(create).not.toMatch(/from\(['"]products['"]\)/);

    const lib = read('src/lib/createGroupWithColors.ts');
    expect(lib).toContain("rpc('delete_empty_material_group'");
    expect(lib).toContain('createProductsWithStock(');
  });

  it('depois de criar, a janela do grupo abre na aba certa (D5)', () => {
    const create = read('src/components/groups/GroupCreateDialog.tsx');
    expect(create).toContain("onCreated?.(created, 'colors')");
    expect(create).toContain("onCreated?.(created as ProductGroup, 'items')");
    expect(read('src/components/groups/GroupDialog.tsx')).toContain('onCreated={(newGroup, tab) => setCreated({ group: newGroup, tab })}');
    expect(read('src/components/groups/GroupOrganizationPanel.tsx')).toContain('onCreated={(group, tab) => { setEditTab(tab); setEditGroup(group); }}');
  });

  it('a conversão pela aba Cores chega ao estado local da janela (D6, R2.5)', () => {
    const edit = read('src/components/groups/GroupEditDialog.tsx');
    expect(edit).toContain('onConvertedToVariantLine={(unit) => {');
    expect(edit).toContain('setSharedSpecs(true);');
    expect(edit).toContain('!sharedSpecs && !isBomColorSource && products.length > 0 && (');
    const tab = read('src/components/groups/GroupColorsTab.tsx');
    expect(tab).toContain('results.some((result) => result.convertedToVariantLine)');
  });

  it('o Estoque mostra grupo sem item e não esconde cor zerada por padrão (dono, 11/10/2026)', () => {
    const materials = read('src/components/inventory/tabs/MaterialsTab.tsx');
    // Cor nova nasce com saldo 0; escondida por padrão, a busca dizia "Nenhum resultado".
    expect(materials).toContain('const [hideZeradas, setHideZeradas] = useState(false);');
    // Grupo vazio não tem linha em v_products_list — aparece numa faixa à parte.
    expect(materials).toContain('const emptyGroups = useMemo(');
    expect(materials).toContain('onClick={() => setFillGroup(g)}');
    expect(materials).toContain("initialTab={fillGroup.is_color_agnostic ? 'items' : 'colors'}");
    // Com só grupo vazio no recorte, nada de "Nenhum resultado" contradizendo a faixa.
    expect(materials).toContain('listProducts.length === 0 && emptyGroups.length > 0 ? (');
  });

  it('o seletor da ficha mostra grupo vazio sem deixar selecionar (D7)', () => {
    const selector = read('src/components/technical-sheets/sheetSelectors.tsx');
    // A seleção continua exigindo item ativo (débito/custo).
    expect(selector).toContain('.filter(group => (groupIndex[group.id]?.count || 0) > 0)');
    expect(selector).toContain('.filter(group => (groupIndex[group.id]?.count || 0) === 0)');
    expect(selector).toContain('Sem itens ativos · cadastre antes de usar');
    expect(selector).toContain('setGroupToFill(group);');
    expect(selector).toContain("initialTab={groupToFill.is_color_agnostic ? 'items' : 'colors'}");
  });
});
