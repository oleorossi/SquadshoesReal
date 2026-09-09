import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MATERIAL_DIALOG = readFileSync(resolve(
  ROOT,
  'src/components/sale-orders/MaterialPurchaseConfirmDialog.tsx',
), 'utf8');
const SOLE_DIALOG = readFileSync(resolve(
  ROOT,
  'src/components/sale-orders/SolePurchaseConfirmDialog.tsx',
), 'utf8');
const SALE_ORDER_FORM = readFileSync(resolve(ROOT, 'src/pages/SaleOrderForm.tsx'), 'utf8');
const SALE_ORDER_HOOK = readFileSync(resolve(ROOT, 'src/hooks/useSaleOrders.ts'), 'utf8');
const ORDERS_PAGE = readFileSync(resolve(ROOT, 'src/pages/Orders.tsx'), 'utf8');
const COMMAND_MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101010400_atomic_sale_order_promotion_command.sql',
), 'utf8');
const WORKER = readFileSync(resolve(
  ROOT,
  'supabase/functions/process-sale-order-outbox/index.ts',
), 'utf8');
const MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101010900_sale_order_outbox_worker.sql',
), 'utf8');

describe('owner único da compra automática do PV', () => {
  it('o diálogo de materiais só revisa a prévia e não grava OC antes do commit', () => {
    expect(MATERIAL_DIALOG).not.toContain('useUpsertOpenPurchaseOrder');
    expect(MATERIAL_DIALOG).not.toContain('upsert_open_purchase_order');
    expect(MATERIAL_DIALOG).not.toContain('handleGeneratePOs');
    expect(MATERIAL_DIALOG).not.toContain('.mutateAsync({');
    expect(MATERIAL_DIALOG).toContain("onConfirm: (action: 'continue' | 'draft') => void");
    expect(MATERIAL_DIALOG).toContain('Nenhuma OC é criada nesta etapa');
    expect(MATERIAL_DIALOG).toContain('Compra processada depois do pedido');
  });

  it('o diálogo de solado/palmilha também não cria uma segunda OC no navegador', () => {
    expect(SOLE_DIALOG).not.toContain('useCreatePurchaseOrder');
    expect(SOLE_DIALOG).not.toContain('rateGradeToTotal');
    expect(SOLE_DIALOG).not.toContain('handleGeneratePOs');
    expect(SOLE_DIALOG).not.toContain('.mutateAsync({');
    expect(SOLE_DIALOG).toContain('onConfirm: () => void');
    expect(SOLE_DIALOG).toContain('A OC não nasce neste diálogo');
    expect(SOLE_DIALOG).not.toContain('Gerar OCs e salvar pedido');
  });

  it('o formulário não injeta identidade de PV em um escritor antecipado', () => {
    const materialDialogCall = SALE_ORDER_FORM.match(
      /<MaterialPurchaseConfirmDialog[\s\S]*?\/>/,
    )?.[0] ?? '';
    expect(SALE_ORDER_FORM).toContain("const handleMaterialConfirm = (action: 'continue' | 'draft')");
    expect(SALE_ORDER_FORM).toContain('const handleSoleConfirm = () =>');
    expect(materialDialogCall).not.toContain('saleOrderId=');
  });

  it('preserva a ordem create → diálogo → approve → worker', () => {
    // O diálogo termina no save do PV, nunca em uma mutação de compra.
    expect(SALE_ORDER_FORM).toContain("if (action === 'draft') { doSubmit('Rascunho'); return; }");
    expect(SALE_ORDER_FORM).toContain('filterProductionSaleOrderItems(validItems)');
    expect(SALE_ORDER_FORM).toContain('runCapacityCheck(productionItems);');

    // Create é draft-only e publica seu fato na mesma transação.
    expect(SALE_ORDER_HOOK).toContain('createSaleOrderCommand');
    expect(COMMAND_MIGRATION).toContain("v_header := p_header || jsonb_build_object('status', 'Rascunho')");
    expect(COMMAND_MIGRATION).toContain("'sale_order.created'");

    // Aprovar é outro comando/versionamento; não é um efeito do diálogo.
    expect(SALE_ORDER_HOOK).toContain("status === 'Aprovado'");
    expect(SALE_ORDER_HOOK).toContain("? 'confirm'");
    expect(SALE_ORDER_HOOK).toContain('executeSaleOrderCommand');
    expect(COMMAND_MIGRATION).toContain("WHEN 'confirm' THEN 'sale_order.confirmed'");

    // O create em Rascunho é consumido sem OC; a versão aprovada posterior
    // é que autoriza o único writer server-side.
    expect(MIGRATION).toContain("IF v_status IN ('Aprovado', 'Em Produção') THEN");
    expect(WORKER).toContain('process_sale_order_purchase_shortages');
  });

  it('o único escritor automático é o efeito versionado consumido pela outbox', () => {
    expect(ORDERS_PAGE).not.toContain('autoCreateSolePOFromShortfall');
    expect(ORDERS_PAGE).toContain('O efeito de compra pertence à outbox do PV');
    expect(WORKER).toContain('process_sale_order_purchase_shortages');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS public.sale_order_purchase_shortage_effects');
    expect(MIGRATION).toContain("'auto_pv:outbox:'");
    expect(MIGRATION).toContain('v_current_digest = v_effect.applied_digest');
  });
});
