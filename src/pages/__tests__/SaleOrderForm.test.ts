import { describe, expect, it } from 'vitest';
import { buildCopySeedPayload, mapLoadedSaleOrderItem } from '../SaleOrderForm';
import type { SaleOrderFormData, SaleOrderItemFormData } from '@/hooks/useSaleOrders';

// Guard de regressão do incidente PV-00146: ao carregar os itens de um PV para
// edição, o `id` de cada sale_order_item TEM que ser preservado — sem ele, o
// save recria o item e desmonta OP/OS/alocação vinculadas.
describe('mapLoadedSaleOrderItem', () => {
  it('preserva o id de cada item carregado do PV', () => {
    const canonicalReferenceIdMap = new Map([
      ['legacy-reference', 'canonical-reference'],
    ]);
    const loadedItems = [
      {
        id: 'sale-order-item-1',
        reference_id: 'legacy-reference',
        color: 'Preto',
        grade: { '37': 4, '38': 6 },
        unit_price: 125,
        quantity: 10,
        strap_colors: [],
      },
      {
        id: 'sale-order-item-2',
        reference_id: 'canonical-reference',
        color: 'Branco',
        grade: { '35': 3, '36': 5 },
        unit_price: 150,
        quantity: 8,
        strap_colors: [],
      },
    ];

    const mappedItems = loadedItems.map((item) =>
      mapLoadedSaleOrderItem(item, canonicalReferenceIdMap),
    );

    expect(mappedItems.map((item) => item.id)).toEqual([
      'sale-order-item-1',
      'sale-order-item-2',
    ]);
    // canonicaliza o reference_id legado
    expect(mappedItems[0].reference_id).toBe('canonical-reference');
  });
});

// Cópia parcial de itens (edição → novo PV). As guardas aqui são o INVERSO do
// teste acima: na cópia, o `id` do item NÃO pode viajar — copiá-lo faria o
// save do novo PV "atualizar" linha de OUTRO pedido (o id é a identidade
// estável do item, migration 20260919120000).
describe('buildCopySeedPayload', () => {
  const form: SaleOrderFormData = {
    client_id: 'client-1',
    client_name: 'PONTO MIX',
    client_cnpj: '00000000000191',
    client_contact: 'Maria',
    client_order_number: 'OC-CLIENTE-77',
    representative: 'rep-1',
    payment_condition: '30/60',
    delivery_deadline: '2026-08-20',
    delivery_week: 'W34',
    delivery_month: '2026-08',
    notes: 'entregar na loja 2',
    status: 'Aprovado',
    nfe: '123',
    remessa: 'R-9',
    is_factoring: true,
    factoring_config_id: 'fact-1',
    packaging_mode: 'colmeia',
    shipping_rate_per_pair: 1.5,
    nfe_required: true,
    own_delivery: false,
    brand: 'Squad Shoes',
    order_type: 'carteira',
  };

  const items: SaleOrderItemFormData[] = [
    {
      id: 'item-db-1',
      reference_id: 'ref-1',
      color: 'PRETO',
      grade: { '37': 4, '38': 6 },
      unit_price: 100,
      quantity: 10,
      fichas: 1,
      strap_colors: [{ id: 'g1', label: 'TIRA CHATA 8MM', color: 'PRETO' }],
      strap_sourcing: { 'g1|PRETO': 'in_house' },
      observation: 'obs do item',
      material_variant_id: 'variant-ativa',
      selected_terceirizacao_ids: ['terc-1'],
      terceirizacao_quantities: { 'terc-1': 5 },
      outsourced_sectors: { costura: 'contractor-1' },
    },
    {
      id: 'item-db-2',
      reference_id: 'ref-2',
      color: 'OFF WHITE',
      grade: { '35': 8 },
      unit_price: 120,
      quantity: 8,
      fichas: 1,
      material_variant_id: 'variant-inativa',
    },
  ];

  const seed = buildCopySeedPayload({
    seedItems: items,
    form,
    selectedClientId: 'client-1',
    parentOrderId: 'pv-origem',
    sourceOrderNumber: 'PV-2026-00123',
    activeVariantIds: new Set(['variant-ativa']),
  });

  it('NÃO leva o id do item — o novo PV cria linhas novas, nunca atualiza as do pedido origem', () => {
    expect(seed.items.every((it) => !('id' in it) || it.id === undefined)).toBe(true);
  });

  it('preserva a definição física do item (ref, cor, grade, preço, tiras, sourcing, observação)', () => {
    expect(seed.items[0]).toMatchObject({
      reference_id: 'ref-1',
      color: 'PRETO',
      grade: { '37': 4, '38': 6 },
      unit_price: 100,
      quantity: 10,
      fichas: 1,
      strap_colors: [{ id: 'g1', label: 'TIRA CHATA 8MM', color: 'PRETO' }],
      strap_sourcing: { 'g1|PRETO': 'in_house' },
      observation: 'obs do item',
    });
  });

  it('reseta a intenção de terceirização — herdá-la geraria OS no save do novo PV sem ninguém pedir', () => {
    for (const it of seed.items) {
      expect(it.selected_terceirizacao_ids).toEqual([]);
      expect(it.terceirizacao_quantities).toEqual({});
      expect(it.outsourced_sectors).toEqual({});
    }
  });

  it('mantém variante de material ATIVA e limpa a inativa (id obsoleto bloqueia a NF-e)', () => {
    expect(seed.items[0].material_variant_id).toBe('variant-ativa');
    expect(seed.items[1].material_variant_id).toBeNull();
  });

  it('cabeçalho: leva cliente + condições comerciais, nasce Rascunho', () => {
    expect(seed.form).toMatchObject({
      client_id: 'client-1',
      client_name: 'PONTO MIX',
      client_cnpj: '00000000000191',
      client_contact: 'Maria',
      representative: 'rep-1',
      payment_condition: '30/60',
      is_factoring: true,
      factoring_config_id: 'fact-1',
      packaging_mode: 'colmeia',
      shipping_rate_per_pair: 1.5,
      status: 'Rascunho',
    });
  });

  it('cabeçalho: NÃO leva datas de entrega, OC do cliente, NF nem notas (pedido novo, agenda nova)', () => {
    for (const campo of ['delivery_deadline', 'delivery_week', 'delivery_month', 'client_order_number', 'nfe', 'remessa', 'notes'] as const) {
      expect((seed.form as Record<string, unknown>)[campo]).toBeUndefined();
    }
  });

  it('rastreabilidade: guarda o PV de origem (vira parent_order_id no create)', () => {
    expect(seed.parentOrderId).toBe('pv-origem');
    expect(seed.sourceOrderNumber).toBe('PV-2026-00123');
  });
});
