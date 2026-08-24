import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A janela de edição de GRUPO DE ESTOQUE é a porta única.
 *
 * Até 22/08/2026 conviviam dois editores para o mesmo grupo:
 *   • `GroupEditDialog` — abas Geral/Hierarquia/Dimensões/Embalagem/Cores/Itens,
 *     gravando `product_groups`;
 *   • `MasterVariantDialog` — outro Dialog, com abas próprias, gravando `products`.
 *
 * O botão "Editar N itens" da linha do material abria o SEGUNDO, e o menu ⋯ da
 * mesma linha abria o PRIMEIRO — dois formulários com metade dos campos cada um,
 * e o de dentro do grupo ainda empilhava o outro por cima. O `MasterVariantDialog`
 * virou painel (`VariantListPanel` / `VariantBulkEditPanel`) e agora é aba desta
 * janela. Era o M4 de `specs/inventory-packaging-overhaul.md`.
 *
 * Estes testes leem o FONTE porque o que se quer travar é estrutural: "não
 * existe um segundo diálogo de variantes". Um teste de render passaria mesmo
 * com o diálogo de volta, desde que ele abrisse.
 */
const read = (path: string) => readFileSync(path, 'utf8');

const panel = read('src/components/inventory/VariantManagerPanel.tsx');
const groupEdit = read('src/components/groups/GroupEditDialog.tsx');
const groupDialog = read('src/components/groups/GroupDialog.tsx');
const productTable = read('src/components/inventory/ProductTable.tsx');

describe('grupo de estoque — porta única de edição', () => {
  it('os painéis de variante não abrem janela própria', () => {
    // `\b` não casa dentro de "AlertDialogContent" (t→D são os dois word chars),
    // então a prévia de aplicação em massa continua permitida.
    expect(panel, 'VariantManagerPanel voltou a montar um Dialog').not.toMatch(/<Dialog[\s>]/u);
    expect(panel, 'VariantManagerPanel voltou a montar um DialogContent').not.toMatch(/\bDialogContent/u);
    expect(panel).not.toContain("from '@/components/ui/dialog'");
    // O editor de UMA variante segue sendo um Sheet lateral — isso é intencional.
    expect(panel).toContain('function VariantDetailSheet');
    expect(panel).toContain('export function VariantListPanel');
    expect(panel).toContain('export function VariantBulkEditPanel');
  });

  it('o painel não reabre a janela do grupo por dentro (ciclo de import)', () => {
    // `MasterVariantDialog` importava `GroupDialog` pro link "Editar no grupo",
    // e o `GroupEditDialog` importava o `MasterVariantDialog` de volta.
    expect(panel).not.toContain("from '@/components/groups/GroupDialog'");
    expect(panel, 'o link de dimensões tem que ser callback, não navegação própria')
      .toContain('onOpenGroupSpecs');
  });

  it('a janela do grupo hospeda cores, itens e edição em massa', () => {
    expect(groupEdit).toContain("import { VariantListPanel, VariantBulkEditPanel }");
    expect(groupEdit).toContain('<VariantListPanel');
    expect(groupEdit).toContain('<VariantBulkEditPanel');
    expect(groupEdit).toMatch(/TabsTrigger value="bulk"/u);
    expect(groupEdit).toMatch(/TabsContent value="bulk"/u);
    // Nenhum diálogo de variante empilhado sobre a janela do grupo.
    expect(groupEdit).not.toMatch(/<MasterVariant/u);
    expect(groupEdit).not.toMatch(/import\s*\{[^}]*MasterVariantDialog/u);
  });

  it('a janela aceita a aba de abertura pedida por quem a abriu', () => {
    expect(groupEdit).toContain('export type GroupEditTab');
    expect(groupEdit).toContain('initialTab');
    expect(groupDialog).toContain('initialTab');
    expect(groupDialog).toContain('<GroupEditDialog');
  });

  it('a lista de estoque manda todas as ações do grupo para essa janela', () => {
    expect(productTable, 'ProductTable voltou a importar um diálogo de variantes')
      .not.toMatch(/MasterVariantDialog['"]/u);
    expect(productTable).not.toMatch(/<MasterVariant/u);
    // "+ Cor" → aba Cores; "Editar N itens" → aba Em massa; ⋯ → aba Geral.
    expect(productTable).toContain("openGroup(groupId, 'colors')");
    expect(productTable).toContain("openGroup(groupId, 'bulk')");
    expect(productTable).toContain("openGroup(groupId, 'general')");
    expect(productTable).toContain('initialTab={editingGroup.tab}');
  });

  it('o lápis da sub-linha edita UM item, sem desviar pro conjunto', () => {
    // O desvio antigo abria um gerenciador de várias cores a partir do lápis de
    // UMA, e por isso precisava de escopo por nome-base pra não misturar
    // materiais em grupo heterogêneo. Some o desvio, some o escopo.
    const handler = productTable.slice(
      productTable.indexOf('const handleEditIntercepted'),
      productTable.indexOf('const [editingGroup'),
    );
    expect(handler).toContain('setSoleEditProduct(product)');
    expect(handler).toContain('onEdit(product)');
    expect(handler, 'o lápis da linha não pode abrir o conjunto de cores')
      .not.toMatch(/setMasterVariant|getBaseName/u);
  });

  it('identidade de material tem fonte única', () => {
    // A regra "mostra o nome / libera o cadastro rápido de cor" vale igual na
    // lista de estoque e na janela do grupo; duas cópias divergiriam.
    expect(productTable).toContain("from '@/lib/materialIdentity'");
    expect(groupEdit).toContain("from '@/lib/materialIdentity'");
    expect(productTable, 'ProductTable redefiniu materialIdentity localmente')
      .not.toMatch(/function materialIdentity/u);
  });
});
