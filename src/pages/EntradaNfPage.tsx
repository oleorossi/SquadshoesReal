/**
 * Tela única Entrada por NF: soltar o XML, conferir fornecedor / OC / itens
 * e confirmar a entrada. Sem consulta SEFAZ. Reusa parseNFeXML, nfPoReceipt
 * e execute_purchase_order_command('receive').
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileArrowUp, Warning, Check, ArrowLeft } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { parseNFeXML, type ParsedNFe } from '@/lib/nfeParser';
import {
  DRAFT_RECEIVE_CONFIRMATION,
  isDraftLikePoStatus,
  parseNfProductName,
  pickDefaultPurchaseOrder,
  overlappingOpenPos,
  type OpenPoCandidate,
  type OpenPoItem,
  type OpenPoWithSourcePvs,
  matchNfItemToProduct,
} from '@/lib/nfPoReceipt';
import {
  buildNfPoPreviewLines,
  previewStatusLabel,
  previewLineTone,
  type NfPoPreviewLine,
} from '@/lib/nfEntradaPreview';
import { NF_CONVERSION_PRODUCT_SELECT } from '@/lib/nfUnitConversion';
import { confirmNfEntrada, type UnmatchedResolution } from '@/lib/nfEntradaConfirm';
import { CATEGORIES, UNITS } from '@/types/inventory';
import { cn } from '@/lib/utils';

const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  color?: string | null;
  unit?: string | null;
  group_id?: string | null;
  supplier_id?: string | null;
  purchase_unit?: string | null;
  conversion_rate?: number | null;
};

type PoQueryItem = {
  id: string;
  product_id: string;
  quantity: number | string | null;
  received_quantity: number | string | null;
  received_at: string | null;
  unit: string | null;
  unit_price: number | string | null;
};

type PoQueryRow = {
  id: string;
  order_number: string;
  status: string;
  promised_date: string | null;
  supplier_id: string | null;
  source_pv_ids: string[] | null;
  updated_at: string | null;
  purchase_order_items: PoQueryItem[] | null;
};

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}


async function loadAllProducts(): Promise<ProductRow[]> {
  const pageSize = 1000;
  const all: ProductRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('products')
      .select(`id, name, sku, color, group_id, supplier_id, ${NF_CONVERSION_PRODUCT_SELECT}`)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as ProductRow[]));
    if (data.length < pageSize) break;
  }
  return all;
}

export default function EntradaNfPage() {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<ParsedNFe | null>(null);
  const [xmlRaw, setXmlRaw] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [draftConfirmed, setDraftConfirmed] = useState(false);
  const [createSupplier, setCreateSupplier] = useState(true);
  const [resolutions, setResolutions] = useState<Record<number, UnmatchedResolution>>({});
  const [busy, setBusy] = useState(false);

  const { data: products = [] } = useQuery({ queryKey: ['products-nf-entrada'], queryFn: loadAllProducts });
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-nf-entrada'],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('id, name, cnpj, active').order('name');
      if (error) throw error;
      return data as Array<{ id: string; name: string; cnpj: string | null; active: boolean }>;
    },
  });
  const { data: groups = [] } = useQuery({
    queryKey: ['product-groups-nf-entrada'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_groups').select('id, name').order('name');
      if (error) throw error;
      return data as Array<{ id: string; name: string }>;
    },
  });

  const matchedSupplier = useMemo(() => {
    if (!parsed) return null;
    const cnpj = (parsed.supplier.cnpj || '').replace(/\D/g, '');
    if (!cnpj) return suppliers.find((s) => s.name.trim().toLowerCase() === parsed.supplier.name.trim().toLowerCase()) ?? null;
    return suppliers.find((s) => (s.cnpj || '').replace(/\D/g, '') === cnpj) ?? null;
  }, [parsed, suppliers]);

  const { data: openOrders = [] } = useQuery({
    queryKey: ['open-pos-nf-entrada', matchedSupplier?.id, parsed?.supplier.cnpj],
    enabled: !!parsed,
    queryFn: async () => {
      let q = supabase
        .from('purchase_orders')
        .select('id, order_number, status, promised_date, supplier_id, source_pv_ids, updated_at, purchase_order_items(id, product_id, quantity, received_quantity, received_at, unit, unit_price)')
        .in('status', ['draft', 'suggested', 'pending', 'approved', 'sent', 'parcial']);
      if (matchedSupplier?.id) q = q.eq('supplier_id', matchedSupplier.id);
      const { data, error } = await q.order('promised_date', { ascending: true, nullsFirst: false }).limit(80);
      if (error) throw error;
      return ((data || []) as PoQueryRow[]).map((po) => ({
        id: po.id,
        order_number: po.order_number,
        status: po.status,
        promised_date: po.promised_date,
        supplier_id: po.supplier_id,
        source_pv_ids: po.source_pv_ids,
        updated_at: po.updated_at,
        items: (po.purchase_order_items || []).map((i) => ({
          id: i.id,
          product_id: i.product_id,
          quantity: Number(i.quantity),
          received_quantity: i.received_quantity ?? null,
          received_at: i.received_at ?? null,
          unit: i.unit ?? null,
          unit_price: i.unit_price != null ? Number(i.unit_price) : null,
        })) as OpenPoItem[],
      })) as Array<OpenPoWithSourcePvs & { updated_at: string | null; supplier_id: string | null }>;
    },
  });

  const includedIndexes = useMemo(
    () => (parsed ? parsed.items.map((_, i) => i).filter((i) => !excluded.has(i)) : []),
    [parsed, excluded],
  );

  const matchedProductIds = useMemo(() => {
    if (!parsed) return new Set<string>();
    const ids = new Set<string>();
    for (const idx of includedIndexes) {
      const it = parsed.items[idx];
      const res = resolutions[idx];
      if (res?.kind === 'link') { ids.add(res.productId); continue; }
      if (res?.kind === 'create') continue;
      const match = matchNfItemToProduct(products, it.productName, it.productCode);
      if (match) ids.add(match.id);
    }
    return ids;
  }, [parsed, includedIndexes, products, resolutions]);

  const overlapping = useMemo(
    () => overlappingOpenPos(openOrders as OpenPoCandidate[], matchedProductIds),
    [openOrders, matchedProductIds],
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultPo = useMemo(
    () => pickDefaultPurchaseOrder(overlapping.length ? overlapping : openOrders, matchedProductIds, todayIso),
    [overlapping, openOrders, matchedProductIds, todayIso],
  );

  const effectivePoId = selectedPoId || defaultPo?.id || null;
  const selectedPo = openOrders.find((o) => o.id === effectivePoId) ?? null;

  const previewLines: NfPoPreviewLine[] = useMemo(() => {
    if (!parsed) return [];
    const items = includedIndexes.map((i) => parsed.items[i]);
    const lines = buildNfPoPreviewLines(items, products, selectedPo?.items ?? []);
    return lines.map((line, j) => {
      const idx = includedIndexes[j];
      const res = resolutions[idx];
      if (!res) return line;
      if (res.kind === 'link') {
        const p = products.find((x) => x.id === res.productId);
        return { ...line, productId: res.productId, productLabel: p?.name ?? line.productLabel, status: line.status === 'unmatched' ? 'matched' : line.status };
      }
      if (res.kind === 'create') {
        return { ...line, productLabel: res.name, status: 'matched' as const };
      }
      return line;
    });
  }, [parsed, includedIndexes, products, selectedPo, resolutions]);

  const unresolved = previewLines.filter((l, j) => {
    const idx = includedIndexes[j];
    return l.status === 'unmatched' && !resolutions[idx];
  });

  const processFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      toast.error('Selecione um arquivo .xml da NF-e.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error('Falha ao ler o arquivo.');
    reader.onload = (e) => {
      const xml = e.target?.result as string;
      if (!xml) { toast.error('Arquivo XML vazio.'); return; }
      try {
        const data = parseNFeXML(xml);
        if (!data?.invoiceNumber) {
          toast.error('XML não reconhecido como NF-e válida (sem número da nota).');
          return;
        }
        setXmlRaw(xml);
        setParsed(data);
        setExcluded(new Set());
        setSelectedPoId(null);
        setDraftConfirmed(false);
        setResolutions({});
        setCreateSupplier(true);
      } catch (err: unknown) {
        toast.error(errorMessage(err, 'Não foi possível ler o XML.'));
      }
    };
    reader.readAsText(file);
  }, []);

  const reset = () => {
    setParsed(null);
    setXmlRaw('');
    setExcluded(new Set());
    setSelectedPoId(null);
    setDraftConfirmed(false);
    setResolutions({});
  };

  const confirm = async (creditWithoutPo = false) => {
    if (!parsed) return;
    if (unresolved.length > 0) {
      toast.error('Há itens sem cadastro. Vincule ou crie cada um antes de confirmar.');
      return;
    }
    if (selectedPo && isDraftLikePoStatus(selectedPo.status) && !draftConfirmed) {
      toast.error('Confirme o recebimento desta OC em rascunho ou sugerida.');
      return;
    }
    if (!matchedSupplier && !createSupplier) {
      toast.error('Marque que deseja cadastrar o fornecedor, ou o cadastro precisa existir.');
      return;
    }
    setBusy(true);
    try {
      // Auto-match resolutions for already-known products so receive receipts include them.
      const allResolutions: Record<number, UnmatchedResolution> = { ...resolutions };
      for (const idx of includedIndexes) {
        if (allResolutions[idx]) continue;
        const it = parsed.items[idx];
        const match = matchNfItemToProduct(products, it.productName, it.productCode);
        if (match) allResolutions[idx] = { kind: 'link', productId: match.id };
      }
      const result = await confirmNfEntrada({
        parsed,
        xmlRaw,
        includedIndexes,
        supplierId: matchedSupplier?.id ?? null,
        createSupplier,
        purchaseOrderId: creditWithoutPo ? null : selectedPo?.id ?? null,
        purchaseOrderStatus: selectedPo?.status ?? null,
        expectedUpdatedAt: selectedPo?.updated_at ?? null,
        poItems: selectedPo?.items ?? [],
        draftConfirmed,
        resolutions: allResolutions,
        creditWithoutPo,
      });
      const parts = [];
      if (result.receivedItemCount) parts.push(`${result.receivedItemCount} item(ns) pela OC`);
      if (result.stockOnlyCount) parts.push(`${result.stockOnlyCount} avulso(s)`);
      if (result.createdProductIds.length) parts.push(`${result.createdProductIds.length} produto(s) novo(s)`);
      toast.success(parts.length ? `Entrada feita: ${parts.join(', ')}.` : 'NF cadastrada, sem lançar estoque.');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['purchase_orders'] }),
        qc.invalidateQueries({ queryKey: ['invoices'] }),
        qc.invalidateQueries({ queryKey: ['products-nf-entrada'] }),
        qc.invalidateQueries({ queryKey: ['open-pos-nf-entrada'] }),
        qc.invalidateQueries({ queryKey: ['suppliers-nf-entrada'] }),
      ]);
      reset();
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Falha ao confirmar a entrada.'));
    } finally {
      setBusy(false);
    }
  };

  const fmt = money;

  return (
    <div className="space-y-4 pb-24 px-3 sm:px-0">
      <EditorialPageHeader
        sectionLabel="Compras"
        title="Entrada por NF"
        description="Solte o XML da nota, confira o fornecedor, a OC e os itens, e confirme a entrada no estoque. Sem consulta à SEFAZ."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/purchase-orders"><ArrowLeft className="h-4 w-4 mr-1" /> Pedidos de compra</Link>
          </Button>
        }
      />

      {!parsed ? (
        <Panel className="p-0">
          <div
            className={cn(
              'rounded-lg border-2 border-dashed p-10 sm:p-14 text-center cursor-pointer transition-colors',
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) processFile(file);
            }}
            onClick={() => document.getElementById('entrada-nf-xml')?.click()}
          >
            <FileArrowUp className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-lg font-medium">Arraste o XML da NF-e aqui</p>
            <p className="text-sm text-muted-foreground mt-1">ou toque para selecionar no iPhone</p>
            <input
              id="entrada-nf-xml"
              type="file"
              accept=".xml,text/xml,application/xml"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }}
            />
          </div>
        </Panel>
      ) : (
        <>
          <Panel className="p-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">NF</p>
                <p className="font-semibold">{parsed.invoiceNumber}-{parsed.series}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Emissão</p>
                <p className="font-semibold">{parsed.issueDate ? new Date(parsed.issueDate + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="font-semibold text-primary">{fmt(parsed.totalValue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Itens</p>
                <p className="font-semibold">{includedIndexes.length}/{parsed.items.length}</p>
              </div>
            </div>
            {parsed.key && <p className="text-[11px] text-muted-foreground break-all">Chave: {parsed.key}</p>}
          </Panel>

          <Panel className="p-4 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <p className="font-medium">{parsed.supplier.name}</p>
                <p className="text-xs text-muted-foreground">CNPJ: {parsed.supplier.cnpj || 'Não informado'}</p>
              </div>
              {matchedSupplier ? (
                <Badge className="bg-success/15 text-success border-success/30 gap-1 w-fit">
                  <Check className="h-3 w-3" /> Fornecedor encontrado
                </Badge>
              ) : (
                <label className="flex items-start gap-2 text-sm max-w-md">
                  <Checkbox checked={createSupplier} onCheckedChange={(v) => setCreateSupplier(v === true)} className="mt-0.5" />
                  <span>Cadastrar este fornecedor agora (nada é criado antes de você confirmar a entrada).</span>
                </label>
              )}
            </div>
          </Panel>

          <Panel className="p-4 space-y-3">
            <p className="font-medium">Ordem de compra</p>
            {openOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma OC aberta deste fornecedor. Você pode só cadastrar a NF ou dar entrada avulsa, depois de resolver os itens.
              </p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="nf-po">OC sugerida</Label>
                <Select value={effectivePoId ?? '_none'} onValueChange={(v) => { setSelectedPoId(v === '_none' ? null : v); setDraftConfirmed(false); }}>
                  <SelectTrigger id="nf-po"><SelectValue placeholder="Selecione a OC" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Nenhuma — não receber pela OC</SelectItem>
                    {(overlapping.length ? overlapping : openOrders).map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.order_number} · {o.status}{o.promised_date ? ` · ${new Date(o.promised_date + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPo && isDraftLikePoStatus(selectedPo.status) && (
                  <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <Checkbox checked={draftConfirmed} onCheckedChange={(v) => setDraftConfirmed(v === true)} className="mt-0.5" />
                    <span>
                      <Warning className="h-4 w-4 inline mr-1 text-amber-600" />
                      {DRAFT_RECEIVE_CONFIRMATION}
                    </span>
                  </label>
                )}
              </div>
            )}
          </Panel>

          <Panel className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-8" />
                    <TableHead className="text-xs">Item da NF</TableHead>
                    <TableHead className="text-xs text-right">Qtd NF</TableHead>
                    <TableHead className="text-xs text-right">Qtd OC</TableHead>
                    <TableHead className="text-xs">Un / conv.</TableHead>
                    <TableHead className="text-xs text-right">Preço NF</TableHead>
                    <TableHead className="text-xs text-right">Preço OC</TableHead>
                    <TableHead className="text-xs">Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.items.map((item, i) => {
                    const isOut = excluded.has(i);
                    const line = isOut ? null : previewLines[includedIndexes.indexOf(i)];
                    const tone = line ? previewLineTone(line.status) : 'ok';
                    return (
                      <TableRow key={i} className={cn(isOut && 'opacity-40', tone === 'bad' && 'bg-destructive/5', tone === 'warn' && 'bg-amber-500/5')}>
                        <TableCell>
                          <Checkbox checked={!isOut} onCheckedChange={() => setExcluded((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          })} />
                        </TableCell>
                        <TableCell className="text-xs">
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-muted-foreground font-mono">{item.productCode}</p>
                          {line?.productLabel && <p className="text-muted-foreground">→ {line.productLabel}</p>}
                        </TableCell>
                        <TableCell className="text-xs text-right">{item.quantity} {item.unit}</TableCell>
                        <TableCell className="text-xs text-right">{line?.poRemaining ?? '—'}</TableCell>
                        <TableCell className="text-xs">
                          {line?.conversion?.converted
                            ? `${line.stockQty} ${line.stockUnit}`
                            : line?.conversion?.needsConfig
                              ? line.conversion.reason
                              : (line?.stockUnit || item.unit)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">{fmt(item.unitPrice)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{line?.poUnitPrice != null ? fmt(line.poUnitPrice) : '—'}</TableCell>
                        <TableCell className="text-xs">{line ? previewStatusLabel(line.status) : 'Fora'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Panel>

          {unresolved.length > 0 && parsed && (
            <UnmatchedBatch
              lines={previewLines}
              includedIndexes={includedIndexes}
              items={parsed.items}
              products={products}
              groups={groups}
              supplierId={matchedSupplier?.id ?? null}
              resolutions={resolutions}
              onChange={setResolutions}
            />
          )}

          <div className="sticky bottom-0 z-10 -mx-3 sm:mx-0 bg-background/95 backdrop-blur border-t p-3 flex flex-col sm:flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={reset} disabled={busy}>Trocar arquivo</Button>
            {!selectedPo && (
              <Button variant="outline" disabled={busy || includedIndexes.length === 0} onClick={() => void confirm(true)}>
                {busy ? 'Entrando…' : 'Entrar no estoque sem OC'}
              </Button>
            )}
            <Button
              disabled={
                busy
                || includedIndexes.length === 0
                || unresolved.length > 0
                || (!!selectedPo && isDraftLikePoStatus(selectedPo.status) && !draftConfirmed)
                || (!matchedSupplier && !createSupplier)
              }
              onClick={() => void confirm(false)}
            >
              {busy ? 'Confirmando…' : selectedPo ? `Confirmar entrada na ${selectedPo.order_number}` : 'Só cadastrar a NF'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function UnmatchedBatch({
  lines, includedIndexes, items, products, groups, supplierId, resolutions, onChange,
}: {
  lines: NfPoPreviewLine[];
  includedIndexes: number[];
  items: ParsedNFe['items'];
  products: ProductRow[];
  groups: Array<{ id: string; name: string }>;
  supplierId: string | null;
  resolutions: Record<number, UnmatchedResolution>;
  onChange: (next: Record<number, UnmatchedResolution>) => void;
}) {
  const pending = lines
    .map((line, j) => ({ line, idx: includedIndexes[j] }))
    .filter(({ line, idx }) => line.status === 'unmatched' && !resolutions[idx]);

  if (pending.length === 0) return null;

  return (
    <Panel className="p-4 space-y-4">
      <div>
        <p className="font-medium">Itens sem cadastro</p>
        <p className="text-sm text-muted-foreground">
          Nada é criado em silêncio. Vincule a um produto existente ou preencha e escolha criar. O SKU fica gravado para a próxima NF casar sozinha.
        </p>
      </div>
      {pending.map(({ line, idx }) => {
        const item = items[idx];
        const parsedName = parseNfProductName(item.productName);
        const current = resolutions[idx];
        return (
          <div key={idx} className="rounded-md border p-3 space-y-3">
            <p className="text-sm font-medium">{item.productName}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={current?.kind === 'link' ? 'default' : 'outline'}
                onClick={() => onChange({ ...resolutions, [idx]: { kind: 'link', productId: current?.kind === 'link' ? current.productId : '' } })}
              >
                Vincular
              </Button>
              <Button
                type="button"
                size="sm"
                variant={current?.kind === 'create' ? 'default' : 'outline'}
                onClick={() => onChange({
                  ...resolutions,
                  [idx]: {
                    kind: 'create',
                    name: parsedName.baseName,
                    sku: item.productCode || `NF-${idx + 1}`,
                    color: parsedName.color,
                    category: /adesivo|cola|solvent|resina|quimi/i.test(item.productName) ? 'Cola / Químico' : 'Componente',
                    unit: 'un',
                    groupId: null,
                    supplierId,
                    purchaseUnit: item.unit,
                    conversionRate: 1,
                  },
                })}
              >
                Criar novo
              </Button>
            </div>
            {current?.kind === 'link' && (
              <Select value={current.productId || undefined} onValueChange={(id) => onChange({ ...resolutions, [idx]: { kind: 'link', productId: id } })}>
                <SelectTrigger><SelectValue placeholder="Escolha o produto" /></SelectTrigger>
                <SelectContent>
                  {products.slice(0, 400).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ''}{p.color ? ` · ${p.color}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {current?.kind === 'create' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Nome</Label>
                  <Input value={current.name} onChange={(e) => onChange({ ...resolutions, [idx]: { ...current, name: e.target.value } })} />
                </div>
                <div>
                  <Label className="text-xs">SKU (código da NF)</Label>
                  <Input value={current.sku} onChange={(e) => onChange({ ...resolutions, [idx]: { ...current, sku: e.target.value } })} />
                </div>
                <div>
                  <Label className="text-xs">Cor</Label>
                  <Input value={current.color ?? ''} onChange={(e) => onChange({ ...resolutions, [idx]: { ...current, color: e.target.value || null } })} />
                </div>
                <div>
                  <Label className="text-xs">Categoria</Label>
                  <Select value={current.category} onValueChange={(v) => onChange({ ...resolutions, [idx]: { ...current, category: v } })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Unidade de estoque</Label>
                  <Select value={current.unit} onValueChange={(v) => onChange({ ...resolutions, [idx]: { ...current, unit: v } })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Grupo</Label>
                  <Select value={current.groupId || '_none'} onValueChange={(v) => onChange({ ...resolutions, [idx]: { ...current, groupId: v === '_none' ? null : v } })}>
                    <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sem grupo</SelectItem>
                      {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Unidade de compra (NF: {item.unit})</Label>
                  <Input value={current.purchaseUnit ?? item.unit} onChange={(e) => onChange({ ...resolutions, [idx]: { ...current, purchaseUnit: e.target.value } })} />
                </div>
                <div>
                  <Label className="text-xs">Fator (1 compra = ? estoque)</Label>
                  <Input
                    inputMode="decimal"
                    value={String(current.conversionRate ?? 1)}
                    onChange={(e) => onChange({ ...resolutions, [idx]: { ...current, conversionRate: Number(String(e.target.value).replace(',', '.')) || 0 } })}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

