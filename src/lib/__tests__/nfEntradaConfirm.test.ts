import { describe, expect, it } from 'vitest';
import { confirmNfEntrada } from '@/lib/nfEntradaConfirm';
import type { ParsedNFe } from '@/lib/nfeParser';

const parsed: ParsedNFe = {
  invoiceNumber: '1',
  series: '1',
  key: '',
  issueDate: '2026-11-25',
  totalValue: 10,
  freightValue: 0,
  discountValue: 0,
  supplier: { name: 'X', tradeName: '', cnpj: '', ie: '', address: '', city: '', state: '', phone: '' },
  items: [{ productCode: 'A', productName: 'Item', ncm: '', cfop: '', unit: 'UN', quantity: 1, unitPrice: 10, totalPrice: 10, discount: 0 }],
  duplicatas: [],
  paymentMethod: '',
};

const base = {
  parsed,
  xmlRaw: '<xml/>',
  includedIndexes: [0],
  supplierId: 's1',
  createSupplier: false,
  purchaseOrderId: 'po1',
  expectedUpdatedAt: null,
  poItems: [],
  resolutions: {},
  creditWithoutPo: false,
};

describe('confirmNfEntrada', () => {
  it('recusa receber OC rascunho ou sugerida sem confirmação explícita, sem gravar nada', async () => {
    await expect(confirmNfEntrada({ ...base, purchaseOrderStatus: 'draft', draftConfirmed: false }))
      .rejects.toThrow(/rascunho ou sugerida/);
    await expect(confirmNfEntrada({ ...base, purchaseOrderStatus: 'suggested', draftConfirmed: false }))
      .rejects.toThrow(/rascunho ou sugerida/);
  });

  it('recusa NF sem item selecionado', async () => {
    await expect(confirmNfEntrada({ ...base, includedIndexes: [], purchaseOrderStatus: 'sent', draftConfirmed: false }))
      .rejects.toThrow(/ao menos um item/);
  });
});
