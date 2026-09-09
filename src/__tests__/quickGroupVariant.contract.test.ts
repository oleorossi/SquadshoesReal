import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read('supabase/migrations/20270101014900_quick_group_color_variant.sql');
const replayMigration = migration;
const command = read('src/lib/quickGroupVariant.ts');
const dialog = read('src/components/groups/QuickColorVariantDialog.tsx');
const manager = read('src/components/groups/GroupItemsManager.tsx');
const panel = read('src/components/groups/GroupOrganizationPanel.tsx');

describe('nova variação de cor pelo menu de itens do grupo', () => {
  it('fica visível no menu correto e respeita a permissão de criação', () => {
    expect(manager).toContain('Nova variação');
    expect(manager).toContain('QuickColorVariantDialog');
    expect(manager).toContain('recommendVariantTemplate(groupItems, quickSheetsByProduct)');
    expect(manager).toContain("from('component_sheets')");
    expect(manager).toContain('canCreate &&');
    expect(manager).toContain('openQuickVariant(p, event.currentTarget)');
    expect(panel).toContain('canCreate={canCreateQuickVariant}');
    expect(panel).toContain('canUseQuickGroupVariantForRoles(perm.roles)');
  });

  it('mantém apenas cor, quantidade, valor e confirmação como dados editáveis', () => {
    expect(dialog).toContain('Nome da nova cor');
    expect(dialog).toContain('Quantidade inicial');
    expect(dialog).toContain('Valor unitário');
    expect(dialog).toContain('Confirmo que o valor unitário é o mesmo padrão');
    expect(dialog).toContain('Dimensões herdadas');
    expect(dialog).toContain('Padrões herdados');
    expect(dialog).toContain('!sheetError');
    expect(dialog).toContain('refetchTemplateSheet');
    expect(dialog).not.toContain('ProductFormDialog');
    expect(dialog).not.toContain('MasterVariantDialog');
    expect(dialog).not.toMatch(/from\(['"]products['"]\)[\s\S]{0,180}\.insert\(/);
    expect(dialog).not.toMatch(/from\(['"]products['"]\)[\s\S]{0,180}\.update\(/);
  });

  it('usa uma única RPC transacional e nunca grava saldo direto pelo navegador', () => {
    expect(command).toContain("rpc('create_group_color_variant'");
    expect(command).toContain('p_template_product_id: input.templateProductId');
    expect(command).toContain('p_quantity: input.quantity');
    expect(command).toContain('p_unit_price: input.unitPrice');
    expect(dialog).toContain('requestIdRef.current = requestId');
    expect(dialog).toContain('requestId,');
    expect(command).not.toMatch(/from\(['"]products['"]\)[\s\S]{0,180}\.(?:insert|update)\(/);
    expect(command).not.toMatch(/from\(['"]stock_movements['"]\)[\s\S]{0,180}\.insert\(/);
  });

  it('delega saldo e ledger ao stock command e copia a ficha explícita na mesma transação', () => {
    expect(migration).toContain("public.execute_stock_command(");
    expect(migration).toContain("'create_product'");
    expect(migration).toContain("'quantity', p_quantity");
    expect(migration).toContain('SELECT * INTO v_template_sheet');
    expect(migration).toContain('WHERE product_id = p_template_product_id');
    expect(migration).toContain('coalesce(v_template_sheet.yield_per_size');
    expect(migration).toContain('coalesce(v_template_sheet.yield_per_sole');
    expect(migration).toContain('v_template_sheet.default_sole_group_id');
    expect(migration).toContain("coalesce(v_template_sheet.notes, '')");
    expect(migration).toContain('ON CONFLICT (product_id) DO UPDATE SET');
    expect(migration).not.toContain('INSERT INTO public.products');
    expect(migration).not.toContain('INSERT INTO public.stock_movements');
  });

  it('faz dimensões do grupo vencerem o modelo e usa allow-list positiva', () => {
    expect(migration).toMatch(/coalesce\(v_group\.dimensions_width, 0\) > 0[\s\S]{0,100}v_group\.dimensions_width/);
    expect(migration).toContain("THEN coalesce(v_group.dimensions_length, 0)");
    expect(migration).toContain("THEN coalesce(v_group.dimensions_thickness, 0)");
    expect(migration).not.toContain('to_jsonb(v_template)');
    expect(migration).toContain("'stock_grade', '{}'::jsonb");
    expect(migration).toContain("'quantity', p_quantity");
    expect(migration).toContain("'supplier_color_code', NULL");
    expect(migration).toContain("'gestaoclick_id', NULL");
    for (const field of [
      'linked_last_id', 'price_wholesale', 'price_retail',
      'strap_migration_cutover_id', 'fachete_material_group_id',
    ]) {
      expect(migration).not.toContain(`'${field}', v_template.${field}`);
    }
    expect(migration).toContain("yield_per_size = '{}'::jsonb");
    expect(migration).toContain('default_sole_group_id = NULL');
    expect(migration).toContain('O grupo mistura materiais diferentes');
    expect(migration).toContain('Hub de Tiras');
    expect(migration).toContain("regexp_replace(upper(extensions.unaccent(v_group.name))");
  });

  it('serializa duplicidade, confirma o mesmo preço no servidor e fecha ACL', () => {
    expect(migration).toContain("'quick-group-color:' || p_group_id::text || ':' || v_color_norm");
    expect(migration).toContain('extensions.unaccent(coalesce(product.color');
    expect(migration).toContain('COLOR_ALREADY_EXISTS');
    expect(migration).toContain('UNIT_PRICE_MISMATCH');
    expect(migration).toContain("ARRAY['admin', 'gerente', 'almoxarifado']");
    expect(migration).toContain("USING ERRCODE = '42501'");
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.create_group_color_variant');
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated');
  });

  it('repete a operação completa com o mesmo request_id sem cair em cor duplicada', () => {
    expect(replayMigration).toContain('group_color_variant_receipts');
    expect(replayMigration).toContain("'quick-group-variant-request:' || p_request_id::text");
    expect(replayMigration).toContain('v_receipt.request_hash IS DISTINCT FROM v_request_hash');
    expect(replayMigration).toContain("jsonb_build_object('replayed', true)");
    expect(replayMigration).toContain('public.create_group_color_variant_core_149(');
    expect(replayMigration.indexOf('IF FOUND THEN')).toBeLessThan(
      replayMigration.lastIndexOf('public.create_group_color_variant_core_149('),
    );
    expect(replayMigration).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(replayMigration).toContain("'gestaoclick_id', NULL");
    expect(replayMigration).toContain("yield_per_sole = '{}'::jsonb");
    expect(replayMigration).toContain('CREATE TABLE IF NOT EXISTS public.group_color_variant_receipts');
  });
});
