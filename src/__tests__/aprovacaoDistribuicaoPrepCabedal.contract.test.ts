import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildAutoBillingReport,
  defaultPostApprovalSector,
  sectorsForPostApprovalDemand,
} from '@/lib/postApprovalCabedalDistribute';

const FORM = 'src/pages/SaleOrderForm.tsx';
const LIST = 'src/pages/SaleOrders.tsx';
const SCREEN = 'src/components/sale-orders/PostApprovalCabedalDistributeScreen.tsx';
const SPEC = 'specs/aprovacao-distribuicao-prep-cabedal.md';

describe('aprovacao → distribuição Prep. cabedal — contratos', () => {
  it('spec canônica existe', () => {
    const spec = readFileSync(SPEC, 'utf8');
    expect(spec).toContain('Aprovação → distribuição Prep. cabedal');
    expect(spec).toContain('lockPlan');
    expect(spec).toContain('OverrideOutsourceCosturaDialog');
  });

  it('create path não monta OverrideOutsourceCosturaDialog nem pós-save OS', () => {
    const form = readFileSync(FORM, 'utf8');
    expect(form).not.toMatch(/from ['"]@\/components\/sale-orders\/OverrideOutsourceCosturaDialog['"]/);
    expect(form).not.toContain('capacityOutsourceAfterSaveRef');
    expect(form).not.toContain('postSaveOsOpen');
    expect(form).not.toContain('setOutsourceCosturaOpen');
    expect(form).toContain("navigate('/sales')");
  });

  it('arquivo OverrideOutsourceCosturaDialog foi removido', () => {
    let exists = true;
    try {
      readFileSync('src/components/sale-orders/OverrideOutsourceCosturaDialog.tsx', 'utf8');
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it('SaleOrders abre PostApprovalCabedalDistributeScreen após aprovar', () => {
    const list = readFileSync(LIST, 'utf8');
    expect(list).toContain('PostApprovalCabedalDistributeScreen');
    expect(list).toContain('openPostApprovalDistribute');
    expect(list).toContain('postApprovalDistribute');
  });

  it('tela confirma com lockPlan e não gera OS', () => {
    const screen = readFileSync(SCREEN, 'utf8');
    expect(screen).toContain('lockPlan: true');
    expect(screen).not.toContain('generate_cabedal_prep_service_orders');
    expect(screen).toContain('Pular');
    expect(screen).toContain('costura_cabedal');
    expect(screen).toContain('aviamento');
    expect(screen).toContain('syncCabedalPrepDemandsForSaleOrders');
  });

  it('helpers de setor e relatório de data automática', () => {
    expect(sectorsForPostApprovalDemand({ requires_sewing: true, requires_aviamento: true }))
      .toEqual(['costura_cabedal', 'aviamento']);
    expect(defaultPostApprovalSector({ requires_aviamento: true })).toBe('aviamento');
    expect(defaultPostApprovalSector({ requires_cut: true } as never)).toBe(null);

    const rows = buildAutoBillingReport({
      orders: [
        { id: 'a', order_number: 'PV-1', delivery_deadline: '2026-10-01' },
        { id: 'b', order_number: 'PV-2', delivery_deadline: '2026-09-01' },
        { id: 'c', order_number: 'PV-3', delivery_deadline: '2026-11-01' },
      ],
      minBillingById: {
        a: '2026-10-01',
        b: '2026-10-01',
        c: '2026-10-01',
      },
    });
    expect(rows.find((r) => r.saleOrderId === 'a')?.isAutomaticMin).toBe(true);
    expect(rows.find((r) => r.saleOrderId === 'b')?.isInfeasible).toBe(true);
    expect(rows.find((r) => r.saleOrderId === 'c')?.isAutomaticMin).toBe(false);
  });
});
