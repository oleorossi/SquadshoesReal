import { describe, expect, it } from 'vitest';
import {
  buildCopySeedPayload,
  buildItemsPurchaseSignature,
  buildSaleOrderEditorRevision,
  clearSaleOrderDraft,
  editorChangedDuringSave,
  mapLoadedSaleOrderItem,
  resolveSaleOrderMutationTarget,
} from '../SaleOrderForm';
import type { SaleOrderFormData, SaleOrderItemFormData } from '@/hooks/useSaleOrders';

describe('contenções do estado do editor de PV', () => {
  const form = {
    client_name: 'Cliente',
    status: 'Rascunho',
    packaging_mode: 'colmeia',
  } as SaleOrderFormData;
  const item = {
    reference_id: 'ref-1',
    color: 'PRETO',
    quantity: 10,
    grade: { '37': 10 },
    unit_price: 100,
    material_variant_id: 'variant-1',
  } as SaleOrderItemFormData;

  it('invalida a assinatura de compra ao mudar variante de material ou embalagem', () => {
    const base = buildItemsPurchaseSignature([item], 'colmeia');
    expect(buildItemsPurchaseSignature([{ ...item, material_variant_id: 'variant-2' }], 'colmeia'))
      .not.toBe(base);
    expect(buildItemsPurchaseSignature([item], 'individual_master'))
      .not.toBe(base);
  });

  it('detecta alterações por revisão completa do estado, inclusive seletores fora do DOM', () => {
    const base = buildSaleOrderEditorRevision({
      form,
      items: [item],
      selectedClientId: 'client-1',
      packagingProductId: 'pack-1',
      packagingQuantity: 10,
    });
    expect(buildSaleOrderEditorRevision({
      form,
      items: [item],
      selectedClientId: 'client-1',
      packagingProductId: 'pack-1',
      packagingQuantity: 10,
    })).toBe(base);
    expect(buildSaleOrderEditorRevision({
      form,
      items: [item],
      selectedClientId: 'client-2',
      packagingProductId: 'pack-1',
      packagingQuantity: 10,
    })).not.toBe(base);
  });

  it('preserva dirty quando o usuário edita enquanto a mutation está em voo', () => {
    const submittedRevision = buildSaleOrderEditorRevision({
      form,
      items: [item],
      selectedClientId: 'client-1',
      packagingProductId: 'pack-1',
      packagingQuantity: 10,
    });
    const latestRevision = buildSaleOrderEditorRevision({
      form: { ...form, notes: 'alterado depois do clique em salvar' },
      items: [item],
      selectedClientId: 'client-1',
      packagingProductId: 'pack-1',
      packagingQuantity: 10,
    });

    expect(editorChangedDuringSave(submittedRevision, latestRevision)).toBe(true);
    expect(editorChangedDuringSave(submittedRevision, submittedRevision)).toBe(false);
  });

  it('continua um CREATE confirmado como UPDATE do mesmo PV', () => {
    const continuation = {
      id: 'pv-ja-criado',
      orderVersion: 4,
    };

    expect(resolveSaleOrderMutationTarget(undefined, continuation)).toBe('pv-ja-criado');
    expect(resolveSaleOrderMutationTarget('pv-da-rota', continuation)).toBe('pv-da-rota');
    expect(resolveSaleOrderMutationTarget(undefined, null)).toBeNull();
  });

  it('limpa apenas o rascunho namespaced do usuário após criar', () => {
    sessionStorage.setItem('sale_order_draft:vendedor-1', 'rascunho-1');
    localStorage.setItem('sale_order_draft:vendedor-1', 'rascunho-1');
    localStorage.setItem('sale_order_draft:vendedor-2', 'rascunho-2');

    clearSaleOrderDraft('vendedor-1');

    expect(sessionStorage.getItem('sale_order_draft:vendedor-1')).toBeNull();
    expect(localStorage.getItem('sale_order_draft:vendedor-1')).toBeNull();
    expect(localStorage.getItem('sale_order_draft:vendedor-2')).toBe('rascunho-2');
    localStorage.removeItem('sale_order_draft:vendedor-2');
  });
});

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
        strap_sourcing_revision: 7,
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
    expect(mappedItems[0].strap_sourcing_revision).toBe(7);
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
      strap_colors: [{
        id: '11111111-1111-4111-8111-111111111111',
        technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
        label: 'TIRA CHATA 8MM',
        color: 'PRETO',
        color_id: '22222222-2222-4222-8222-222222222222',
      }],
      strap_sourcing: {
        '11111111-1111-4111-8111-111111111111': {
          source_mode: 'internal',
          color_id: '22222222-2222-4222-8222-222222222222',
          strap_variant_id: '33333333-3333-4333-8333-333333333333',
          recipe_id: '44444444-4444-4444-8444-444444444444',
        },
      },
      strap_sourcing_revision: 4,
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
    sourceOrderNumber: 'PV-2026-00123',
    activeVariantIds: new Set(['variant-ativa']),
    companyIsActive: true,
  });

  it('NÃO leva o id do item — o novo PV cria linhas novas, nunca atualiza as do pedido origem', () => {
    expect(seed.items.every((it) => !('id' in it) || it.id === undefined)).toBe(true);
    expect(seed.items.every((it) => !('strap_sourcing_revision' in it))).toBe(true);
  });

  it('preserva a definição física do item (ref, cor, grade, preço, tiras, sourcing, observação)', () => {
    expect(seed.items[0]).toMatchObject({
      reference_id: 'ref-1',
      color: 'PRETO',
      grade: { '37': 4, '38': 6 },
      unit_price: 100,
      quantity: 10,
      fichas: 1,
      strap_colors: [{
        id: '11111111-1111-4111-8111-111111111111',
        technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
        label: 'TIRA CHATA 8MM',
        color: 'PRETO',
        color_id: '22222222-2222-4222-8222-222222222222',
      }],
      strap_sourcing: {
        '11111111-1111-4111-8111-111111111111': {
          source_mode: 'internal',
          color_id: '22222222-2222-4222-8222-222222222222',
          strap_variant_id: '33333333-3333-4333-8333-333333333333',
          recipe_id: '44444444-4444-4444-8444-444444444444',
        },
      },
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
      status: 'Rascunho',
    });
  });

  it('cabeçalho: NÃO leva datas de entrega, OC do cliente, NF nem notas (pedido novo, agenda nova)', () => {
    for (const campo of ['delivery_deadline', 'delivery_week', 'delivery_month', 'client_order_number', 'nfe', 'remessa', 'notes'] as const) {
      expect((seed.form as Record<string, unknown>)[campo]).toBeUndefined();
    }
  });

  // Salvar um Rascunho com frete > 0 já cria despesa 'pendente' em financial_entries
  // (gatilho tg_sale_order_creates_shipping_expense) com vencimento contado de hoje,
  // e o painel lê o campo num useState do próprio mount — o seed chega depois, então
  // a tela mostraria R$ 0,00 enquanto o valor ia no payload. Frete é do embarque novo.
  it('NÃO leva o frete por par — evita despesa invisível no financeiro do PV novo', () => {
    expect(seed.form.shipping_rate_per_pair).toBeUndefined();
  });

  it('guarda o número do PV de origem só pra avisar na tela', () => {
    expect(seed.sourceOrderNumber).toBe('PV-2026-00123');
  });

  // No sale_orders.parent_order_id, "pai" significa DUPLICATA DE GRUPO ECONÔMICO:
  // o dialog Duplicar por Grupo remove da lista toda loja que já tem PV filho
  // daquele pai. Como aqui o usuário pode trocar o cliente antes de salvar,
  // marcar a cópia parcial como filha esconderia em silêncio uma loja que recebeu
  // 2 de 10 itens, bloqueando a duplicação do pedido inteiro pra ela.
  it('NÃO marca a cópia como filha do PV origem — isso é vocabulário do Duplicar por Grupo', () => {
    expect('parentOrderId' in seed).toBe(false);
  });

  it('empresa emitente inativa não viaja — cai na primária em vez de gravar CNPJ errado na NF-e', () => {
    const comEmpresaInativa = buildCopySeedPayload({
      seedItems: items,
      form: { ...form, company_id: 'empresa-desativada' } as SaleOrderFormData,
      selectedClientId: 'client-1',
      sourceOrderNumber: null,
      activeVariantIds: new Set(['variant-ativa']),
      companyIsActive: false,
    });
    expect(comEmpresaInativa.form.company_id).toBeNull();

    const comEmpresaAtiva = buildCopySeedPayload({
      seedItems: items,
      form: { ...form, company_id: 'empresa-ativa' } as SaleOrderFormData,
      selectedClientId: 'client-1',
      sourceOrderNumber: null,
      activeVariantIds: new Set(['variant-ativa']),
      companyIsActive: true,
    });
    expect(comEmpresaAtiva.form.company_id).toBe('empresa-ativa');
  });
});
