import { useState, useEffect, useMemo } from 'react';
import { Package as PackagePlus, MagnifyingGlass as Search, Warning as AlertTriangle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useProducts, findGroupForProduct } from '@/hooks/useProducts';
import { useGroups } from '@/hooks/useGroups';
import { convertNfToStockUnit } from '@/lib/nfUnitConversion';
import { useUpdateInvoiceItem, type InvoiceItem } from '@/hooks/useSuppliers';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { CATEGORIES, UNITS, LOCATIONS } from '@/types/inventory';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: InvoiceItem[];
};

/** Normalize name for comparison: uppercase, remove accents, remove extra spaces */
function normalizeName(name: string): string {
  return name.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

/** Parse "Material : Cor" or "Material - Cor" pattern */
function parseNameAndColor(productName: string): { baseName: string; color: string | null } {
  const colonIdx = productName.lastIndexOf(':');
  if (colonIdx > 0) {
    return { baseName: productName.substring(0, colonIdx).trim(), color: productName.substring(colonIdx + 1).trim() };
  }
  const dashIdx = productName.lastIndexOf(' - ');
  if (dashIdx > 0) {
    return { baseName: productName.substring(0, dashIdx).trim(), color: productName.substring(dashIdx + 3).trim() };
  }
  return { baseName: productName.trim(), color: null };
}


/** Find products matching by name and color across all groups */
function findMatchesByNameAndColor<T extends { id: string; name: string; color?: string | null; group_id?: string | null }>(
  productName: string,
  allProducts: T[],
  groups: { id: string; name: string }[]
): { product: T; groupName: string | null; matchType: 'exact' | 'name_color' | 'base_name' }[] {
  const { baseName, color } = parseNameAndColor(productName);
  const normalizedBase = normalizeName(baseName);
  const normalizedColor = color ? normalizeName(color) : null;
  const normalizedFull = normalizeName(productName);

  const matches: { product: T; groupName: string | null; matchType: 'exact' | 'name_color' | 'base_name' }[] = [];

  for (const p of allProducts) {
    const pNorm = normalizeName(p.name);
    const groupName = p.group_id ? groups.find(g => g.id === p.group_id)?.name || null : null;

    if (pNorm === normalizedFull) {
      matches.push({ product: p, groupName, matchType: 'exact' });
      continue;
    }

    const pParsed = parseNameAndColor(p.name);
    const pBase = normalizeName(pParsed.baseName);
    const pColor = pParsed.color ? normalizeName(pParsed.color) : (p.color ? normalizeName(p.color) : null);

    if (normalizedBase && pBase === normalizedBase && normalizedColor && pColor && pColor === normalizedColor) {
      matches.push({ product: p, groupName, matchType: 'name_color' });
      continue;
    }

    if (normalizedBase && pBase === normalizedBase) {
      matches.push({ product: p, groupName, matchType: 'base_name' });
    }
  }

  const priority = { exact: 0, name_color: 1, base_name: 2 };
  matches.sort((a, b) => priority[a.matchType] - priority[b.matchType]);
  return matches;
}

export default function AddToStockDialog({ open, onOpenChange, items }: Props) {
  const { data: products = [] } = useProducts();
  const { data: groups = [] } = useGroups();
  const updateItem = useUpdateInvoiceItem();
  const [mode, setMode] = useState<'link' | 'create'>('link');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);

  // New product form
  const [newName, setNewName] = useState('');
  const [newSku, setNewSku] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newUnit, setNewUnit] = useState('un');
  const [newLocation, setNewLocation] = useState('');
  const [newGroupId, setNewGroupId] = useState<string | null>(null);

  // Similar product detection
  const [similarProduct, setSimilarProduct] = useState<typeof products[0] | null>(null);
  const [similarMatchInfo, setSimilarMatchInfo] = useState<{ groupName: string | null; matchType: string } | null>(null);
  const [showSimilarDialog, setShowSimilarDialog] = useState(false);

  // SKU duplicate confirmation
  const [skuDuplicateProduct, setSkuDuplicateProduct] = useState<{ id: string; name: string; sku: string; quantity: number; unit_price: number; unit: string } | null>(null);
  const [showSkuDuplicateDialog, setShowSkuDuplicateDialog] = useState(false);

  const pendingItems = items.filter(i => !i.added_to_stock);
  const currentItem = pendingItems[currentIdx];

  // Find similar products when creating new — uses name+color matching across groups
  const groupMatchResults = useMemo(() => {
    if (!newName || mode !== 'create') return [];
    return findMatchesByNameAndColor(newName, products, groups);
  }, [products, groups, newName, mode]);

  

  useEffect(() => {
    if (open && currentItem) {
      setNewName(currentItem.product_name);
      setNewSku(currentItem.product_code || '');
      setNewUnit(currentItem.unit || 'un');
      setSelectedProductId('');
      setProductSearch('');
      setSimilarProduct(null);
      setNewGroupId(null);
      // Try to auto-match by product code
      const match = products.find(p => p.sku === currentItem.product_code);
      if (match) {
        setMode('link');
        setSelectedProductId(match.id);
      } else {
        setMode('create');
        // Try auto-find group
        findGroupForProduct(currentItem.product_name).then(gid => {
          if (gid) setNewGroupId(gid);
        });
      }
    }
  }, [open, currentIdx, currentItem, products]);

  if (!currentItem) return null;

  const filteredProducts = products.filter(p => {
    if (!productSearch) return true;
    const q = productSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
  });

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const handleSave = async (forceCreate = false) => {
    // Check for similar products when creating new (unless forced)
    if (mode === 'create' && !forceCreate && groupMatchResults.length > 0) {
      setSimilarProduct(groupMatchResults[0].product);
      setSimilarMatchInfo({ groupName: groupMatchResults[0].groupName, matchType: groupMatchResults[0].matchType });
      setShowSimilarDialog(true);
      return;
    }

    setSaving(true);
    try {
      let productId: string;

      if (mode === 'link') {
        if (!selectedProductId) { toast.error('Selecione um produto'); setSaving(false); return; }
        productId = selectedProductId;
        // Update stock quantity and price with unit conversion
        const product = products.find(p => p.id === productId);
        if (product) {
          const conv = convertNfToStockUnit(
            currentItem.quantity,
            currentItem.unit,
            currentItem.unit_price,
            {
              unit: product.unit,
              name: product.name,
              conversion_rate: (product as any).conversion_rate,
              purchase_unit: (product as any).purchase_unit,
              purchase_order_unit: (product as any).purchase_order_unit,
            },
          );

          if (conv.needsConfig) {
            toast.error(`Não foi possível lançar: ${conv.reason}`, { duration: 12000 });
            setSaving(false);
            return;
          }

          const addQty = conv.qty;
          const addPrice = conv.unitPrice;
          if (!Number.isFinite(addPrice) || addPrice <= 0) {
            toast.error('Valor unitário inválido — impossível dar entrada sem preço.');
            setSaving(false);
            return;
          }
          const oldQty = Number(product.quantity) || 0;
          const newQty = oldQty + addQty;
          const totalValue = (oldQty * (Number(product.unit_price) || 0)) + (addQty * addPrice);
          const newPrice = newQty > 0 ? totalValue / newQty : addPrice;

          const convNote = conv.converted
            ? ` (convertido ${currentItem.quantity} ${currentItem.unit} → ${addQty.toFixed(3)} ${product.unit})`
            : '';

          const stockResult = await adjustStockSafe({
            productId,
            expectedPrevious: oldQty,
            newQty,
            reason: `Entrada via NF - ${currentItem.product_name}${convNote}`,
          });
          if (!stockResult.success) throw new Error(stockResult.errorMessage);
          // Update weighted-average unit_price separately (not covered by the RPC).
          // Capture the error — a silent failure leaves stock incremented but WAC stale.
          const { error: priceErr } = await supabase.from('products').update({ unit_price: newPrice }).eq('id', productId);
          if (priceErr) throw new Error(`Estoque atualizado, mas WAC não foi salvo: ${priceErr.message}`);
        }
      } else {
        if (!newName || !newSku || !newCategory) { toast.error('Preencha nome, SKU e categoria'); setSaving(false); return; }
        
        // Check if SKU already exists - ask user before unifying
        const { data: existingProduct } = await supabase.from('products').select('id, name, sku, quantity, unit_price, unit').eq('sku', newSku).maybeSingle();
        
        if (existingProduct) {
          // SKU already exists - show confirmation dialog
          setSkuDuplicateProduct(existingProduct);
          setShowSkuDuplicateDialog(true);
          setSaving(false);
          return;
        } else {
          const initialPrice = Number(currentItem.unit_price);
          if (!Number.isFinite(initialPrice) || initialPrice <= 0) {
            toast.error('Valor unitário inválido — impossível criar produto sem preço.');
            setSaving(false);
            return;
          }
          const { data: newProdId, error } = await supabase.rpc('create_product_with_initial_stock', {
            p_name: newName,
            p_sku: newSku,
            p_category: newCategory,
            p_unit: newUnit,
            p_location: newLocation || 'Almoxarifado A',
            p_quantity: currentItem.quantity,
            p_unit_price: initialPrice,
            p_min_stock: 0,
            p_max_stock: 0,
            p_group_id: newGroupId || null,
            p_description: null,
            p_supplier_id: null,
            p_reason: `Entrada via NF (novo produto) - ${currentItem.product_name}`,
          });
          if (error) throw error;
          productId = newProdId as string;

          if (newGroupId) {
            const group = groups.find(g => g.id === newGroupId);
            toast.info(`Produto adicionado ao grupo "${group?.name || 'selecionado'}".`);
          }
        }
      }

      // Mark invoice item as added to stock
      await updateItem.mutateAsync({ id: currentItem.id, data: { added_to_stock: true, product_id: productId } });

      toast.success(`"${currentItem.product_name}" lançado no estoque!`);

      if (currentIdx < pendingItems.length - 1) {
        setCurrentIdx(currentIdx + 1);
      } else {
        onOpenChange(false);
        setCurrentIdx(0);
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  /** Handle using the existing similar product instead of creating new */
  const handleUseSimilar = async () => {
    if (!similarProduct) return;
    setShowSimilarDialog(false);
    setSaving(true);

    try {
      const conv = convertNfToStockUnit(
        currentItem.quantity,
        currentItem.unit,
        currentItem.unit_price,
        {
          unit: similarProduct.unit,
          name: similarProduct.name,
          conversion_rate: (similarProduct as any).conversion_rate,
          purchase_unit: (similarProduct as any).purchase_unit,
          purchase_order_unit: (similarProduct as any).purchase_order_unit,
        },
      );
      if (conv.needsConfig) {
        toast.error(`Não foi possível lançar: ${conv.reason}`, { duration: 12000 });
        setSaving(false);
        setSimilarProduct(null);
        return;
      }
      const addQty = conv.qty;
      const addPrice = conv.unitPrice;
      const oldQty = Number(similarProduct.quantity) || 0;
      const newQty = oldQty + addQty;
      const totalValue = (oldQty * (Number(similarProduct.unit_price) || 0)) + (addQty * addPrice);
      const newPrice = newQty > 0 ? totalValue / newQty : addPrice;
      const convNote = conv.converted
        ? ` (convertido ${currentItem.quantity} ${currentItem.unit} → ${addQty.toFixed(3)} ${similarProduct.unit})`
        : '';

      const stockResult2 = await adjustStockSafe({
        productId: similarProduct.id,
        expectedPrevious: oldQty,
        newQty,
        reason: `Entrada via NF - ${currentItem.product_name}${convNote}`,
      });
      if (!stockResult2.success) throw new Error(stockResult2.errorMessage);
      await supabase.from('products').update({ unit_price: newPrice }).eq('id', similarProduct.id);

      await updateItem.mutateAsync({ id: currentItem.id, data: { added_to_stock: true, product_id: similarProduct.id } });

      toast.success(`Estoque de "${similarProduct.name}" atualizado!`);

      if (currentIdx < pendingItems.length - 1) {
        setCurrentIdx(currentIdx + 1);
      } else {
        onOpenChange(false);
        setCurrentIdx(0);
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
      setSimilarProduct(null);
    }
  };

  /** Handle unifying with existing product by SKU */
  const handleUnifySku = async () => {
    if (!skuDuplicateProduct || !currentItem) return;
    setShowSkuDuplicateDialog(false);
    setSaving(true);

    try {
      const conv = convertNfToStockUnit(
        currentItem.quantity,
        currentItem.unit,
        currentItem.unit_price,
        {
          unit: skuDuplicateProduct.unit,
          name: skuDuplicateProduct.name,
          conversion_rate: (skuDuplicateProduct as any).conversion_rate,
          purchase_unit: (skuDuplicateProduct as any).purchase_unit,
          purchase_order_unit: (skuDuplicateProduct as any).purchase_order_unit,
        },
      );
      if (conv.needsConfig) {
        toast.error(`Não foi possível lançar: ${conv.reason}`, { duration: 12000 });
        setSaving(false);
        setSkuDuplicateProduct(null);
        return;
      }
      const addQty = conv.qty;
      const addPrice = conv.unitPrice;
      const oldQty = Number(skuDuplicateProduct.quantity) || 0;
      const newQty = oldQty + addQty;
      const totalValue = (oldQty * (Number(skuDuplicateProduct.unit_price) || 0)) + (addQty * addPrice);
      const newPrice = newQty > 0 ? totalValue / newQty : addPrice;
      const convNote = conv.converted
        ? ` (convertido ${currentItem.quantity} ${currentItem.unit} → ${addQty.toFixed(3)} ${skuDuplicateProduct.unit})`
        : '';

      const stockResult3 = await adjustStockSafe({
        productId: skuDuplicateProduct.id,
        expectedPrevious: oldQty,
        newQty,
        reason: `Entrada via NF (SKU unificado) - ${currentItem.product_name}${convNote}`,
      });
      if (!stockResult3.success) throw new Error(stockResult3.errorMessage);
      await supabase.from('products').update({ unit_price: newPrice }).eq('id', skuDuplicateProduct.id);

      await updateItem.mutateAsync({ id: currentItem.id, data: { added_to_stock: true, product_id: skuDuplicateProduct.id } });

      toast.success(`Estoque de "${skuDuplicateProduct.name}" atualizado (SKU unificado)!`);

      if (currentIdx < pendingItems.length - 1) {
        setCurrentIdx(currentIdx + 1);
      } else {
        onOpenChange(false);
        setCurrentIdx(0);
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
      setSkuDuplicateProduct(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) setCurrentIdx(0); onOpenChange(v); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-primary" />
              Lançar no Estoque ({currentIdx + 1}/{pendingItems.length})
            </DialogTitle>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <p className="text-sm font-semibold">{currentItem.product_name}</p>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>Código: <strong className="text-foreground">{currentItem.product_code || '—'}</strong></span>
              <span>Qtd: <strong className="text-foreground">{currentItem.quantity} {currentItem.unit}</strong></span>
              <span>Valor: <strong className="text-foreground">{fmt(currentItem.unit_price)}</strong></span>
            </div>
          </div>

          <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'link' | 'create')} className="grid grid-cols-2 gap-3">
            <Label htmlFor="mode-link" className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${mode === 'link' ? 'border-primary bg-primary/5' : ''}`}>
              <RadioGroupItem value="link" id="mode-link" />
              <div>
                <p className="text-sm font-medium">Vincular existente</p>
                <p className="text-xs text-muted-foreground">Soma ao estoque atual</p>
              </div>
            </Label>
            <Label htmlFor="mode-create" className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${mode === 'create' ? 'border-primary bg-primary/5' : ''}`}>
              <RadioGroupItem value="create" id="mode-create" />
              <div>
                <p className="text-sm font-medium">Criar novo produto</p>
                <p className="text-xs text-muted-foreground">Cadastra no estoque</p>
              </div>
            </Label>
          </RadioGroup>

          {mode === 'link' ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar produto por nome ou SKU..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="pl-9" />
              </div>
              <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                {filteredProducts.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3 text-center">Nenhum produto encontrado</p>
                ) : filteredProducts.slice(0, 20).map(p => (
                  <button
                    key={p.id}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${selectedProductId === p.id ? 'bg-primary/10' : ''}`}
                    onClick={() => setSelectedProductId(p.id)}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">SKU: {p.sku} | Estoque: {p.quantity} {p.unit}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Similar product warning */}
              {groupMatchResults.length > 0 && (
                <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="text-xs space-y-1">
                    <p className="font-medium">
                      {groupMatchResults[0].matchType === 'exact' ? 'Produto idêntico encontrado!' :
                       groupMatchResults[0].matchType === 'name_color' ? 'Mesmo material e cor encontrado!' :
                       'Material com nome similar encontrado:'}
                    </p>
                    <p className="text-muted-foreground">
                      {groupMatchResults[0].product.name} (SKU: {groupMatchResults[0].product.sku})
                      {groupMatchResults[0].groupName && <span className="ml-1">— Grupo: <strong>{groupMatchResults[0].groupName}</strong></span>}
                    </p>
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Nome</Label>
                  <Input value={newName} onChange={e => setNewName(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">SKU</Label>
                  <Input value={newSku} onChange={e => setNewSku(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Categoria</Label>
                  <Select value={newCategory} onValueChange={setNewCategory}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Unidade</Label>
                  <Select value={newUnit} onValueChange={setNewUnit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Localização</Label>
                  <Select value={newLocation} onValueChange={setNewLocation}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Grupo de Material</Label>
                  <Select value={newGroupId || '_none'} onValueChange={(v) => setNewGroupId(v === '_none' ? null : v)}>
                    <SelectTrigger className={!newGroupId ? 'border-amber-500/50' : ''}>
                      <SelectValue placeholder="Selecione o grupo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">— Sem grupo —</SelectItem>
                      {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {!newGroupId && (
                    <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Selecione um grupo para vincular este material
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {currentIdx < pendingItems.length - 1 && (
              <Button variant="outline" onClick={() => setCurrentIdx(currentIdx + 1)} disabled={saving}>
                Pular
              </Button>
            )}
            <Button onClick={() => handleSave()} disabled={saving}>
              {saving ? 'Salvando...' : 'Lançar no Estoque'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Similar product confirmation dialog */}
      <AlertDialog open={showSimilarDialog} onOpenChange={setShowSimilarDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {similarMatchInfo?.matchType === 'exact' ? 'Produto idêntico encontrado' :
               similarMatchInfo?.matchType === 'name_color' ? 'Mesmo material e cor encontrado' :
               'Produto similar encontrado'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {similarMatchInfo?.matchType === 'exact' 
                    ? 'Foi encontrado um produto com nome idêntico no estoque. É o mesmo item?'
                    : similarMatchInfo?.matchType === 'name_color'
                    ? 'Foi encontrado um produto com mesmo material e cor no estoque. É o mesmo item?'
                    : 'Foi encontrado um produto com nome similar no estoque. Deseja atualizar o cadastro existente ou criar um novo?'}
                </p>
                {similarProduct && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <p className="text-sm font-semibold text-foreground">{similarProduct.name}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>SKU: <strong className="text-foreground">{similarProduct.sku}</strong></span>
                      <span>Estoque: <strong className="text-foreground">{similarProduct.quantity} {similarProduct.unit}</strong></span>
                      <span>Preço: <strong className="text-foreground">{fmt(similarProduct.unit_price)}</strong></span>
                      {similarMatchInfo?.groupName && (
                        <span>Grupo: <strong className="text-foreground">{similarMatchInfo.groupName}</strong></span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={() => setSimilarProduct(null)}>Cancelar</AlertDialogCancel>
            <Button variant="outline" onClick={() => { setShowSimilarDialog(false); handleSave(true); }}>
              Criar novo mesmo assim
            </Button>
            <AlertDialogAction onClick={handleUseSimilar}>
              Atualizar existente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* SKU duplicate confirmation dialog */}
      <AlertDialog open={showSkuDuplicateDialog} onOpenChange={(v) => { if (!v) { setShowSkuDuplicateDialog(false); setSkuDuplicateProduct(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              SKU já cadastrado
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  O SKU <strong>{skuDuplicateProduct?.sku}</strong> já está vinculado a um produto existente. Deseja unificar e somar ao estoque?
                </p>
                {skuDuplicateProduct && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <p className="text-sm font-semibold text-foreground">{skuDuplicateProduct.name}</p>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>SKU: <strong className="text-foreground">{skuDuplicateProduct.sku}</strong></span>
                      <span>Estoque: <strong className="text-foreground">{skuDuplicateProduct.quantity} {skuDuplicateProduct.unit}</strong></span>
                      <span>Preço: <strong className="text-foreground">{fmt(skuDuplicateProduct.unit_price)}</strong></span>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setSkuDuplicateProduct(null); }}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnifySku}>
              Sim, unificar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
