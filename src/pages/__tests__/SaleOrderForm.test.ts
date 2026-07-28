import { describe, expect, it } from 'vitest';
import { mapLoadedSaleOrderItem } from '../SaleOrderForm';

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
