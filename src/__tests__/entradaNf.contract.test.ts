import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const MIG_DIR = resolve(ROOT, 'supabase/migrations');
const migName = readdirSync(MIG_DIR).find((f) => f.endsWith('_entrada_nf_receive_followup.sql'));
const PAGE = readFileSync(resolve(ROOT, 'src/pages/EntradaNfPage.tsx'), 'utf8');
const CONFIRM = readFileSync(resolve(ROOT, 'src/lib/nfEntradaConfirm.ts'), 'utf8');
const NAV = readFileSync(resolve(ROOT, 'src/data/navigation.ts'), 'utf8');
const ACCESS = readFileSync(resolve(ROOT, 'src/hooks/useAccessControl.ts'), 'utf8');
const APP = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8');
const PO_PAGE = readFileSync(resolve(ROOT, 'src/pages/PurchaseOrders.tsx'), 'utf8');
const RECEIVE_DLG = readFileSync(resolve(ROOT, 'src/components/purchase/PurchaseOrderReceiveDialog.tsx'), 'utf8');
const RECEIPT = readFileSync(resolve(ROOT, 'src/lib/nfPoReceipt.ts'), 'utf8');

describe('Entrada por NF · contrato', () => {
  it('tem migration 20270101061000 (ou posterior) com o patch de receive e o followup', () => {
    expect(migName).toBeTruthy();
    expect(Number((migName as string).slice(0, 14))).toBeGreaterThanOrEqual(20270101061000);
    const MIG = readFileSync(resolve(MIG_DIR, migName as string), 'utf8');
    expect(MIG).toContain("'draft', 'suggested', 'pending', 'approved', 'sent', 'parcial'");
    expect(MIG).toContain('apply_purchase_receive_followup');
    expect(MIG).toContain('settle_pending_reconciliation_for_product');
    expect(MIG).toContain("recompute_production_schedule('nf-receive')");
    expect(MIG).toContain('recompute_material_gate_for_sale_orders');
    expect(MIG).toContain('trg_after_purchase_order_receive_followup');
    expect(MIG).toMatch(/Gerar OC/);
    expect(MIG).toContain('run_entrada_nf_receive_contract_tests');
  });

  it('a tela única está no menu de Compras e no mapa de acesso', () => {
    expect(NAV).toContain("path: '/compras/entrada-nf'");
    expect(NAV).toMatch(/Entrada por NF/);
    expect(NAV).toContain("resource('/compras/entrada-nf')");
    expect(ACCESS).toContain("'/compras/entrada-nf'");
    expect(APP).toContain('compras/entrada-nf');
    expect(APP).toContain('EntradaNfPage');
  });

  it('reaproveita o casamento e o comando receive, sem SEFAZ', () => {
    expect(PAGE).toContain('parseNFeXML');
    expect(PAGE).toContain('buildNfPoPreviewLines');
    expect(CONFIRM).toContain('executePurchaseOrderCommand');
    expect(CONFIRM).toContain("command: 'receive'");
    expect(PAGE).toMatch(/[Ss]em consulta à SEFAZ/);
    expect(PAGE + CONFIRM).not.toMatch(/consultar a SEFAZ|api[_ ]sefaz/i);
    expect(RECEIPT).toContain('draft');
    expect(RECEIPT).toContain('suggested');
    expect(RECEIPT).toContain('DRAFT_RECEIVE_CONFIRMATION');
  });

  it('Dar entrada da OC inclui pending e pede confirmação no rascunho', () => {
    expect(PO_PAGE).toMatch(/order\.status === 'pending'/);
    expect(PO_PAGE).toContain('isReceivable');
    expect(RECEIVE_DLG).toContain('DRAFT_RECEIVE_CONFIRMATION');
    expect(RECEIVE_DLG).toContain('isDraftLikePoStatus');
  });
});
