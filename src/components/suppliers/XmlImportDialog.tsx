import { useCallback, useState } from 'react';
import { FileArrowUp as FileUp, FileText, WarningCircle as AlertCircle, Check } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseNFeXML, type ParsedNFe } from '@/lib/nfeParser';
import { convertNfToStockUnit, toNfConversionProduct, NF_CONVERSION_PRODUCT_SELECT } from '@/lib/nfUnitConversion';
import { weightedAverageUnitPrice } from '@/lib/purchaseConversion';
import { useAddInvoice, useAddInvoiceItems } from '@/hooks/useSuppliers';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { findGroupForProduct } from '@/hooks/useProducts';
import type { Supplier } from '@/hooks/useSuppliers';
import type { ParsedNFeDuplicata } from '@/lib/nfeParser';
import { inboundEntrySince, openInboundAllocationReview } from '@/lib/inboundAllocationReviewStore';
import {
  buildReceiveReceipts,
  pickDefaultPurchaseOrder,
  type OpenPoWithSourcePvs,
} from '@/lib/nfPoReceipt';
import { executePurchaseOrderCommand } from '@/services/purchaseOrderCommandService';
import { invalidateProductSupply } from '@/hooks/useProductSupplySummary';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: Supplier[];
  onSupplierAutoCreate?: (data: Partial<Supplier> & { name: string }) => Promise<{ id: string } | undefined>;
  onPayablesCreate?: (supplierId: string | null, invoiceId: string, duplicatas: ParsedNFeDuplicata[], supplierName: string, invoiceNumber: string, paymentMethod: string) => void;
  onImportComplete?: (invoiceId: string) => void;
  /** PVs do contexto (Relatório de Pendência) — preferidos ao escolher a OC. */
  preferredSourcePvIds?: string[];
};

type PoOverlapState = {
  orders: Array<OpenPoWithSourcePvs & { order_number: string; updated_at?: string | null }>;
  matchedProductIds: string[];
  selectedPoId: string;
};

// ── Matching NF-item → produto (níveis 1–5) ─────────────────────────────────
// Extraído do loop de importação pra ser reusado pelo guard NF↔OC (F5-06) sem
// duplicar a pipeline de fuzzy matching.

/** Normalize for comparison */
const norm = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Remove common NF-e noise prefixes like "ONU 1133 ADESIVO CONTENDO..." */
const stripNoise = (s: string) => {
  let n = norm(s);
  n = n.replace(/^ONU\s+[\d]+[\s,]*/, '');
  n = n.replace(/\b(CONTENDO|LIQUIDO|INFLAMAVEL|CLASSE|SUBCLASSE|RISCO|SUBSIDIARIO)\b/g, '').replace(/\b\d+\s+\d+\s+(I{1,3}|IV|V)\b/g, '');
  n = n.replace(/\b(SACO|BALDE|LATA|FRASCO|GALAO|BISNAGA|TUBO|AMOSTRA)\b/g, '');
  n = n.replace(/\b\d+\s*(KG|GR|G|ML|L|LT|UN|PC|MT|M)\b/gi, '');
  return n.replace(/\s+/g, ' ').trim();
};

type MatchableProduct = {
  id: string;
  name: string;
  sku: string | null;
  color?: string | null;
  [k: string]: any;
};

/**
 * Desambigua por COR quando vários produtos casam o mesmo nome-base (ex.:
 * "NAPA TITANIUM" existe em OFF WHITE, ROSADO, PRETO — diferindo SÓ na coluna
 * `color`). O fuzzy por nome ignora cor, e o products.find() pegava o PRIMEIRO
 * → creditava a cor errada (bug NF 21686: AMENDOA caiu na OFF WHITE).
 * Regra: 1 candidato → usa; vários → exige a COR do produto presente no nome
 * da NF; se nenhum/ambíguo → SEM match (cai pra vínculo manual no "Lançar no
 * Estoque" — NUNCA chuta a cor).
 */
function disambiguateByColor<T extends MatchableProduct>(candidates: T[], nfName: string): T | undefined {
  if (candidates.length <= 1) return candidates[0] ?? undefined;
  const nfNorm = norm(nfName);
  const byColor = candidates.filter(p => p.color && nfNorm.includes(norm(p.color)));
  return byColor.length === 1 ? byColor[0] : undefined;
}

/** Pipeline de matching NF→produto (SKU exato → nome exato → "NOME: COR" →
 *  stripped noise → contains), sempre desambiguado por cor. */
function matchNfItemToProduct<T extends MatchableProduct>(
  products: T[],
  productName: string,
  productCode: string | null | undefined,
): T | undefined {
  // 1) Exact SKU match (case-insensitive)
  let match = products.find(p =>
    p.sku && productCode &&
    p.sku.trim().toLowerCase() === productCode.trim().toLowerCase()
  );

  // 2) Exact normalized name match (desambiguado por cor)
  if (!match) {
    const normName = norm(productName);
    match = disambiguateByColor(products.filter(p => norm(p.name) === normName), productName);
  }

  // 3) Match with "NAME: COLOR" pattern
  if (!match) {
    const normName = norm(productName);
    match = products.find(p => {
      const pName = norm(p.name);
      const colonIdx = pName.indexOf(':');
      if (colonIdx > 0) {
        const baseName = pName.slice(0, colonIdx).trim();
        const colorName = pName.slice(colonIdx + 1).trim();
        return normName === `${baseName} ${colorName}`;
      }
      return false;
    });
  }

  // 4) Stripped noise matching — product name is short, NF name is long/verbose.
  //    Desambiguado por COR: vários produtos do mesmo nome-base (napa em N
  //    cores) não podem cair no primeiro — exige a cor do produto no nome da NF.
  if (!match) {
    const stripped = stripNoise(productName);
    if (stripped.length >= 3) {
      const cands = products.filter(p => {
        const pStripped = stripNoise(p.name);
        return pStripped.length >= 3 && (
          stripped.includes(pStripped) || pStripped.includes(stripped)
        );
      });
      match = disambiguateByColor(cands, productName);
    }
  }

  // 5) Contains-based matching — NF name contains product name or vice-versa
  //    (também desambiguado por cor).
  if (!match) {
    const normName = norm(productName);
    const cands = products.filter(p => {
      const pName = norm(p.name);
      return pName.length >= 4 && normName.length >= 4 && (
        normName.includes(pName) || pName.includes(normName)
      );
    });
    match = disambiguateByColor(cands, productName);
  }

  return match;
}

export default function XmlImportDialog({
  open,
  onOpenChange,
  suppliers,
  onSupplierAutoCreate,
  onPayablesCreate,
  onImportComplete,
  preferredSourcePvIds,
}: Props) {
  const [parsed, setParsed] = useState<ParsedNFe | null>(null);
  const [xmlRaw, setXmlRaw] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [matchedSupplierId, setMatchedSupplierId] = useState<string | null>(null);
  const [excludedItems, setExcludedItems] = useState<Set<number>>(new Set());
  const [duplicateWarning, setDuplicateWarning] = useState<{ invoiceNumber: string; series: string; issueDate: string | null } | null>(null);
  // NF↔OC: crédito único via receive da OC (não mais "importar mesmo assim").
  const [poOverlapWarning, setPoOverlapWarning] = useState<PoOverlapState | null>(null);
  const addInvoice = useAddInvoice();
  const addItems = useAddInvoiceItems();
  const queryClient = useQueryClient();

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const loadProductsForMatching = useCallback(async () => {
    const pageSize = 1000;
    const allProducts: Array<{
      id: string;
      name: string;
      sku: string | null;
      quantity: number | null;
      unit_price: number | null;
      unit?: string | null;
      color?: string | null;
      group_id?: string | null;
      supplier_id?: string | null;
      package_weight_kg?: number | null;
      conversion_rate?: number | null;
      purchase_unit?: string | null;
      purchase_order_unit?: string | null;
    }> = [];

    for (let from = 0; ; from += pageSize) {
      // F5-03: campos de conversão vêm do fragmento compartilhado — TODOS os
      // caminhos de NF (auto, manual, lote) leem o MESMO conjunto de colunas.
      // Antes este select não trazia purchase_unit → a Prioridade 2 do
      // conversor (NF unit == purchase_unit → conversion_rate) nunca disparava.
      const { data, error } = await supabase
        .from('products')
        .select(`id, name, sku, quantity, unit_price, color, group_id, supplier_id, ${NF_CONVERSION_PRODUCT_SELECT}`)
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      // Flatten group.package_weight_kg into the product object for easy access.
      for (const row of data as any[]) {
        allProducts.push({
          ...row,
          package_weight_kg: row.product_groups?.package_weight_kg ?? null,
        });
      }

      if (data.length < pageSize) break;
    }

    return allProducts;
  }, []);

  const processFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      toast.error('Arquivo inválido. Selecione um arquivo .xml da NF-e.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      toast.error('Falha ao ler o arquivo. Tente novamente.');
    };
    reader.onload = (e) => {
      const xml = e.target?.result as string;
      if (!xml || typeof xml !== 'string') {
        toast.error('Arquivo XML vazio ou ilegível.');
        return;
      }
      setXmlRaw(xml);
      try {
        const data = parseNFeXML(xml);
        if (!data || !data.invoiceNumber) {
          toast.error('XML não reconhecido como NF-e válida (sem número da nota).');
          setParsed(null);
          return;
        }
        if (!data.items || data.items.length === 0) {
          toast.warning('NF-e carregada, mas sem itens detectados no XML.');
        }
        setParsed(data);
        setExcludedItems(new Set());
        // Try to match supplier by CNPJ
        const match = suppliers.find(s => s.cnpj && data.supplier.cnpj &&
          s.cnpj.replace(/\D/g, '') === data.supplier.cnpj.replace(/\D/g, ''));
        setMatchedSupplierId(match?.id || null);
      } catch (err: any) {
        console.error('[NFe Import] Erro ao parsear XML:', err);
        toast.error(`XML inválido: ${err?.message || 'estrutura não reconhecida'}`);
        setParsed(null);
      }
    };
    reader.readAsText(file);
  }, [suppliers]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const checkDuplicateAndImport = async () => {
    if (!parsed) return;

    // Check if NF already exists
    const { data: existing } = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_series, issue_date')
      .eq('invoice_number', parsed.invoiceNumber)
      .eq('invoice_series', parsed.series || '');

    if (existing && existing.length > 0) {
      setDuplicateWarning({
        invoiceNumber: parsed.invoiceNumber,
        series: parsed.series,
        issueDate: existing[0].issue_date,
      });
      return;
    }

    await checkOpenPoAndImport();
  };

  /**
   * Antes de creditar: se há OC aberta do mesmo fornecedor com os mesmos itens,
   * abre o seletor — crédito entra pela OC (`receive`), nunca pelos dois caminhos.
   */
  const checkOpenPoAndImport = async () => {
    if (!parsed) return;
    try {
      if (matchedSupplierId) {
        const products = await loadProductsForMatching();
        const included = parsed.items.filter((_, i) => !excludedItems.has(i));
        const matchedIds = new Set(
          included
            .map((it) => matchNfItemToProduct(products, it.productName, it.productCode)?.id)
            .filter(Boolean) as string[],
        );
        if (matchedIds.size > 0) {
          const { data: openPos } = await supabase
            .from('purchase_orders')
            .select('id, order_number, status, promised_date, supplier_id, source_pv_ids, updated_at, purchase_order_items(id, product_id, quantity, received_quantity, received_at)')
            .eq('supplier_id', matchedSupplierId)
            .in('status', ['pending', 'approved', 'sent', 'parcial']);
          const candidates: PoOverlapState['orders'] = (openPos || []).map((po: any) => ({
            id: po.id as string,
            order_number: po.order_number as string,
            status: po.status as string,
            promised_date: po.promised_date ?? null,
            supplier_id: po.supplier_id ?? null,
            source_pv_ids: po.source_pv_ids ?? null,
            updated_at: po.updated_at ?? null,
            items: (po.purchase_order_items || []).map((i: any) => ({
              id: i.id as string,
              product_id: i.product_id as string | null,
              quantity: Number(i.quantity) || 0,
              received_quantity: i.received_quantity ?? null,
              received_at: i.received_at ?? null,
            })),
          }));
          const todayIso = new Date().toISOString().slice(0, 10);
          const picked = pickDefaultPurchaseOrder(
            candidates,
            matchedIds,
            todayIso,
            preferredSourcePvIds,
          );
          const overlapping = candidates.filter((po) =>
            po.items.some((i) =>
              !!i.product_id
              && !i.received_at
              && matchedIds.has(i.product_id)
              && Number(i.quantity) - Number(i.received_quantity ?? 0) > 0.0001,
            ),
          );
          if (overlapping.length > 0 && picked) {
            setPoOverlapWarning({
              orders: overlapping,
              matchedProductIds: [...matchedIds],
              selectedPoId: picked.id,
            });
            return;
          }
        }
      }
    } catch (err) {
      console.error('[NFe Import] Falha na checagem NF↔OC (seguindo com a importação):', err);
    }
    await doImport({ creditStock: true, purchaseOrderId: null });
  };

  const doImport = async (opts?: {
    creditStock?: boolean;
    purchaseOrderId?: string | null;
    receiveReceipts?: Array<{ item_id: string; quantity: number; expected_received_quantity: number }>;
    receiveProductIds?: string[];
    expectedUpdatedAt?: string | null;
  }) => {
    if (!parsed) return;
    const creditStock = opts?.creditStock !== false;
    const purchaseOrderId = opts?.purchaseOrderId ?? null;
    setDuplicateWarning(null);
    setImporting(true);

    let invoice: { id: string } | null = null;
    try {
      let supplierId = matchedSupplierId;

      // Auto-create supplier if not matched
      if (!supplierId && onSupplierAutoCreate) {
        try {
          const newSupplier = await onSupplierAutoCreate({
            name: parsed.supplier.name,
            trade_name: parsed.supplier.tradeName,
            cnpj: parsed.supplier.cnpj,
            ie: parsed.supplier.ie,
            address: parsed.supplier.address,
            city: parsed.supplier.city,
            state: parsed.supplier.state,
            phone: parsed.supplier.phone,
          });
          supplierId = newSupplier?.id || null;
        } catch (err: any) {
          console.error('[NFe Import] Erro ao criar fornecedor:', err);
          toast.error(`Erro ao criar fornecedor: ${err?.message || 'desconhecido'}`);
        }
      }

      // Create invoice (amarrada à OC quando o crédito passa pelo receive)
      try {
        invoice = await addInvoice.mutateAsync({
          supplier_id: supplierId,
          invoice_number: parsed.invoiceNumber,
          invoice_series: parsed.series,
          invoice_key: parsed.key,
          issue_date: parsed.issueDate || null,
          total_value: parsed.totalValue,
          freight_value: parsed.freightValue,
          discount_value: parsed.discountValue,
          xml_data: xmlRaw,
          status: 'imported',
          ...(purchaseOrderId ? { purchase_order_id: purchaseOrderId } : {}),
        });
      } catch (err: any) {
        console.error('[NFe Import] Erro ao gravar invoice:', err);
        toast.error(`Falha ao salvar a NF no banco: ${err?.message || 'erro desconhecido'}`);
        setImporting(false);
        return;
      }

      if (!invoice?.id) {
        toast.error('NF não foi salva (resposta vazia do servidor). Verifique permissões.');
        setImporting(false);
        return;
      }

      // Create items (only non-excluded)
      const includedItems = parsed.items.filter((_, i) => !excludedItems.has(i));
      let createdInvoiceItems: { id: string; product_code: string; product_name: string; quantity: number; unit_price: number; unit: string; added_to_stock?: boolean }[] = [];
      if (includedItems.length > 0) {
        try {
          const result = await addItems.mutateAsync(
            includedItems.map(item => ({
              invoice_id: invoice!.id,
              product_code: item.productCode,
              product_name: item.productName,
              ncm: item.ncm,
              cfop: item.cfop,
              unit: item.unit,
              quantity: item.quantity,
              unit_price: item.unitPrice,
              total_price: item.totalPrice,
              discount: item.discount,
            }))
          );
          createdInvoiceItems = (result || []) as any[];
          if (createdInvoiceItems.length === 0) {
            console.warn('[NFe Import] addItems retornou vazio — refazendo SELECT');
            const { data: refetched } = await supabase
              .from('invoice_items')
              .select('id, product_code, product_name, quantity, unit_price, unit, added_to_stock')
              .eq('invoice_id', invoice.id);
            createdInvoiceItems = (refetched || []) as any[];
          }
        } catch (err: any) {
          console.error('[NFe Import] Erro ao gravar itens:', err);
          toast.error(`NF salva, mas falha ao gravar itens: ${err?.message || 'erro desconhecido'}`);
          setImporting(false);
          return;
        }
      }

      // ── ESTOQUE ──
      // Com OC selecionada: crédito ÚNICO via comando receive (não adjustStockSafe).
      // Sem OC + creditStock: caminho legado (NF sem OC aberta).
      // creditStock=false: só cadastra a NF (sem mexer no estoque).
      const pendingItems = createdInvoiceItems.filter(i => !i.added_to_stock);
      const products = await loadProductsForMatching();
      const inboundSince = inboundEntrySince();
      const launchedProductIds: string[] = [];
      let stockLaunched = 0;
      const failedItems: string[] = [];
      const conversionWarnings: string[] = [];

      if (purchaseOrderId && opts?.receiveReceipts && opts.receiveReceipts.length > 0) {
        try {
          await executePurchaseOrderCommand({
            command: 'receive',
            purchaseOrderId,
            expectedUpdatedAt: opts.expectedUpdatedAt ?? null,
            payload: {
              receipts: opts.receiveReceipts,
              received_date: new Date().toISOString().slice(0, 10),
              invoice_id: invoice.id,
            },
            logicalKey: `nf-receive:${invoice.id}:${purchaseOrderId}`,
          });
          const matchedSet = new Set(opts.receiveProductIds || []);
          for (const invItem of pendingItems) {
            const match = matchNfItemToProduct(products, invItem.product_name, invItem.product_code);
            if (match && matchedSet.has(match.id)) {
              await supabase
                .from('invoice_items')
                .update({ added_to_stock: true, product_id: match.id })
                .eq('id', invItem.id);
              stockLaunched++;
              launchedProductIds.push(match.id);
            }
          }
          invalidateProductSupply(queryClient);
          queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
        } catch (err: any) {
          console.error('[NFe Import] Falha no receive da OC:', err);
          toast.error(`NF salva, mas o recebimento da OC falhou: ${err?.message || 'erro'}`);
          setImporting(false);
          return;
        }
      } else if (creditStock) {
        for (const invItem of pendingItems) {
          try {
            const match = matchNfItemToProduct(products, invItem.product_name, invItem.product_code);

            if (match) {
              const conv = convertNfToStockUnit(
                invItem.quantity,
                invItem.unit,
                invItem.unit_price,
                toNfConversionProduct(match),
              );

              if (conv.needsConfig) {
                conversionWarnings.push(`${invItem.product_name}: ${conv.reason}`);
                failedItems.push(invItem.product_name);
                continue;
              }

              const addQty = conv.qty;
              const addPrice = conv.unitPrice;
              const oldQty = match.quantity ?? 0;
              const oldPrice = match.unit_price ?? 0;
              const newQty = oldQty + addQty;
              const newPrice = weightedAverageUnitPrice(oldQty, oldPrice, addQty, addPrice);
              const conversionNote = conv.converted
                ? ` (convertido ${invItem.quantity} ${invItem.unit} → ${addQty.toFixed(2)} ${match.unit})`
                : '';
              const adjustResult = await adjustStockSafe({
                productId: match.id,
                expectedPrevious: oldQty,
                newQty,
                reason: `Entrada via NF ${parsed.invoiceNumber} - ${invItem.product_name}${conversionNote}`,
              });
              if (!adjustResult.success) throw new Error(adjustResult.errorMessage);

              const { error: updateInvoiceItemError } = await supabase
                .from('invoice_items')
                .update({ added_to_stock: true, product_id: match.id })
                .eq('id', invItem.id);

              if (updateInvoiceItemError) throw updateInvoiceItemError;

              const updatePayload: Record<string, any> = { unit_price: newPrice };
              if (supplierId) updatePayload.supplier_id = supplierId;
              const { error: updateProductError } = await supabase
                .from('products')
                .update(updatePayload)
                .eq('id', match.id);
              if (updateProductError) {
                console.error(`[NFe Import] Falha ao atualizar preço/fornecedor de "${match.name}":`, updateProductError);
              }

              match.quantity = newQty;
              match.unit_price = newPrice;
              if (supplierId) match.supplier_id = supplierId;
              stockLaunched++;
              launchedProductIds.push(match.id);
            } else {
              failedItems.push(invItem.product_name);
            }
          } catch (err: any) {
            console.error(`Erro ao lançar item "${invItem.product_name}" no estoque:`, err);
            failedItems.push(invItem.product_name);
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['invoice_items'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });

      const totalItems = createdInvoiceItems.length;
      if (totalItems === 0) {
        toast.warning('NF salva, porém sem itens. Verifique o XML ou as permissões da tabela invoice_items.', { duration: 8000 });
      } else if (purchaseOrderId && stockLaunched > 0) {
        toast.success(`NF importada e OC recebida — ${stockLaunched} item(ns) no estoque (crédito único).`);
      } else if (!creditStock) {
        toast.success(`NF cadastrada com ${totalItems} item(ns), sem lançar estoque.`);
      } else if (stockLaunched > 0) {
        toast.success(`NF importada! ${stockLaunched}/${totalItems} item(ns) lançados no estoque automaticamente.`);
      } else {
        toast.info(
          `NF importada com ${totalItems} item(ns), mas nenhum bateu com produtos cadastrados. Use "Lançar no Estoque" para vincular manualmente.`,
          { duration: 10000 },
        );
      }

      if (failedItems.length > 0 && stockLaunched > 0) {
        // Mostra os primeiros 5 nomes — ajuda operador a entender o que ficou
        // pendente sem precisar abrir a aba "Lançar no Estoque" às cegas.
        const sample = failedItems.slice(0, 5).join(', ');
        const more = failedItems.length > 5 ? ` (e mais ${failedItems.length - 5})` : '';
        toast.info(
          `${failedItems.length} ${failedItems.length === 1 ? 'item sem correspondência' : 'itens sem correspondência'}: ${sample}${more}. Clique em "Lançar no Estoque" pra cadastrar/vincular.`,
          { duration: 10000 }
        );
      }

      // Surface conversion problems explicitly so the user can configure the package weight.
      // Lista NOME COMPLETO do item + motivo da falha, separado por nova linha pra
      // ficar legível no toast (Sonner respeita \n).
      if (conversionWarnings.length > 0) {
        const sample = conversionWarnings.slice(0, 5).join('\n• ');
        const more = conversionWarnings.length > 5 ? `\n• …e mais ${conversionWarnings.length - 5} item(ns).` : '';
        toast.warning(
          `${conversionWarnings.length} ${conversionWarnings.length === 1 ? 'item NÃO entrou' : 'itens NÃO entraram'} no estoque por divergência de unidade:\n• ${sample}${more}`,
          { duration: 20000 }
        );
      }

      // Auto-create payables from duplicatas
      if (onPayablesCreate && parsed.duplicatas.length > 0) {
        onPayablesCreate(supplierId, invoice.id, parsed.duplicatas, parsed.supplier.name, parsed.invoiceNumber, parsed.paymentMethod);
      }

      // Notify parent
      if (onImportComplete) {
        onImportComplete(invoice.id);
      }

      setParsed(null);
      setXmlRaw('');
      onOpenChange(false);
      if (launchedProductIds.length > 0) {
        void openInboundAllocationReview({ productIds: launchedProductIds, since: inboundSince });
      }
    } catch (err: any) {
      console.error('[NFe Import] Erro inesperado:', err);
      toast.error(`Erro inesperado ao importar NF: ${err?.message || 'desconhecido'}`);
    } finally {
      setImporting(false);
    }
  };

  const reset = () => { setParsed(null); setXmlRaw(''); setMatchedSupplierId(null); setExcludedItems(new Set()); setDuplicateWarning(null); setPoOverlapWarning(null); };

  const toggleItem = (idx: number) => {
    setExcludedItems(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (!parsed) return;
    if (excludedItems.size === 0) {
      setExcludedItems(new Set(parsed.items.map((_, i) => i)));
    } else {
      setExcludedItems(new Set());
    }
  };

  const includedCount = parsed ? parsed.items.length - excludedItems.size : 0;

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!parsed) { const file = e.dataTransfer.files[0]; if (file) processFile(file); } }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5 text-primary" />
            Importar NF-e (XML)
          </DialogTitle>
        </DialogHeader>

        {!parsed ? (
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('xml-file-input')?.click()}
          >
            <FileUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium mb-1">Arraste o arquivo XML da NF-e aqui</p>
            <p className="text-sm text-muted-foreground">ou clique para selecionar</p>
            <input id="xml-file-input" type="file" accept=".xml" className="hidden" onChange={handleFileInput} />
          </div>
        ) : (
          <div className="space-y-4">
            {/* NF Info */}
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">NF Nº</span>
                  <p className="font-semibold">{parsed.invoiceNumber}-{parsed.series}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Data Emissão</span>
                  <p className="font-semibold">{parsed.issueDate ? new Date(parsed.issueDate + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Valor Total</span>
                  <p className="font-semibold text-primary">{fmt(parsed.totalValue)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Itens</span>
                  <p className="font-semibold">{parsed.items.length}</p>
                </div>
              </div>
            </div>

            {/* Supplier match */}
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{parsed.supplier.name}</p>
                  <p className="text-xs text-muted-foreground">CNPJ: {parsed.supplier.cnpj || 'Não informado'}</p>
                </div>
                {matchedSupplierId ? (
                  <Badge className="bg-success/15 text-success border-success/30 gap-1">
                    <Check className="h-3 w-3" /> Fornecedor encontrado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30 gap-1">
                    <AlertCircle className="h-3 w-3" /> Será cadastrado automaticamente
                  </Badge>
                )}
              </div>
            </div>

            {/* Items table */}
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="w-8">
                      <Checkbox
                        checked={excludedItems.size === 0}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead className="text-xs">Código</TableHead>
                    <TableHead className="text-xs">Produto</TableHead>
                    <TableHead className="text-xs">NCM</TableHead>
                    <TableHead className="text-xs">Un</TableHead>
                    <TableHead className="text-xs text-right">Qtd</TableHead>
                    <TableHead className="text-xs text-right">Vl. Unit.</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.items.map((item, i) => {
                    const excluded = excludedItems.has(i);
                    return (
                      <TableRow key={i} className={excluded ? 'opacity-40' : ''}>
                        <TableCell>
                          <Checkbox
                            checked={!excluded}
                            onCheckedChange={() => toggleItem(i)}
                          />
                        </TableCell>
                        <TableCell className="text-xs font-mono">{item.productCode}</TableCell>
                        <TableCell className="text-xs font-medium">{item.productName}</TableCell>
                        <TableCell className="text-xs">{item.ncm}</TableCell>
                        <TableCell className="text-xs">{item.unit}</TableCell>
                        <TableCell className="text-xs text-right">{item.quantity}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{fmt(item.unitPrice)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{fmt(item.totalPrice)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {excludedItems.size > 0 && (
              <p className="text-xs text-warning">{excludedItems.size} item(ns) desmarcado(s) — não serão importados.</p>
            )}

            {parsed.key && (
              <div className="text-xs text-muted-foreground">
                <FileText className="h-3 w-3 inline mr-1" />
                Chave: {parsed.key}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={reset}>Trocar Arquivo</Button>
              <Button onClick={checkDuplicateAndImport} disabled={importing || includedCount === 0}>
                {importing ? 'Importando...' : `Importar NF com ${includedCount} itens`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

      <AlertDialog open={!!duplicateWarning} onOpenChange={(v) => { if (!v) setDuplicateWarning(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-warning">
              <AlertCircle className="h-5 w-5" />
              NF-e já importada
            </AlertDialogTitle>
            <AlertDialogDescription>
              A nota fiscal <strong>Nº {duplicateWarning?.invoiceNumber}-{duplicateWarning?.series}</strong>
              {duplicateWarning?.issueDate && (
                <> de {new Date(duplicateWarning.issueDate + 'T00:00:00').toLocaleDateString('pt-BR')}</>
              )} já foi importada anteriormente. Deseja importar novamente?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setDuplicateWarning(null); void checkOpenPoAndImport(); }} className="bg-warning text-warning-foreground hover:bg-warning/90">
              Importar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* NF↔OC: crédito único via receive da OC (sem "importar mesmo assim"). */}
      <AlertDialog open={!!poOverlapWarning} onOpenChange={(v) => { if (!v) setPoOverlapWarning(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-warning" />
              Receber pela ordem de compra
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Há OC aberta deste fornecedor com os mesmos itens. O estoque entra{' '}
                  <strong>uma vez</strong>, pelo recebimento da OC — a NF fica vinculada a ela.
                </p>
                {poOverlapWarning && poOverlapWarning.orders.length > 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="nf-po-select">Ordem de compra</Label>
                    <Select
                      value={poOverlapWarning.selectedPoId}
                      onValueChange={(id) => setPoOverlapWarning((prev) => prev ? { ...prev, selectedPoId: id } : prev)}
                    >
                      <SelectTrigger id="nf-po-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {poOverlapWarning.orders.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.order_number} · {o.status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => {
                const state = poOverlapWarning;
                setPoOverlapWarning(null);
                void doImport({ creditStock: false, purchaseOrderId: state?.selectedPoId ?? null });
              }}
            >
              Só cadastrar NF (sem estoque)
            </Button>
            <Button
              type="button"
              disabled={importing || !poOverlapWarning?.selectedPoId}
              onClick={() => {
                const state = poOverlapWarning;
                if (!state) return;
                const po = state.orders.find((o) => o.id === state.selectedPoId);
                if (!po) return;
                const matched = new Set(state.matchedProductIds);
                const receipts = buildReceiveReceipts(po.items, matched);
                if (receipts.length === 0) {
                  toast.error('Nenhum item em aberto nesta OC casa com a NF.');
                  return;
                }
                setPoOverlapWarning(null);
                void doImport({
                  creditStock: true,
                  purchaseOrderId: po.id,
                  receiveReceipts: receipts,
                  receiveProductIds: state.matchedProductIds,
                  expectedUpdatedAt: po.updated_at ?? null,
                });
              }}
            >
              Receber pela OC
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
