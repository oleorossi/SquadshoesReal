import { describe, expect, it } from 'vitest';
import { buildNfPoPreviewLines, previewStatusLabel } from '@/lib/nfEntradaPreview';

const products = [
  { id: 'napa', name: 'NAPA TITANIUM', sku: '21694', color: 'OFF WHITE', unit: 'm' },
  { id: 'cola', name: 'ADESIVO PVC', sku: 'AD-PVC', color: null, unit: 'un', purchase_unit: 'un', conversion_rate: 1 },
];

describe('buildNfPoPreviewLines', () => {
  it('casa item da NF com item da OC e marca diferença de quantidade e preço', () => {
    const lines = buildNfPoPreviewLines(
      [
        { productName: 'NAPA TITANIUM 2026 OFF WHITE', productCode: '21694', unit: 'MTL', quantity: 40, unitPrice: 12 },
        { productName: 'ADESIVO PVC 14 KG', productCode: 'AD-PVC', unit: 'UN', quantity: 7, unitPrice: 80 },
      ],
      products,
      [
        { id: 'po-napa', product_id: 'napa', quantity: 30, received_quantity: 0, unit: 'm', unit_price: 12 },
        { id: 'po-cola', product_id: 'cola', quantity: 7, received_quantity: 0, unit: 'un', unit_price: 75 },
      ],
    );
    expect(lines[0].status).toBe('qty_diff');
    expect(lines[0].productId).toBe('napa');
    expect(lines[0].poRemaining).toBe(30);
    expect(lines[0].stockQty).toBe(40);
    expect(lines[1].status).toBe('price_diff');
    expect(lines[1].poUnitPrice).toBe(75);
  });

  it('marca item sem cadastro e não inventa vínculo com a OC', () => {
    const lines = buildNfPoPreviewLines(
      [{ productName: 'PRODUTO NOVO XYZ', productCode: 'ZZZ', unit: 'UN', quantity: 1, unitPrice: 10 }],
      products,
      [{ id: 'po-napa', product_id: 'napa', quantity: 10, received_quantity: 0 }],
    );
    expect(lines[0].status).toBe('unmatched');
    expect(lines[0].productId).toBeNull();
    expect(lines[0].poItemId).toBeNull();
    expect(previewStatusLabel('unmatched')).toMatch(/cadastro/i);
  });

  it('casa quantidade e preço iguais como matched (MTL → m linear)', () => {
    const lines = buildNfPoPreviewLines(
      [{ productName: 'NAPA TITANIUM OFF WHITE', productCode: '21694', unit: 'MTL', quantity: 15, unitPrice: 10 }],
      products,
      [{ id: 'po-napa', product_id: 'napa', quantity: 15, received_quantity: 0, unit: 'm', unit_price: 10 }],
    );
    expect(lines[0].status).toBe('matched');
    expect(lines[0].conversion?.needsConfig).toBeFalsy();
  });
});
