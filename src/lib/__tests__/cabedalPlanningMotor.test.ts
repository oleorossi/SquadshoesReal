import { describe, expect, it } from 'vitest';
import {
  buildPurchaseBoard,
  DEFAULT_MOTOR_SETTINGS,
  addFactoryBusinessDays,
  allocateStock,
  contractorWeekOverCapacity,
  decideRelease,
  isUrgentOrderType,
  planItemClock,
  prepClass,
  proposeSequence,
  selectionCanBecomePurchaseOrder,
  suggestPurchases,
  supplierLeadLabel,
  type MaterialNeed,
  type PlanDemand,
  type StockPool,
} from '../cabedalPlanningMotor';

const SETTINGS = { ...DEFAULT_MOTOR_SETTINGS };

function material(partial: Partial<MaterialNeed> & Pick<MaterialNeed, 'productId' | 'required'>): MaterialNeed {
  return {
    productName: 'NAPA OFF WHITE',
    unit: 'm',
    unitPrice: 10,
    supplierId: 'forn-1',
    supplierName: 'Curtume',
    supplierLeadDays: 10,
    protectedHeld: 0,
    ...partial,
  };
}

function demand(partial: Partial<PlanDemand> & Pick<PlanDemand, 'itemId' | 'orderNumber'>): PlanDemand {
  return {
    saleOrderId: partial.itemId,
    orderType: 'programado',
    billingWeek: '2026-05-S2',
    referenceCode: 'INL01',
    color: 'OFF WHITE',
    pairs: 100,
    assemblyCapacityPerDay: 100,
    prepBusinessDays: null,
    explicitComplex: false,
    cabedalReceived: false,
    closeScore: 0.2,
    isPinned: false,
    isFrozen: false,
    pinnedPosition: null,
    frozenPosition: null,
    protected: false,
    materials: [],
    ...partial,
  };
}

describe('tipo urgente', () => {
  it('só o valor do seletor conta como urgente', () => {
    expect(isUrgentOrderType('urgente')).toBe(true);
    expect(isUrgentOrderType('programado')).toBe(false);
    expect(isUrgentOrderType('carteira')).toBe(false);
    expect(isUrgentOrderType(null)).toBe(false);
  });
});

describe('relógio', () => {
  it('preparo vazio mantém a folga de calendário de 7 dias', () => {
    const clock = planItemClock(demand({ itemId: 'a', orderNumber: 'PV-A' }), SETTINGS, '2026-04-01');
    expect(clock.usesCurrentClock).toBe(true);
    expect(clock.anchor).toBe('2026-05-04');
    expect(clock.departure).toBe('2026-04-27');
  });

  it('preparo preenchido conta dias úteis para trás do primeiro dia da semana', () => {
    const clock = planItemClock(demand({
      itemId: 'a',
      orderNumber: 'PV-A',
      prepBusinessDays: 5,
      explicitComplex: true,
      pairs: 200,
      assemblyCapacityPerDay: 100,
    }), SETTINGS, '2026-04-01');
    expect(clock.usesCurrentClock).toBe(false);
    expect(clock.className).toBe('complexo');
    expect(clock.assemblyDays).toBe(2);
    expect(clock.assemblyStart).toBe(addFactoryBusinessDays('2026-05-04', -2));
    expect(clock.departure).toBe(addFactoryBusinessDays(clock.assemblyStart!, -5));
    expect(clock.buyBy).toBe(addFactoryBusinessDays(clock.needDate!, -10));
  });

  it('sem semana de faturamento não inventa âncora', () => {
    const clock = planItemClock(demand({
      itemId: 'a',
      orderNumber: 'PV-A',
      billingWeek: null,
    }), SETTINGS, '2026-04-01');
    expect(clock.missingBillingWeek).toBe(true);
    expect(clock.buyBy).toBeNull();
  });

  it('acima de 5 dias ou marca explícita é complexo', () => {
    expect(prepClass(6, false)).toBe('complexo');
    expect(prepClass(null, true)).toBe('complexo');
    expect(prepClass(3, false)).toBe('simples');
  });
});

describe('sequência', () => {
  it('urgente fica na frente sem passar pin nem congelado', () => {
    const rows = proposeSequence([
      demand({ itemId: 'facil', orderNumber: 'PV-F', billingWeek: '2026-05-S1' }),
      demand({ itemId: 'urg', orderNumber: 'PV-U', orderType: 'urgente', billingWeek: '2026-06-S1' }),
      demand({ itemId: 'pin', orderNumber: 'PV-P', isPinned: true, pinnedPosition: 1, billingWeek: '2026-07-S1' }),
    ], SETTINGS);
    expect(rows.map((row) => row.orderNumber)).toEqual(['PV-P', 'PV-U', 'PV-F']);
    expect(rows[1].reason).toMatch(/Urgente/);
    expect(rows[0].reason).toMatch(/Pin/);
  });
});

describe('alocação', () => {
  it('urgente toma a napa e os pedidos deslocados geram recompra', () => {
    const napa = (required: number): MaterialNeed[] => [material({ productId: 'napa', required })];
    const items = [
      demand({ itemId: 'a', orderNumber: 'PV-A', billingWeek: '2026-05-S1', materials: napa(100) }),
      demand({ itemId: 'b', orderNumber: 'PV-B', billingWeek: '2026-05-S2', materials: napa(100) }),
      demand({
        itemId: 'u',
        orderNumber: 'PV-U',
        orderType: 'urgente',
        billingWeek: '2026-05-S3',
        materials: napa(200),
      }),
    ];
    const stock: StockPool[] = [{ productId: 'napa', free: 200 }];
    const result = allocateStock(items, stock, SETTINGS);
    const byOrder = (order: string) => result.lines.find((line) => line.orderNumber === order)!;
    expect(byOrder('PV-U').allocated).toBe(200);
    expect(byOrder('PV-U').displacedFrom.map((row) => row.orderNumber).sort()).toEqual(['PV-A', 'PV-B']);
    expect(byOrder('PV-A').allocated).toBe(0);
    expect(byOrder('PV-A').repurchase).toBe(100);
    expect(byOrder('PV-B').repurchase).toBe(100);
  });

  it('não toma material de pedido pinado', () => {
    const items = [
      demand({
        itemId: 'pin',
        orderNumber: 'PV-P',
        isPinned: true,
        protected: true,
        materials: [material({ productId: 'napa', required: 80, protectedHeld: 80 })],
      }),
      demand({
        itemId: 'u',
        orderNumber: 'PV-U',
        orderType: 'urgente',
        materials: [material({ productId: 'napa', required: 50 })],
      }),
    ];
    const result = allocateStock(items, [{ productId: 'napa', free: 50 }], SETTINGS);
    expect(result.lines.find((line) => line.orderNumber === 'PV-P')!.allocated).toBe(80);
    expect(result.lines.find((line) => line.orderNumber === 'PV-U')!.allocated).toBe(50);
  });
});

describe('liberação e compra', () => {
  it('sem material o pedido fica aguardando, inclusive o urgente', () => {
    const item = demand({
      itemId: 'u',
      orderNumber: 'PV-U',
      orderType: 'urgente',
      explicitComplex: true,
      prepBusinessDays: 8,
      materials: [material({ productId: 'napa', required: 10 })],
    });
    const allocation = allocateStock([item], [{ productId: 'napa', free: 0 }], SETTINGS);
    const [decision] = decideRelease([item], allocation, SETTINGS);
    expect(decision.status).toBe('aguardando_material');
    const purchases = suggestPurchases([item], allocation, SETTINGS, '2026-04-01');
    expect(purchases[0].urgent).toBe(true);
    expect(purchases[0].status).toBe('liberada');
  });

  it('cabedal complexo com material ainda espera o recebimento do Ateliê', () => {
    const item = demand({
      itemId: 'c',
      orderNumber: 'PV-C',
      explicitComplex: true,
      prepBusinessDays: 8,
      cabedalReceived: false,
      materials: [material({ productId: 'napa', required: 10 })],
    });
    const allocation = allocateStock([item], [{ productId: 'napa', free: 10 }], SETTINGS);
    expect(decideRelease([item], allocation, SETTINGS)[0].status).toBe('aguardando_cabedal');
  });

  it('teto estourado por urgente avisa e o restante fica aguardando caixa', () => {
    const urgent = demand({
      itemId: 'u',
      orderNumber: 'PV-U',
      orderType: 'urgente',
      billingWeek: '2026-05-S1',
      materials: [material({ productId: 'napa', required: 10, unitPrice: 30 })],
    });
    const later = demand({
      itemId: 'a',
      orderNumber: 'PV-A',
      billingWeek: '2026-05-S1',
      materials: [material({ productId: 'sola', required: 10, productName: 'SOLA', unitPrice: 30 })],
    });
    const allocation = allocateStock(
      [urgent, later],
      [{ productId: 'napa', free: 0 }, { productId: 'sola', free: 0 }],
      SETTINGS,
    );
    const lines = suggestPurchases([urgent, later], allocation, { ...SETTINGS, weeklyPurchaseCapBrl: 200 }, '2026-04-01');
    const urg = lines.find((line) => line.orderNumber === 'PV-U')!;
    const normal = lines.find((line) => line.orderNumber === 'PV-A')!;
    expect(urg.status).toBe('liberada');
    expect(urg.capWarning).toMatch(/teto/);
    expect(normal.status).toBe('aguardando_caixa');
  });

  it('compra longe da montagem fica fora da janela; urgente não', () => {
    const far = demand({
      itemId: 'far',
      orderNumber: 'PV-LONGE',
      billingWeek: '2026-12-S1',
      prepBusinessDays: 6,
      explicitComplex: true,
      materials: [material({ productId: 'napa', required: 5, supplierLeadDays: 1 })],
    });
    const urgent = demand({
      itemId: 'u',
      orderNumber: 'PV-U',
      orderType: 'urgente',
      billingWeek: '2026-12-S1',
      prepBusinessDays: 6,
      explicitComplex: true,
      materials: [material({ productId: 'napa', required: 5, supplierLeadDays: 1 })],
    });
    const allocation = allocateStock(
      [far, urgent],
      [{ productId: 'napa', free: 0 }],
      SETTINGS,
    );
    const lines = suggestPurchases([far, urgent], allocation, SETTINGS, '2026-04-01');
    expect(lines.find((line) => line.orderNumber === 'PV-LONGE')!.status).toBe('fora_da_janela');
    expect(lines.find((line) => line.orderNumber === 'PV-U')!.status).toBe('liberada');
    expect(lines.find((line) => line.orderNumber === 'PV-U')!.groupKey).not.toBe(
      lines.find((line) => line.orderNumber === 'PV-LONGE')!.groupKey,
    );
  });
});

describe('avisos de cadastro', () => {
  it('lead vazio aparece como padrão 10 dias', () => {
    expect(supplierLeadLabel(null).text).toBe('padrão 10 dias');
    expect(supplierLeadLabel(0).isDefault).toBe(true);
    expect(supplierLeadLabel(12).text).toBe('12 dias');
  });

  it('as duas visões usam o mesmo conjunto e a ordem do fornecedor começa pelo urgente', () => {
    const urgent = demand({
      itemId: 'u',
      orderNumber: 'PV-U',
      orderType: 'urgente',
      billingWeek: '2026-05-S1',
      materials: [material({ productId: 'napa', required: 4, unitPrice: 10 })],
    });
    const later = demand({
      itemId: 'a',
      orderNumber: 'PV-A',
      billingWeek: '2026-05-S2',
      materials: [material({ productId: 'sola', required: 4, productName: 'SOLA', unitPrice: 10 })],
    });
    const allocation = allocateStock(
      [urgent, later],
      [{ productId: 'napa', free: 0 }, { productId: 'sola', free: 0 }],
      SETTINGS,
    );
    const lines = suggestPurchases([urgent, later], allocation, SETTINGS, '2026-04-01');
    const filters = {
      supplierId: null,
      saleOrderId: null,
      urgentOnly: false,
      overdueOnly: false,
      week: null,
      today: '2026-04-01',
    };
    const bySupplier = buildPurchaseBoard(lines, 'fornecedor', filters);
    const byOrder = buildPurchaseBoard(lines, 'pedido', filters);
    const ids = (board: typeof bySupplier) => board.lines.map((line) => `${line.itemId}|${line.productId}`).sort();
    expect(ids(bySupplier)).toEqual(ids(byOrder));
    expect(bySupplier.blocks[0].lines[0].urgent).toBe(true);
    expect(byOrder.blocks[0].title).toBe('PV-U');
    expect(selectionCanBecomePurchaseOrder([bySupplier.blocks[0].lines[0]]).ok).toBe(true);
    expect(selectionCanBecomePurchaseOrder(bySupplier.lines).ok).toBe(false);
  });

  it('capacidade da semana avisa e não bloqueia', () => {
    expect(contractorWeekOverCapacity(80, 10)).toMatch(/não é bloqueado/);
    expect(contractorWeekOverCapacity(40, 10)).toBeNull();
    expect(contractorWeekOverCapacity(80, null)).toBeNull();
  });
});
