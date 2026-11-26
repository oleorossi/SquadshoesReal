/**
 * Confirmação da tela Entrada por NF: cadastra (só o que o usuário pediu),
 * vincula a OC e dá entrada via comando receive. Nada é criado em silêncio.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ParsedNFe } from '@/lib/nfeParser';
import {
  buildReceiveReceipts,
  isDraftLikePoStatus,
  type OpenPoItem,
} from '@/lib/nfPoReceipt';
import { createProductWithStock } from '@/lib/stockCommand';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { executePurchaseOrderCommand, purchaseOrderLogicalKey } from '@/services/purchaseOrderCommandService';

export type UnmatchedResolution =
  | { kind: 'link'; productId: string }
  | {
      kind: 'create';
      name: string;
      sku: string;
      color: string | null;
      category: string;
      unit: string;
      groupId: string | null;
      supplierId: string | null;
      purchaseUnit: string | null;
      conversionRate: number | null;
    };

export type ConfirmNfEntradaInput = {
  parsed: ParsedNFe;
  xmlRaw: string;
  includedIndexes: number[];
  supplierId: string | null;
  createSupplier: boolean;
  purchaseOrderId: string | null;
  purchaseOrderStatus: string | null;
  expectedUpdatedAt: string | null;
  poItems: OpenPoItem[];
  draftConfirmed: boolean;
  resolutions: Record<number, UnmatchedResolution>;
  /** Se true e não houver OC, entra no estoque item a item (botão explícito). */
  creditWithoutPo: boolean;
};

export type ConfirmNfEntradaResult = {
  invoiceId: string;
  supplierId: string;
  purchaseOrderId: string | null;
  createdProductIds: string[];
  receivedItemCount: number;
  stockOnlyCount: number;
  complete?: boolean;
};

function digits(cnpj: string): string {
  return (cnpj || '').replace(/\D/g, '');
}

export async function confirmNfEntrada(input: ConfirmNfEntradaInput): Promise<ConfirmNfEntradaResult> {
  const included = input.parsed.items.filter((_, i) => input.includedIndexes.includes(i));
  if (included.length === 0) throw new Error('Selecione ao menos um item da NF.');

  if (input.purchaseOrderId && isDraftLikePoStatus(input.purchaseOrderStatus) && !input.draftConfirmed) {
    throw new Error('Confirme que deseja receber esta OC em rascunho ou sugerida. Isso não gera uma ordem de compra.');
  }

  let supplierId = input.supplierId;
  if (!supplierId) {
    if (!input.createSupplier) {
      throw new Error('Fornecedor não cadastrado. Marque a opção de cadastrá-lo para continuar.');
    }
    const cnpj = digits(input.parsed.supplier.cnpj);
    if (cnpj) {
      const { data: existing } = await supabase
        .from('suppliers')
        .select('id')
        .eq('cnpj', input.parsed.supplier.cnpj)
        .maybeSingle();
      if (existing?.id) supplierId = existing.id;
    }
    if (!supplierId) {
      const { data, error } = await supabase
        .from('suppliers')
        .insert({
          name: input.parsed.supplier.name || input.parsed.supplier.tradeName || 'Fornecedor da NF',
          trade_name: input.parsed.supplier.tradeName || null,
          cnpj: input.parsed.supplier.cnpj || null,
          ie: input.parsed.supplier.ie || null,
          phone: input.parsed.supplier.phone || null,
          city: input.parsed.supplier.city || null,
          state: input.parsed.supplier.state || null,
          address: input.parsed.supplier.address || null,
          active: true,
        })
        .select('id')
        .single();
      if (error) throw new Error(`Falha ao cadastrar fornecedor: ${error.message}`);
      supplierId = data.id;
    }
  }

  const createdProductIds: string[] = [];
  const indexToProduct = new Map<number, string>();

  for (const idx of input.includedIndexes) {
    const resolution = input.resolutions[idx];
    if (!resolution) continue;
    if (resolution.kind === 'link') {
      indexToProduct.set(idx, resolution.productId);
      continue;
    }
    const created = await createProductWithStock({
      name: resolution.name,
      sku: resolution.sku,
      category: resolution.category,
      unit: resolution.unit,
      location: 'Almoxarifado A',
      quantity: 0,
      unit_price: included.find((_, j) => input.includedIndexes[j] === idx)
        ? input.parsed.items[idx].unitPrice
        : input.parsed.items[idx].unitPrice,
      max_stock: 0,
      group_id: resolution.groupId,
      supplier_id: resolution.supplierId || supplierId,
      color: resolution.color,
      purchase_unit: resolution.purchaseUnit || resolution.unit,
      conversion_rate: resolution.conversionRate ?? 1,
      reason: `Cadastro pela NF ${input.parsed.invoiceNumber} — sem saldo (a entrada vem em seguida)`,
    });
    if (!created.success || !created.product_id) {
      throw new Error(created.errors?.[0]?.error || `Falha ao criar produto ${resolution.name}`);
    }
    createdProductIds.push(created.product_id);
    indexToProduct.set(idx, created.product_id);
  }

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      supplier_id: supplierId,
      invoice_number: input.parsed.invoiceNumber,
      invoice_series: input.parsed.series || '1',
      invoice_key: input.parsed.key || null,
      issue_date: input.parsed.issueDate || null,
      total_value: input.parsed.totalValue,
      freight_value: input.parsed.freightValue || 0,
      discount_value: input.parsed.discountValue || 0,
      xml_data: input.xmlRaw,
      status: 'imported',
      ...(input.purchaseOrderId ? { purchase_order_id: input.purchaseOrderId } : {}),
    })
    .select('id')
    .single();
  if (invErr) throw new Error(`Falha ao cadastrar a NF: ${invErr.message}`);

  const itemRows = input.includedIndexes.map((idx) => {
    const it = input.parsed.items[idx];
    const productId = indexToProduct.get(idx) ?? null;
    return {
      invoice_id: invoice.id,
      product_code: it.productCode,
      product_name: it.productName,
      ncm: it.ncm,
      cfop: it.cfop,
      unit: it.unit,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      total_price: it.totalPrice,
      discount: it.discount || 0,
      product_id: productId,
      added_to_stock: false,
    };
  });
  const { error: itemsErr } = await supabase.from('invoice_items').insert(itemRows);
  if (itemsErr) throw new Error(`Falha ao gravar itens da NF: ${itemsErr.message}`);

  const matchedIds = new Set([...indexToProduct.values()]);
  let receivedItemCount = 0;
  let stockOnlyCount = 0;
  let complete: boolean | undefined;

  if (input.purchaseOrderId) {
    const receipts = buildReceiveReceipts(input.poItems, matchedIds);
    if (receipts.length === 0) {
      throw new Error('Nenhum item em aberto nesta OC casa com a NF. Vincule ou crie os produtos e tente de novo.');
    }
    const result = await executePurchaseOrderCommand({
      command: 'receive',
      purchaseOrderId: input.purchaseOrderId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      payload: {
        receipts,
        received_date: new Date().toISOString().slice(0, 10),
        invoice_id: invoice.id,
      },
      logicalKey: purchaseOrderLogicalKey('nf-receive', input.purchaseOrderId, invoice.id),
    });
    receivedItemCount = result.received_items?.length ?? receipts.length;
    complete = result.complete;
    const receivedProductIds = new Set(
      (result.received_items || [])
        .map((row) => row.product_id as string | undefined)
        .filter((id): id is string => !!id),
    );

    // Itens resolvidos que não estavam na OC: entrada avulsa explícita.
    for (const idx of input.includedIndexes) {
      const productId = indexToProduct.get(idx);
      if (!productId || receivedProductIds.has(productId)) continue;
      const it = input.parsed.items[idx];
      const { data: product, error } = await supabase
        .from('products')
        .select('id, quantity')
        .eq('id', productId)
        .single();
      if (error || !product) throw new Error(`Produto ${it.productName} não encontrado após o cadastro.`);
      const oldQty = Number(product.quantity) || 0;
      const stockResult = await adjustStockSafe({
        productId,
        expectedPrevious: oldQty,
        newQty: oldQty + Number(it.quantity),
        reason: `Entrada via NF ${input.parsed.invoiceNumber} — item sem linha na OC (${it.productName})`,
      });
      if (!stockResult.success) throw new Error(stockResult.errorMessage || 'Falha na entrada avulsa');
      stockOnlyCount += 1;
    }

    await supabase
      .from('invoice_items')
      .update({ added_to_stock: true })
      .eq('invoice_id', invoice.id)
      .not('product_id', 'is', null);
  } else if (input.creditWithoutPo) {
    for (const idx of input.includedIndexes) {
      const productId = indexToProduct.get(idx);
      if (!productId) continue;
      const it = input.parsed.items[idx];
      const { data: product, error } = await supabase
        .from('products')
        .select('id, quantity')
        .eq('id', productId)
        .single();
      if (error || !product) throw new Error(`Produto ${it.productName} não encontrado.`);
      const oldQty = Number(product.quantity) || 0;
      const stockResult = await adjustStockSafe({
        productId,
        expectedPrevious: oldQty,
        newQty: oldQty + Number(it.quantity),
        reason: `Entrada via NF ${input.parsed.invoiceNumber} — sem OC (${it.productName})`,
      });
      if (!stockResult.success) throw new Error(stockResult.errorMessage || 'Falha na entrada sem OC');
      stockOnlyCount += 1;
    }
    await supabase
      .from('invoice_items')
      .update({ added_to_stock: true })
      .eq('invoice_id', invoice.id)
      .not('product_id', 'is', null);
  }

  return {
    invoiceId: invoice.id,
    supplierId,
    purchaseOrderId: input.purchaseOrderId,
    createdProductIds,
    receivedItemCount,
    stockOnlyCount,
    complete,
  };
}
