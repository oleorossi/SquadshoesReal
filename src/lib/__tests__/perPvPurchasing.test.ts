import { describe, it, expect } from 'vitest';
import {
  buildPerPvPurchaseOrders,
  collectPerPvPackagingWithoutSupplier,
  createPerPvStrapIdentityGuard,
  excludeStrapsFromPerPvDrafts,
  partitionPerPvStrapPurchaseItems,
  summarizePerPvDrafts,
  isPerPvPurchaseOrder,
  collectPvNeedWarnings,
  collectOpenPurchaseWarnings,
  NO_SUPPLIER_LABEL,
  type PvMaterialNeed,
} from '@/lib/perPvPurchasing';

/**
 * GATE da lógica de agrupamento do canal "Compras por Pedido".
 * A demanda (consumo × pares, dm²→física, estoque) vem pronta da RPC
 * compute_materials_per_pv; aqui só validamos o empacotamento em OCs.
 */

const need = (over: Partial<PvMaterialNeed>): PvMaterialNeed => ({
  material_id: 'm-x',
  product_name: 'Material X',
  unit: 'm',
  color: null,
  needed_qty: 10,
  stock_qty: 0,
  shortage: 10,
  supplier_id: 's-1',
  supplier_name: 'Fornecedor 1',
  last_unit_price: 2,
  is_artisanal: false,
  ...over,
});

describe('grade do solado', () => {
  it('mescla a grade por numeração ao somar o mesmo solado+cor', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'sol-01', product_name: '01', color: 'CARAMELO', unit: 'par', needed_qty: 276, supplier_id: null, supplier_name: null, grade: { '34': 92, '36': 184 } }),
      need({ material_id: 'sol-01', product_name: '01', color: 'CARAMELO', unit: 'par', needed_qty: 192, supplier_id: null, supplier_name: null, grade: { '34': 92, '38': 100 } }),
    ]);
    const item = drafts[0].items.find((i) => i.material_id === 'sol-01')!;
    expect(item.quantity).toBe(468);
    expect(item.grade).toEqual({ '34': 184, '36': 184, '38': 100 });
  });

  it('usa a falta por numeração e fecha soma(grade) == quantity', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({
        material_id: 'sol-01', product_name: '01', color: 'CARAMELO', unit: 'par',
        needed_qty: 100, stock_qty: 40, grade: { '34': 25, '35': 25, '36': 50 },
        shortage_grade: { '34': 5, '35': 5, '36': 50 },
      }),
    ], { netOfStock: true });
    const item = drafts[0].items[0];
    expect(item.quantity).toBe(60);
    expect(item.grade).toEqual({ '34': 5, '35': 5, '36': 50 });
    expect(Object.values(item.grade || {}).reduce((sum, qty) => sum + qty, 0)).toBe(item.quantity);
  });

  it('rateia a grade também para o excedente do múltiplo de compra', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({
        material_id: 'sol-01', product_name: '01', color: 'CARAMELO', unit: 'par',
        needed_qty: 42, purchase_multiple: 10, grade: { '34': 14, '35': 14, '36': 14 },
      }),
    ]);
    const item = drafts[0].items[0];
    expect(item.quantity).toBe(50);
    expect(Object.values(item.grade || {}).reduce((sum, qty) => sum + qty, 0)).toBe(50);
  });

  it('material sem grade fica com grade null', () => {
    const drafts = buildPerPvPurchaseOrders([need({ material_id: 'napa', needed_qty: 20 })]);
    expect(drafts[0].items[0].grade ?? null).toBeNull();
  });
});

describe('guard color_mismatch', () => {
  it('propaga a flag e conta no resumo (bloqueia gerar)', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'napa', color: 'MARROM', needed_qty: 10, color_mismatch: true }),
      need({ material_id: 'cola', color: null, needed_qty: 2 }),
    ]);
    const item = drafts.flatMap((d) => d.items).find((i) => i.material_id === 'napa')!;
    expect(item.color_mismatch).toBe(true);
    expect(summarizePerPvDrafts(drafts).colorMismatchCount).toBe(1);
  });

  it('OR ao mesclar mesmo material+cor (qualquer linha mismatch marca)', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'napa', color: 'MARROM', needed_qty: 5, color_mismatch: false }),
      need({ material_id: 'napa', color: 'MARROM', needed_qty: 5, color_mismatch: true }),
    ]);
    expect(drafts[0].items[0].color_mismatch).toBe(true);
  });
});

describe('buildPerPvPurchaseOrders', () => {
  it('embalagem canônica preserva box_type_id sem criar product_id espelho', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({
        material_id: null,
        box_type_id: 'bt-colmeia',
        packaging_type: 'colmeia',
        product_name: 'CAIXA COLMEIA 11',
        unit: 'un',
        needed_qty: 4,
        stock_qty: 1,
      }),
    ], { netOfStock: true });
    expect(drafts[0].items[0]).toMatchObject({
      material_id: null,
      box_type_id: 'bt-colmeia',
      packaging_type: 'colmeia',
      quantity: 3,
      unit: 'un',
    });
  });

  it('fitilho de box_types permanece contínuo em metros', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({
        material_id: null,
        box_type_id: 'bt-fitilho',
        packaging_type: 'fitilho',
        product_name: 'FITILHO',
        unit: 'm',
        needed_qty: 2.75,
      }),
    ]);
    expect(drafts[0].items[0]).toMatchObject({
      box_type_id: 'bt-fitilho',
      quantity: 2.75,
      unit: 'm',
    });
  });

  it('identidade XOR rejeita linha com product e box_type simultâneos', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'produto', box_type_id: 'caixa', needed_qty: 4 }),
    ]);
    expect(drafts).toEqual([]);
  });

  it('1 PV, 1 material, 1 fornecedor → 1 OC com 1 item', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', product_name: 'Napa', supplier_id: 's1', supplier_name: 'Couros SA', needed_qty: 30, last_unit_price: 5 }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].supplier_id).toBe('s1');
    expect(drafts[0].supplier_name).toBe('Couros SA');
    expect(drafts[0].items).toHaveLength(1);
    expect(drafts[0].items[0].quantity).toBe(30);
    expect(drafts[0].total).toBe(150); // 30 × 5
  });

  it('múltiplo de compra: arredonda a qtd pra cima e expõe o excedente (azul)', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', product_name: 'Caixa Colmeia', needed_qty: 8800, last_unit_price: 1, purchase_multiple: 1000 }),
    ]);
    expect(drafts[0].items[0].quantity).toBe(9000);
    expect(drafts[0].items[0].rounding_surplus).toBe(200);
    expect(drafts[0].total).toBe(9000); // 9000 × 1
  });

  it('múltiplo de compra: sem múltiplo, sem excedente', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', needed_qty: 8800, last_unit_price: 1 }),
    ]);
    expect(drafts[0].items[0].quantity).toBe(8800);
    expect(drafts[0].items[0].rounding_surplus).toBe(0);
  });

  it('1 PV, 3 materiais, 2 fornecedores + 1 sem fornecedor → 3 OCs (2 + 1 "Sem Fornecedor")', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', product_name: 'Napa', supplier_id: 's1', supplier_name: 'Couros SA', needed_qty: 10, last_unit_price: 4 }),
      need({ material_id: 'm2', product_name: 'Forro', supplier_id: 's1', supplier_name: 'Couros SA', needed_qty: 5, last_unit_price: 2 }),
      need({ material_id: 'm3', product_name: 'Solado', supplier_id: 's2', supplier_name: 'Solados ME', needed_qty: 100, last_unit_price: 3 }),
      need({ material_id: 'm4', product_name: 'Cadarço', supplier_id: null, supplier_name: null, needed_qty: 8, last_unit_price: 1 }),
    ]);
    expect(drafts).toHaveLength(3);

    const couros = drafts.find((d) => d.supplier_id === 's1')!;
    expect(couros.items).toHaveLength(2); // napa + forro agrupados no mesmo fornecedor
    expect(couros.total).toBe(50); // 10×4 + 5×2

    const solados = drafts.find((d) => d.supplier_id === 's2')!;
    expect(solados.items).toHaveLength(1);
    expect(solados.total).toBe(300);

    const semForn = drafts.find((d) => d.supplier_id === null)!;
    expect(semForn.supplier_name).toBe(NO_SUPPLIER_LABEL);
    expect(semForn.items).toHaveLength(1);
    // "Sem Fornecedor" sempre por último
    expect(drafts[drafts.length - 1].supplier_id).toBeNull();
  });

  it('2 PVs com material sobreposto → soma quantidades no mesmo item', () => {
    // Simula a RPC retornando 2 linhas do mesmo material (uma por PV) —
    // mesclamos defensivamente por (material_id + cor).
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', product_name: 'Napa', color: 'Preto', supplier_id: 's1', supplier_name: 'Couros SA', needed_qty: 12, last_unit_price: 5 }),
      need({ material_id: 'm1', product_name: 'Napa', color: 'Preto', supplier_id: 's1', supplier_name: 'Couros SA', needed_qty: 8, last_unit_price: 5 }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toHaveLength(1);
    expect(drafts[0].items[0].quantity).toBe(20); // 12 + 8
    expect(drafts[0].total).toBe(100); // 20 × 5
  });

  it('mesma referência, cores diferentes → itens separados', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', product_name: 'Napa', color: 'Preto', needed_qty: 5 }),
      need({ material_id: 'm1', product_name: 'Napa', color: 'Branco', needed_qty: 7 }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toHaveLength(2);
  });

  it('default usa necessidade BRUTA (não neta estoque)', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', needed_qty: 30, stock_qty: 20, last_unit_price: 1 }),
    ]);
    expect(drafts[0].items[0].quantity).toBe(30);
    expect(drafts[0].items[0].net_of_stock).toBe(false);
  });

  it('netOfStock=true neta o estoque e descarta itens cobertos', () => {
    const drafts = buildPerPvPurchaseOrders(
      [
        need({ material_id: 'm1', product_name: 'A', needed_qty: 30, stock_qty: 20, last_unit_price: 1 }),
        need({ material_id: 'm2', product_name: 'B', needed_qty: 10, stock_qty: 50, last_unit_price: 1 }), // coberto
      ],
      { netOfStock: true },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toHaveLength(1);
    expect(drafts[0].items[0].material_id).toBe('m1');
    expect(drafts[0].items[0].quantity).toBe(10); // 30 − 20
    expect(drafts[0].items[0].net_of_stock).toBe(true);
  });

  it('converte estoque→compra: dm² vira placa INTEIRA (PLACA EVA, fator 150)', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({
        material_id: 'eva', product_name: 'PLACA EVA', unit: 'dm²', color: '',
        needed_qty: 10333.44, stock_qty: 0, last_unit_price: 0.11,
        purchase_unit: 'placa', conversion_factor: 150,
      }),
    ]);
    const item = drafts[0].items[0];
    expect(item.unit).toBe('placa');
    expect(item.quantity).toBe(69); // ceil(10333.44 / 150 = 68.89)
    expect(item.needed_qty).toBeCloseTo(68.89, 2);
    expect(item.unit_price).toBeCloseTo(16.5, 2); // R$/dm² 0,11 × 150 = R$/placa
    // total invariante (~ valor em dm²), a menos do arredondamento pra placa inteira
    expect(item.quantity * item.unit_price).toBeCloseTo(1138.5, 1);
  });

  it('conversão respeita netOfStock (neta em dm² antes de virar placa)', () => {
    const drafts = buildPerPvPurchaseOrders(
      [need({
        material_id: 'eva', unit: 'dm²', needed_qty: 10333.44, stock_qty: 150,
        last_unit_price: 0.11, purchase_unit: 'placa', conversion_factor: 150,
      })],
      { netOfStock: true },
    );
    // (10333.44 − 150)/150 = 67.89 → ceil 68 placas
    expect(drafts[0].items[0].quantity).toBe(68);
  });

  it('unidade contável (un) arredonda pra cima quando fracionada (caixa)', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'cx', product_name: 'CAIXA COLMEIA', unit: 'un', needed_qty: 183.264, last_unit_price: 5.5 }),
    ]);
    expect(drafts[0].items[0].quantity).toBe(184);
    expect(drafts[0].items[0].rounding_surplus).toBeCloseTo(0.736, 3);
  });

  it('unidade contínua (m/kg) NÃO arredonda pra inteiro', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'napa', unit: 'm', needed_qty: 82.6, last_unit_price: 13.34 }),
    ]);
    expect(drafts[0].items[0].quantity).toBeCloseTo(82.6, 3);
  });

  it('ignora linhas inválidas (sem material_id) e quantidade zero', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: '', needed_qty: 5 }),
      need({ material_id: 'm1', needed_qty: 0 }),
      need({ material_id: 'm2', needed_qty: 4 }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toHaveLength(1);
    expect(drafts[0].items[0].material_id).toBe('m2');
  });
});

describe('summarizePerPvDrafts', () => {
  it('resume contagens e total', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', supplier_id: 's1', supplier_name: 'A', needed_qty: 10, last_unit_price: 1 }),
      need({ material_id: 'm2', supplier_id: 's2', supplier_name: 'B', needed_qty: 5, last_unit_price: 2 }),
      need({ material_id: 'm3', supplier_id: null, supplier_name: null, needed_qty: 3, last_unit_price: 1 }),
    ]);
    const s = summarizePerPvDrafts(drafts);
    expect(s.orderCount).toBe(3);
    expect(s.supplierCount).toBe(2);
    expect(s.hasNoSupplier).toBe(true);
    expect(s.noSupplierItemCount).toBe(1);
    expect(s.itemCount).toBe(3);
    expect(s.total).toBe(23); // 10 + 10 + 3
  });
});

describe('fornecedor obrigatório da embalagem canônica', () => {
  it('bloqueia apenas box_types sem fornecedor; product comum mantém o balde manual', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({
        material_id: null,
        box_type_id: 'bt-colmeia',
        product_name: 'CAIXA COLMEIA 11',
        unit: 'un',
        supplier_id: null,
        needed_qty: 4,
      }),
      need({
        material_id: 'produto-sem-fornecedor',
        product_name: 'MATERIAL COMUM',
        supplier_id: null,
        needed_qty: 2,
      }),
    ]);

    expect(collectPerPvPackagingWithoutSupplier(drafts)).toEqual([
      expect.objectContaining({
        material_id: null,
        box_type_id: 'bt-colmeia',
        product_name: 'CAIXA COLMEIA 11',
      }),
    ]);
  });
});

describe('identificação do item pro fornecedor', () => {
  it('leva código (SKU) e descrição técnica pro item da OC', () => {
    // O fornecedor separa o pedido pela OC: sem código nem especificação,
    // "Binóculo 10mm" é ambíguo entre acabamentos. buildPerPvPurchaseOrders monta
    // o item campo a campo (não por spread), então esses dois precisam de
    // propagação explícita — este guard trava isso.
    const drafts = buildPerPvPurchaseOrders([
      need({
        material_id: 'bino',
        product_name: 'Binóculo 10mm',
        color: 'OURO LIGHT',
        sku: '8440418106',
        technical_name: 'BINOCULO 10MM OURO LIGHT +-1000PCS',
        unit: 'un',
        needed_qty: 5760,
      }),
    ]);
    const item = drafts[0].items[0];
    expect(item.sku).toBe('8440418106');
    expect(item.technical_name).toBe('BINOCULO 10MM OURO LIGHT +-1000PCS');
    expect(item.color).toBe('OURO LIGHT');
  });

  it('item sem código/descrição no cadastro não quebra o empacotamento', () => {
    const drafts = buildPerPvPurchaseOrders([need({ material_id: 'sem-sku' })]);
    expect(drafts[0].items[0].sku).toBeNull();
    expect(drafts[0].items[0].technical_name).toBeNull();
  });
});

describe('isPerPvPurchaseOrder', () => {
  it('só é per_pv quando source_type === "per_pv"', () => {
    expect(isPerPvPurchaseOrder({ source_type: 'per_pv' })).toBe(true);
    expect(isPerPvPurchaseOrder({ source_type: 'manual' })).toBe(false);
    expect(isPerPvPurchaseOrder({ source_type: 'mrp' })).toBe(false);
    expect(isPerPvPurchaseOrder({ source_type: null })).toBe(false);
    expect(isPerPvPurchaseOrder({})).toBe(false);
    expect(isPerPvPurchaseOrder(null)).toBe(false);
  });
});

describe('fronteira estrutural de tiras no canal per_pv', () => {
  const guard = createPerPvStrapIdentityGuard({
    catalog: {
      variants: [{ id: 'variant-soft-preto', finished_product_id: 'product-strap-soft-preto' }],
      groups: [{ id: 'group-strap-finished', is_artisanal_strap: true }],
      official_products: [{ official_product_id: 'product-napa-soft-preto' }],
    },
    products: [
      { id: 'product-strap-soft-preto', group_id: 'group-strap-finished', is_artisanal: false },
      { id: 'legacy-artisanal', group_id: 'group-legacy', is_artisanal: true },
      { id: 'product-napa-soft-preto', group_id: 'group-napa', is_artisanal: false },
      { id: 'common', group_id: 'group-common', is_artisanal: false },
    ],
    groups: [
      { id: 'group-strap-finished', is_artisanal_strap: true },
      { id: 'group-napa', is_artisanal_strap: false },
      { id: 'group-common', is_artisanal_strap: false },
    ],
  });

  it('separa produto acabado canônico, FK de variante, linha técnica e flag legada exata', () => {
    const result = partitionPerPvStrapPurchaseItems([
      need({ material_id: 'product-strap-soft-preto', product_name: 'Produto acabado neutro' }),
      need({ material_id: 'unknown-product', product_name: 'Sem nome de tira', strap_variant_id: 'archived-variant' }),
      need({ material_id: 'another-product', product_name: 'Linha técnica', technical_strap_line_id: 'technical-line-id' }),
      need({ material_id: 'legacy-artisanal', product_name: 'Legado estrutural' }),
      need({ material_id: 'common', product_name: 'Material comum' }),
    ], guard);

    expect(result.straps.map((item) => item.material_id)).toEqual([
      'product-strap-soft-preto',
      'unknown-product',
      'another-product',
      'legacy-artisanal',
    ]);
    expect(result.common.map((item) => item.material_id)).toEqual(['common']);
  });

  it('não classifica por nome e não remove a napa-base oficial quando ela é material comum', () => {
    const result = partitionPerPvStrapPurchaseItems([
      need({ material_id: 'common', product_name: 'TIRA DE FIXAÇÃO DA MÁQUINA' }),
      need({ material_id: 'product-napa-soft-preto', product_name: 'NAPA SOFT PRETO' }),
    ], guard);

    expect(result.straps).toEqual([]);
    expect(result.common.map((item) => item.material_id)).toEqual([
      'common',
      'product-napa-soft-preto',
    ]);
  });

  it('remove a tira de um draft misto e recalcula o total só com materiais comuns', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'product-strap-soft-preto', needed_qty: 4, last_unit_price: 8 }),
      need({ material_id: 'common', needed_qty: 3, last_unit_price: 5 }),
    ]);
    const result = excludeStrapsFromPerPvDrafts(drafts, guard);

    expect(result.excluded.map((item) => item.material_id)).toEqual(['product-strap-soft-preto']);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].items.map((item) => item.material_id)).toEqual(['common']);
    expect(result.drafts[0].total).toBe(15);
  });
});

/**
 * GATE do aviso do motor de materiais comuns. A fronteira estrutural acima tira
 * o domínio artesanal deste canal; conversão/largura inválida ainda pode voltar
 * com needed_qty 0 + conversion_warning e precisa continuar visível.
 */
describe('collectPvNeedWarnings', () => {
  const BLOCK = 'NAPA CABEDAL está sem largura válida na ficha de componente — cadastre a largura antes de comprar.';

  it('a linha bloqueada não vira item de OC, mas o aviso sobrevive', () => {
    const needs = [need({ material_id: 'napa-cabedal', product_name: 'NAPA CABEDAL', color: 'BEGE', needed_qty: 0, conversion_warning: BLOCK })];
    expect(buildPerPvPurchaseOrders(needs)).toHaveLength(0);
    const warnings = collectPvNeedWarnings(needs);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe(BLOCK);
    expect(warnings[0].needed_qty).toBe(0);
  });

  it('linha que ENTRA na OC com aviso carrega a mensagem até o item', () => {
    const needs = [need({ material_id: 'napa-1', product_name: 'NAPA SOFT', needed_qty: 30, conversion_warning: 'largura faltando' })];
    const item = buildPerPvPurchaseOrders(needs)[0].items[0];
    expect(item.conversion_warning).toBe('largura faltando');
    expect(collectPvNeedWarnings(needs)[0].needed_qty).toBe(30);
  });

  it('não inventa aviso quando não há', () => {
    expect(collectPvNeedWarnings([need({})])).toEqual([]);
    expect(collectPvNeedWarnings([need({ conversion_warning: '   ' })])).toEqual([]);
  });

  it('deduplica o mesmo aviso repetido e põe o bloqueio total na frente', () => {
    const warnings = collectPvNeedWarnings([
      need({ material_id: 'a', product_name: 'A', needed_qty: 5, conversion_warning: 'aviso A' }),
      need({ material_id: 'b', product_name: 'B', needed_qty: 0, conversion_warning: BLOCK }),
      need({ material_id: 'b', product_name: 'B', needed_qty: 0, conversion_warning: BLOCK }),
    ]);
    expect(warnings.map((w) => w.product_name)).toEqual(['B', 'A']);
  });
});

describe('collectOpenPurchaseWarnings', () => {
  it('mantém o aviso de OC/ROP separado dos erros de conversão e deduplica por produto', () => {
    const warning = 'Já existe compra aberta para "COLA PVC" na OC OC-00188.';
    const warnings = collectOpenPurchaseWarnings([
      need({ material_id: 'cola', product_name: 'COLA PVC', open_purchase_warning: warning }),
      need({ material_id: 'cola', product_name: 'COLA PVC', open_purchase_warning: warning }),
      need({ material_id: 'napa', product_name: 'NAPA', open_purchase_warning: null }),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ material_id: 'cola', message: warning });
  });
});
