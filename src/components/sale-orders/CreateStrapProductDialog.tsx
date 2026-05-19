import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberInput } from '@/components/ui/number-input';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, Package, Warning as AlertTriangle, Check, PencilSimple as Pencil } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeUuidFields } from '@/lib/utils';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { UNITS, LOCATIONS } from '@/types/inventory';
import { deriveCategoryFromGroup } from '@/lib/categoryFromGroup';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
  color: string;
  onCreated: () => void;
}

type SimilarProduct = {
  id: string;
  name: string;
  color: string;
  category: string;
  group_id: string | null;
  quantity: number;
  unit: string;
  sku?: string;
  unit_price?: number;
};

const normalizeForComparison = (value: string) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const fuzzyMatch = (a: string, b: string) => {
  const na = normalizeForComparison(a);
  const nb = normalizeForComparison(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Check token overlap
  const tokensA = new Set(a.toLowerCase().split(/[\s:,\-_/]+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/[\s:,\-_/]+/).filter(Boolean));
  let overlap = 0;
  for (const t of tokensA) {
    for (const tb of tokensB) {
      if (t === tb || t.includes(tb) || tb.includes(t)) { overlap++; break; }
    }
  }
  return overlap >= Math.min(tokensA.size, tokensB.size) && overlap >= 1;
};

const normalizeSkuPart = (value: string, fallback: string, maxLength: number) => {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, maxLength);

  return normalized || fallback;
};

const deriveSkuFromBase = (baseSku: string, color: string) => {
  const trimmedBase = baseSku.trim();
  if (!trimmedBase) return '';

  const parts = trimmedBase.split('-').filter(Boolean);
  const colorToken = normalizeSkuPart(color, 'COR', 4);

  if (parts.length > 1) {
    parts[parts.length - 1] = colorToken;
    return parts.join('-');
  }

  return `${trimmedBase}-${colorToken}`;
};

const buildFallbackSku = (groupName: string, color: string, attempt = 0) => {
  const groupToken = normalizeSkuPart(groupName, 'TIRA', 6);
  const colorToken = normalizeSkuPart(color, 'COR', 4);
  const timeToken = Date.now().toString(36).toUpperCase().slice(-4);
  const attemptToken = String(attempt).padStart(2, '0');

  return `${groupToken}-${colorToken}-${timeToken}${attemptToken}`;
};

const resolveUniqueSku = async (preferredSku: string, groupName: string, color: string) => {
  const candidates = [preferredSku.trim(), ...Array.from({ length: 6 }, (_, idx) => buildFallbackSku(groupName, color, idx))]
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);

  const tried = new Set<string>();

  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);

    const { data: existingSku } = await supabase
      .from('products')
      .select('id')
      .eq('sku', candidate)
      .maybeSingle();

    if (!existingSku) return candidate;
  }

  return `${normalizeSkuPart(groupName, 'TIRA', 6)}-${normalizeSkuPart(color, 'COR', 4)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
};

export default function CreateStrapProductDialog({ open, onOpenChange, groupId, groupName, color, onCreated }: Props) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [prefilling, setPrefilling] = useState(true);
  const [similarProducts, setSimilarProducts] = useState<SimilarProduct[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<SimilarProduct | null>(null);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  // Default 'm' pra grupos de tira/elástico (são sempre vendidos por metro).
  // Antes default 'un' deixava o débito por metros divergente do estoque.
  const isStrapLikeGroup = /tira|elastic|tranç/i.test(groupName || '');
  const [unit, setUnit] = useState(isStrapLikeGroup ? 'm' : 'un');
  const [unitPrice, setUnitPrice] = useState(0);
  const [location, setLocation] = useState('');
  const [minStock, setMinStock] = useState(0);
  const [maxStock, setMaxStock] = useState(0);
  const [initialStock, setInitialStock] = useState(0);
  const [yieldPerMeter, setYieldPerMeter] = useState<number | null>(null);
  const [yieldUnit, setYieldUnit] = useState('dm²');
  const [dimLength, setDimLength] = useState(0);
  const [dimWidth, setDimWidth] = useState(0);
  const [dimThickness, setDimThickness] = useState(0);
  const [dimUnit, setDimUnit] = useState('mm');

  useEffect(() => {
    if (!open || !groupId) return;
    setPrefilling(true);
    setSimilarProducts([]);
    setShowForm(false);

    (async () => {
      const { data: lastProduct } = await supabase
        .from('products')
        .select('*')
        .eq('group_id', groupId)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastProduct) {
        setCategory(lastProduct.category || '');
        // Se o grupo é tira/elástico, força 'm' independente do produto anterior
        // (que pode estar com unit errado — bug conhecido em alguns cadastros).
        setUnit(isStrapLikeGroup ? 'm' : (lastProduct.unit || 'un'));
        setUnitPrice(lastProduct.unit_price || 0);
        setLocation(lastProduct.location || '');
        setMinStock(lastProduct.min_stock || 0);
        setMaxStock(lastProduct.max_stock || 0);
        setYieldPerMeter(lastProduct.yield_per_meter);
        setYieldUnit(lastProduct.yield_unit || 'dm²');
        setDimLength(lastProduct.dimensions_length || 0);
        setDimWidth(lastProduct.dimensions_width || 0);
        setDimThickness(lastProduct.dimensions_thickness || 0);
        setDimUnit(lastProduct.dimensions_unit || 'mm');

        const derivedSku = deriveSkuFromBase(lastProduct.sku || '', color);
        setSku(derivedSku || buildFallbackSku(groupName, color));
      } else {
        setSku(buildFallbackSku(groupName, color));
      }
      setInitialStock(0);

      const proposedName = `${groupName}: ${color}`;
      setName(proposedName);

      const normalizedColor = color.trim().toLowerCase();
      const normalizedGroup = groupName.trim().toLowerCase();
      // BUG ANTIGO: buscávamos similares em TODOS os grupos e mostrávamos
      // produtos de outras famílias (ex: "Verde Lima" em NAPA Sudani
      // aparecia quando o usuário queria cadastrar "Verde Lima" em
      // Tira Strass). Se ele clicasse no similar errado, o produto era
      // RENOMEADO/MOVIDO pra outra família via handleUseExisting:219.
      // FIX: filtrar similares APENAS dentro do mesmo group_id da tira
      // selecionada. Se a cor não existe nesse grupo específico, vai
      // direto pro form de criação (sem desvio).
      const { data: allMatches } = await supabase
        .from('products')
        .select('id, name, color, category, group_id, quantity, unit, sku, unit_price')
        .eq('active', true)
        .eq('group_id', groupId);

      const similar = (allMatches || []).filter((p: any) => {
        const pName = p.name?.trim().toLowerCase() || '';
        const pColor = p.color?.trim().toLowerCase() || '';
        // Match exato da cor dentro do MESMO grupo (já filtrado no SQL)
        if (pColor === normalizedColor) return true;
        if (fuzzyMatch(pColor, color)) return true;
        if (fuzzyMatch(pName, proposedName)) return true;
        if (pName.endsWith(`: ${normalizedColor}`) || pName.endsWith(` - ${normalizedColor}`) || pName.endsWith(` ${normalizedColor}`)) return true;
        return false;
      });

      if (similar.length > 0) {
        setSimilarProducts(similar as SimilarProduct[]);
        setShowForm(false);
      } else {
        setShowForm(true);
      }

      setPrefilling(false);
    })();
  }, [open, groupId, groupName, color]);


  const handleUseExisting = async (product: SimilarProduct, openEdit = false) => {
    if (product.group_id !== groupId) {
      await supabase.from('products').update({ group_id: groupId }).eq('id', product.id);
      toast.success(`"${product.name}" vinculado ao grupo ${groupName}`);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products_for_colors'] });
    } else {
      toast.info(`"${product.name}" já está cadastrado neste grupo`);
    }

    if (openEdit) {
      setEditingProduct(product);
    } else {
      onCreated();
      onOpenChange(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingProduct) return;
    setLoading(true);
    try {
      const updates: Record<string, any> = {
        name: name.trim(),
        color: color.trim(),
        category,
        unit,
        unit_price: unitPrice,
        location,
        min_stock: minStock,
        max_stock: maxStock,
      };
      if (sku.trim()) updates.sku = sku.trim();
      const { error } = await supabase.from('products').update(updates).eq('id', editingProduct.id);
      if (error) throw error;
      toast.success(`"${updates.name}" atualizado!`);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products_for_colors'] });
      onCreated();
      onOpenChange(false);
      setEditingProduct(null);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedColor = color.trim();

    if (!trimmedName) {
      toast.error('Nome é obrigatório');
      return;
    }

    setLoading(true);
    try {
      const normalizedName = trimmedName.toLowerCase();
      const normalizedColor = trimmedColor.toLowerCase();

      const { data: existingInGroup } = await supabase
        .from('products')
        .select('id, name, color, group_id')
        .eq('group_id', groupId)
        .eq('active', true);

      const existingProduct = (existingInGroup || []).find((p: any) => {
        const pName = (p.name || '').trim().toLowerCase();
        const pColor = (p.color || '').trim().toLowerCase();
        return pName === normalizedName || pColor === normalizedColor;
      });

      if (existingProduct) {
        toast.info(`"${existingProduct.name}" já está cadastrado neste grupo`);
        qc.invalidateQueries({ queryKey: ['products'] });
        qc.invalidateQueries({ queryKey: ['products_for_colors'] });
        onCreated();
        onOpenChange(false);
        return;
      }

      const finalSku = await resolveUniqueSku(sku, groupName, trimmedColor);
      // Defesa: category é NOT NULL no DB. Se o state ficou vazio (sem
      // produto anterior no grupo pra pré-preencher), deriva do groupName.
      const safeCategory = (category && category.trim()) || deriveCategoryFromGroup(groupName);
      const productData = sanitizeUuidFields({
        name: trimmedName,
        sku: finalSku,
        category: safeCategory,
        color: trimmedColor,
        unit,
        unit_price: unitPrice,
        location,
        min_stock: minStock,
        max_stock: maxStock,
        quantity: Math.max(0, Number(initialStock) || 0),
        group_id: groupId,
        active: true,
        image_url: '',
        yield_per_meter: yieldPerMeter,
        yield_unit: yieldUnit,
        dimensions_length: dimLength,
        dimensions_width: dimWidth,
        dimensions_thickness: dimThickness,
        dimensions_unit: dimUnit,
      });

      let { error } = await supabase.from('products').insert(productData as any);
      if (error?.code === '23505') {
        const retrySku = await resolveUniqueSku('', groupName, trimmedColor);
        ({ error } = await supabase.from('products').insert({ ...productData, sku: retrySku } as any));
      }
      if (error) throw error;

      toast.success(`Produto "${trimmedName}" criado no estoque!`);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products_for_colors'] });
      onCreated();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro ao criar produto: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Cadastrar Item no Estoque
          </DialogTitle>
        </DialogHeader>

        {prefilling ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {similarProducts.length > 0 && !showForm && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div>
                    <p className="font-semibold">Itens similares encontrados no estoque</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Encontramos {similarProducts.length} item(ns) que pode(m) ser o mesmo produto.
                      Deseja usar um existente ou cadastrar novo?
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary">{groupName}</Badge>
                  <span>•</span>
                  <Badge variant="outline">{color}</Badge>
                </div>

                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {similarProducts.map(p => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/30">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          {p.color && <Badge variant="outline" className="text-[10px]">{p.color}</Badge>}
                          {p.category && <Badge variant="secondary" className="text-[10px]">{p.category}</Badge>}
                          <span className="text-[10px] text-muted-foreground">
                            Estoque: {p.quantity} {p.unit}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => handleUseExisting(p, false)}>
                          <Check className="h-3 w-3" />
                          Usar
                        </Button>
                        <Button size="sm" variant="ghost" className="gap-1" onClick={() => handleUseExisting(p, true)}>
                          <Pencil className="h-3 w-3" />
                          Editar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <DialogFooter className="flex-col gap-2 sm:flex-row">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button variant="secondary" onClick={() => setShowForm(true)}>
                    Cadastrar novo mesmo assim
                  </Button>
                </DialogFooter>
              </div>
            )}

            {editingProduct && (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                  <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold">Editando: {editingProduct.name}</p>
                    <p className="text-xs text-muted-foreground">Atualize os dados e salve.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Nome</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">SKU</Label>
                    <Input value={sku} onChange={e => setSku(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <Input value={category} disabled className="h-9 text-sm bg-muted" />
                  </div>
                  <div>
                    <Label className="text-xs">Unidade</Label>
                    <Select value={unit} onValueChange={setUnit}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Preço Unitário</Label>
                    <NumberInput value={unitPrice} onChange={setUnitPrice} step="0.01" min={0} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Localização</Label>
                    <Select value={location} onValueChange={setLocation}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => { setEditingProduct(null); }} disabled={loading}>
                    Voltar
                  </Button>
                  <Button onClick={handleSaveEdit} disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar Alterações
                  </Button>
                </DialogFooter>
              </div>
            )}

            {showForm && !editingProduct && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary">{groupName}</Badge>
                  <span>•</span>
                  <Badge variant="outline">{color}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Nome</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} className="h-9 text-sm" />
                  </div>

                  <div>
                    <Label className="text-xs">SKU</Label>
                    <Input value={sku} onChange={e => setSku(e.target.value)} className="h-9 text-sm" />
                  </div>

                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <Input value={deriveCategoryFromGroup(groupName)} disabled className="h-9 text-sm bg-muted" />
                  </div>

                  <div>
                    <Label className="text-xs">Unidade</Label>
                    <Select value={unit} onValueChange={setUnit}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs">Preço Unitário</Label>
                    <NumberInput value={unitPrice} onChange={setUnitPrice} step="0.01" min={0} className="h-9 text-sm" />
                  </div>

                  <div>
                    <Label className="text-xs">Localização</Label>
                    <Select value={location} onValueChange={setLocation}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-2">
                    <Label className="text-xs">Estoque Inicial ({unit})</Label>
                    <NumberInput value={initialStock} onChange={setInitialStock} min={0} step="0.01" className="h-9 text-sm" />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Quantidade que entra no estoque agora (deixe 0 se for ajustar depois).
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs">Estoque Mín.</Label>
                    <NumberInput value={minStock} onChange={setMinStock} min={0} className="h-9 text-sm" />
                  </div>

                  <div>
                    <Label className="text-xs">Estoque Máx.</Label>
                    <NumberInput value={maxStock} onChange={setMaxStock} min={0} className="h-9 text-sm" />
                  </div>
                </div>

                {(dimLength > 0 || dimWidth > 0) && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-xs font-semibold text-muted-foreground">Dimensões</p>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <Label className="text-[10px]">Comp.</Label>
                        <NumberInput value={dimLength} onChange={setDimLength} min={0} className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label className="text-[10px]">Larg.</Label>
                        <NumberInput value={dimWidth} onChange={setDimWidth} min={0} className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label className="text-[10px]">Espess.</Label>
                        <NumberInput value={dimThickness} onChange={setDimThickness} min={0} className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label className="text-[10px]">Un.</Label>
                        <Select value={dimUnit} onValueChange={setDimUnit}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mm">mm</SelectItem>
                            <SelectItem value="cm">cm</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                {yieldPerMeter != null && yieldPerMeter > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Rendimento/m</Label>
                      <NumberInput value={yieldPerMeter || 0} onChange={v => setYieldPerMeter(v)} min={0} step="0.01" className="h-9 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Unidade Rendimento</Label>
                      <Select value={yieldUnit} onValueChange={setYieldUnit}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dm²">dm²</SelectItem>
                          <SelectItem value="par">par</SelectItem>
                          <SelectItem value="un">un</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSubmit} disabled={loading || prefilling}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Criar Produto
                  </Button>
                </DialogFooter>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
