import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Regressão: o SupplierPanel sumiu da UI no refactor da árvore de estoque
 * (1401c9db) e nunca voltou ao GroupEditDialog. Sem a aba, group_suppliers
 * fica órfão e a OC automática nasce provisória sem porta de cadastro.
 */
const editDialog = readFileSync('src/components/groups/GroupEditDialog.tsx', 'utf8');
const createDialog = readFileSync('src/components/groups/GroupCreateDialog.tsx', 'utf8');
const supplierPanel = readFileSync('src/components/groups/SupplierPanel.tsx', 'utf8');

describe('fornecedores no editor de grupo', () => {
  it('expõe aba Fornecedores com o SupplierPanel embutido', () => {
    expect(editDialog).toContain("import SupplierPanel from './SupplierPanel'");
    expect(editDialog).toContain("value=\"suppliers\"");
    expect(editDialog).toContain('<SupplierPanel groupId={group.id} embedded hideHeader />');
  });

  it('resume fornecedores na Geral com CTA para a aba', () => {
    expect(editDialog).toContain('Compras e abastecimento');
    expect(editDialog).toContain("onClick={() => setActiveTab('suppliers')}");
    expect(editDialog).toContain('Cadastrar fornecedor');
    expect(editDialog).toContain('useGroupSuppliers');
  });

  it('não aponta mais o create dialog para o botão legado da lista', () => {
    expect(createDialog).toContain('aba <strong>Fornecedores</strong>');
    expect(createDialog).not.toContain('botão "+ Fornecedor"');
  });

  it('SupplierPanel aceita modo embutido no dialog', () => {
    expect(supplierPanel).toContain('embedded?: boolean');
    expect(supplierPanel).toContain('hideHeader?: boolean');
  });
});
