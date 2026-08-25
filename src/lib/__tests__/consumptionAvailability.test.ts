import { describe, it, expect } from 'vitest';
import {
  aggregateItems,
  countPending,
  countShort,
  itemShortfall,
  rowIsShort,
  rowKnown,
  rowShortfall,
  soleShortSizes,
  topShortfalls,
} from '../consumptionAvailability';
import type { ConsumptionRow } from '../consumptionRows';

const row = (o: Partial<ConsumptionRow>): ConsumptionRow => ({
  componentType: 'Forração Palmilha',
  groupName: 'NAPA SOFT',
  materialName: 'Forração Palmilha',
  color: 'PRETO',
  productUnit: 'm',
  totalQuantity: 1,
  ...o,
} as ConsumptionRow);

describe('rowShortfall', () => {
  it('devolve quanto falta na unidade da linha', () => {
    const r = row({ totalQuantity: 10.16, available: 0 });
    expect(rowIsShort(r)).toBe(true);
    expect(rowShortfall(r)).toBeCloseTo(10.16, 2);
  });

  it('é 0 quando o estoque cobre', () => {
    expect(rowShortfall(row({ totalQuantity: 1, available: 5.01 }))).toBe(0);
  });

  it('é 0 — não negativo nem inflado — quando o cadastro está incompleto', () => {
    // Largura da ficha faltando: o consumo está ~100× inflado, comparar com
    // estoque produziria uma falta fantasma de 507 m.
    const inflada = row({ totalQuantity: 508, available: 1, widthMissing: true });
    expect(rowKnown(inflada)).toBe(false);
    expect(rowIsShort(inflada)).toBe(false);
    expect(rowShortfall(inflada)).toBe(0);
  });
});

describe('solado — avaliado por numeração', () => {
  /** 540 pares com estoque total 540, mas mal distribuído entre os números. */
  const solado = row({
    componentType: 'Solado',
    groupName: 'SOLADO 01',
    productUnit: 'par',
    totalQuantity: 540,
    sizeBreakdown: { '35': 90, '36': 108, '37': 90 },
    soleSizeStock: { '35': 12, '36': 0, '37': 416 },
  });

  it('não se deixa enganar pelo total: falta por número', () => {
    expect(rowIsShort(solado)).toBe(true);
    expect(soleShortSizes(solado)).toEqual(['35', '36']);
    // (90−12) + (108−0) = 186 pares, ignorando a sobra do 37.
    expect(rowShortfall(solado)).toBe(186);
  });

  it('sem quebra por numeração cai no total', () => {
    const semGrade = row({
      componentType: 'Solado', productUnit: 'par', totalQuantity: 540,
      soleSizeStock: { '36': 300 },
    });
    expect(rowShortfall(semGrade)).toBe(240);
  });
});

describe('item = balde de estoque (produto exato; fallback grupo + cor + unidade)', () => {
  // Mesma napa, mesma cor, DUAS aplicações: dividem o mesmo estoque.
  const duasAplicacoes = [
    row({ materialName: 'Forração', componentType: 'Forração', totalQuantity: 2, available: 5 }),
    row({ materialName: 'Forração Palmilha', totalQuantity: 4, available: 5 }),
  ];

  it('soma o consumo das aplicações e avalia o estoque UMA vez', () => {
    const [item] = aggregateItems(duasAplicacoes);
    expect(item.total).toBe(6);
    expect(item.available).toBe(5); // representante, nunca 5+5
    expect(itemShortfall(item)).toBe(1);
  });

  it('conta em falta por item, não por linha', () => {
    // Linha a linha, nenhuma das duas está em falta (2<5 e 4<5) — juntas, sim.
    expect(duasAplicacoes.every((r) => !rowIsShort(r))).toBe(true);
    expect(countShort(duasAplicacoes)).toBe(1);
  });

  it('cadastro incompleto em qualquer aplicação torna o item não comparável', () => {
    const [item] = aggregateItems([
      row({ totalQuantity: 4, available: 1 }),
      row({ materialName: 'Forração', totalQuantity: 508, available: 1, widthMissing: true }),
    ]);
    expect(item.known).toBe(false);
    expect(itemShortfall(item)).toBe(0);
  });

  it('mantém produtos exatos distintos separados mesmo no mesmo grupo/cor/unidade', () => {
    const produtosDistintos = [
      row({ materialName: 'COLA FORTE', totalQuantity: 100, available: 100, productIds: ['p-cola-forte'] }),
      row({ materialName: 'HOTMELT', totalQuantity: 100, available: 100, productIds: ['p-hotmelt'] }),
    ];

    const items = aggregateItems(produtosDistintos);
    expect(items).toHaveLength(2);
    expect(items.every((item) => itemShortfall(item) === 0)).toBe(true);
    expect(countShort(produtosDistintos)).toBe(0);
  });

  it('continua compartilhando estoque entre aplicações do mesmo produto exato', () => {
    const mesmoProduto = [
      row({ materialName: 'Forração', totalQuantity: 2, available: 5, productIds: ['p-napa'] }),
      row({ materialName: 'Forração Palmilha', totalQuantity: 4, available: 5, productIds: ['p-napa'] }),
    ];

    const [item] = aggregateItems(mesmoProduto);
    expect(aggregateItems(mesmoProduto)).toHaveLength(1);
    expect(item.total).toBe(6);
    expect(item.available).toBe(5);
    expect(itemShortfall(item)).toBe(1);
  });
});

describe('countPending', () => {
  it('conta as linhas marcadas com ▲, das duas naturezas', () => {
    const rows = [
      row({ widthMissing: true }),
      row({ warning: 'solado fachetado sem consumo de fachete', totalQuantity: 0 }),
      row({ warning: 'não resolve produto no estoque', totalQuantity: 3 }),
      row({}),
    ];
    expect(countPending(rows)).toBe(3);
  });
});

describe('topShortfalls', () => {
  it('ordena as maiores faltas e conta os números do solado', () => {
    const top = topShortfalls([
      row({ groupName: 'PALMILHA: OURO LIGHT', color: 'OURO LIGHT', totalQuantity: 10.16, available: 0 }),
      row({ groupName: 'EVA 3MM', totalQuantity: 5.08, available: 0 }),
      row({ groupName: 'NAPA SOFT', color: 'PRETO', totalQuantity: 1, available: 5.01 }),
      row({
        componentType: 'Solado', groupName: 'SOLADO 01', productUnit: 'par',
        totalQuantity: 198, sizeBreakdown: { '35': 90, '36': 108 }, soleSizeStock: {},
      }),
    ], 3);

    expect(top.map((t) => t.label)).toEqual(['SOLADO 01', 'PALMILHA: OURO LIGHT', 'EVA 3MM']);
    expect(top[0].sizes).toBe(2);
    expect(top[0].qty).toBe(198);
    // O que está coberto não aparece.
    expect(top.some((t) => t.label === 'NAPA SOFT')).toBe(false);
  });
});
