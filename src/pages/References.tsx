import AppLayout from "@/components/layout/AppLayout";
import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { BookOpen, Plus, Trash2, Pencil, Loader2, ChevronDown, ChevronUp, Package, Info, Upload, ImageIcon, Copy, Clock, Layers, Scissors, Droplets, Shield, Box, Footprints, FileText, Link, Wand2, Download, AlertTriangle } from 'lucide-react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { useReferences, useAddReference, useUpdateReference, useDeleteReference, useReferenceMaterials, useAddMaterial, useDeleteMaterial, useBulkAddMaterials, useRecentMaterials } from '@/hooks/useReferences';
import { useTechnicalSheets, useSheetMaterials } from '@/hooks/useTechnicalSheets';
import { useProducts } from '@/hooks/useProducts';
import { ProductReference, ReferenceFormData, MaterialFormData, StrapColor } from '@/types/references';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ColorsMultiSelect } from '@/components/references/ColorsMultiSelect';
import { SHOE_CATEGORIES } from '@/lib/shoeCategories';
const REF_STATUSES = ['Ativo', 'Em desenvolvimento', 'Descontinuado'] as const;

const COMPONENT_CATEGORIES = [
  { key: 'Cabedal', label: 'Cabedal', icon: Layers, color: 'text-amber-600' },
  { key: 'Solado', label: 'Solado', icon: Footprints, color: 'text-stone-600' },
  { key: 'Palmilha', label: 'Palmilha', icon: Shield, color: 'text-blue-600' },
  { key: 'Forro', label: 'Forro', icon: Scissors, color: 'text-purple-600' },
  { key: 'Componente', label: 'Componentes', icon: Box, color: 'text-pink-600' },
  { key: 'Embalagem', label: 'Embalagem', icon: Box, color: 'text-green-600' },
  { key: 'Químico', label: 'Químicos (Cola, Primer, etc.)', icon: Droplets, color: 'text-red-600' },
] as const;

const emptyRefForm: ReferenceFormData = {
  name: '', description: '', code: '', collection: '', shoe_category: '', sizes: '33-41', colors: '', cost_price: 0, sale_price: 0, status: 'Ativo', image_url: '', technical_sheet_id: '', has_straps: false, strap_colors: [],
};

export default function References({ embedded }: { embedded?: boolean } = {}) {
  const { data: references = [], isLoading, isError } = useReferences();
  const { data: sheets = [] } = useTechnicalSheets();
  const addRef = useAddReference();
  const updateRef = useUpdateReference();
  const deleteRef = useDeleteReference();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductReference | null>(null);
  const [form, setForm] = useState<ReferenceFormData>(emptyRefForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openAdd = () => { setEditing(null); setForm(emptyRefForm); setDialogOpen(true); };
  const openEdit = (ref: ProductReference) => {
    setEditing(ref);
    setForm({
      name: ref.name, description: ref.description, code: ref.code || '', collection: ref.collection || '',
      shoe_category: ref.shoe_category || '', sizes: ref.sizes || '33-41', colors: ref.colors || '',
      cost_price: ref.cost_price || 0, sale_price: ref.sale_price || 0, status: ref.status || 'Ativo',
      image_url: ref.image_url || '', technical_sheet_id: (ref as any).technical_sheet_id || '',
      has_straps: (ref as any).has_straps || false,
      strap_colors: Array.isArray((ref as any).strap_colors) ? (ref as any).strap_colors : [],
    });
    setDialogOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Selecione um arquivo de imagem.'); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error('A imagem deve ter no máximo 8MB.'); return; }
    setUploading(true);
    try {
      const safeExt = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;
      const { error } = await supabase.storage.from('reference-images').upload(fileName, file);
      if (error) throw error;

      // Use a signed URL with a long expiry (10 years). This works whether the bucket
      // is public or private, and does not silently break on private buckets the way
      // getPublicUrl does. Falls back to public URL only if signing fails.
      const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
      const { data: signed, error: signErr } = await supabase.storage
        .from('reference-images')
        .createSignedUrl(fileName, TEN_YEARS);

      let url: string;
      if (signed?.signedUrl && !signErr) {
        url = signed.signedUrl;
      } else {
        const { data: { publicUrl } } = supabase.storage.from('reference-images').getPublicUrl(fileName);
        url = publicUrl;
      }
      setForm(f => ({ ...f, image_url: url }));
      toast.success('Imagem enviada!');
    } catch (err: any) {
      toast.error(`Erro ao enviar: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData = {
      ...form,
      technical_sheet_id: form.technical_sheet_id || null,
    } as any;
    if (editing) {
      updateRef.mutate({ id: editing.id, data: submitData });
    } else {
      addRef.mutate(submitData);
    }
    setDialogOpen(false);
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  

  if (isLoading) {
    return <><div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></>;
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="font-semibold text-foreground">Falha ao carregar dados</p>
        <p className="text-sm text-muted-foreground">Verifique sua conexão e recarregue a página.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5 page-enter">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Referências de Calçados</h2>
            <p className="text-sm text-muted-foreground">Modelos, fichas técnicas e custos de produção</p>
          </div>
          <Button onClick={openAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nova Referência</span>
          </Button>
        </div>

        {references.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <BookOpen className="h-10 w-10 mb-3 opacity-50" />
              <p>Nenhuma referência cadastrada</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {references.map((ref) => (
              <Card key={ref.id}>
                <CardHeader className="py-4 px-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => setExpandedId(expandedId === ref.id ? null : ref.id)}>
                      {ref.image_url ? (
                        <SignedImage src={ref.image_url} alt={ref.name} className="h-12 w-12 rounded-lg object-cover border" />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      {expandedId === ref.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">{ref.name}</CardTitle>
                          {ref.code && <Badge variant="outline" className="font-mono text-xs">{ref.code}</Badge>}
                          {ref.shoe_category && <Badge variant="secondary" className="text-xs">{ref.shoe_category}</Badge>}
                          <Badge variant={ref.status === 'Ativo' ? 'default' : ref.status === 'Descontinuado' ? 'destructive' : 'secondary'} className="text-xs">
                            {ref.status || 'Ativo'}
                          </Badge>
                          {(ref as any).technical_sheet_id && (() => {
                            const sheet = sheets.find(s => s.id === (ref as any).technical_sheet_id);
                            return sheet ? <Badge variant="outline" className="text-xs gap-1"><FileText className="h-3 w-3" />{sheet.name}</Badge> : null;
                          })()}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          {ref.collection && <span>Coleção: {ref.collection}</span>}
                          {ref.sizes && <span>Numeração: {ref.sizes}</span>}
                          {ref.cost_price > 0 && <span>Custo: {formatCurrency(ref.cost_price)}</span>}
                          {ref.sale_price > 0 && <span>Venda: {formatCurrency(ref.sale_price)}</span>}
                        </div>
                        {ref.description && <p className="text-sm text-muted-foreground mt-0.5">{ref.description}</p>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(ref)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <DeleteConfirmButton onConfirm={() => deleteRef.mutate(ref.id)} title="Excluir referência?" size="h-8 w-8" iconSize="h-4 w-4" />
                    </div>
                  </div>
                </CardHeader>
                {expandedId === ref.id && (
                  <CardContent className="pt-0 px-5 pb-4">
                    {(ref as any).technical_sheet_id ? (
                      <LinkedSheetView sheetId={(ref as any).technical_sheet_id} />
                    ) : (
                      <MaterialsList referenceId={ref.id} imageUrl={ref.image_url} shoeCategory={ref.shoe_category} />
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditing(null); setForm(emptyRefForm); } }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Referência' : 'Nova Referência'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            {/* Image upload */}
            <div className="flex items-center gap-4">
              <div
                className="h-24 w-24 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {form.image_url ? (
                  <SignedImage src={form.image_url} alt="Preview" className="h-full w-full object-cover" />
                ) : uploading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  <div className="text-center">
                    <Upload className="h-5 w-5 mx-auto text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">Foto</span>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium">Foto do Modelo</p>
                <p className="text-xs text-muted-foreground">Clique para enviar uma imagem do calçado</p>
                {form.image_url && (
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => setForm(f => ({ ...f, image_url: '' }))}>
                    Remover foto
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Ficha Técnica</Label>
                <Select value={form.technical_sheet_id} onValueChange={v => setForm(f => ({ ...f, technical_sheet_id: v === '_none' ? '' : v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Vincular a uma ficha técnica..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Sem ficha técnica</SelectItem>
                    {sheets.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          {s.name}
                          {s.shoe_category && <span className="text-xs text-muted-foreground">({s.shoe_category})</span>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="ref-name">Nome do Modelo</Label>
                <Input id="ref-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1" placeholder="Ex: Sandália Bella" />
              </div>
              <div>
                <Label htmlFor="ref-code">Código da Referência</Label>
                <Input id="ref-code" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="mt-1 font-mono" placeholder="Ex: REF-2026-001" />
              </div>
              <div>
                <Label>Categoria</Label>
                <Select value={form.shoe_category} onValueChange={v => {
                  setForm(f => ({
                    ...f,
                    shoe_category: v,
                    sizes: v === 'Infantil' ? '21-33' : '34-40',
                  }));
                }}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Tipo de calçado" /></SelectTrigger>
                  <SelectContent>
                    {SHOE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ref-collection">Coleção</Label>
                <Input id="ref-collection" value={form.collection} onChange={e => setForm(f => ({ ...f, collection: e.target.value }))} className="mt-1" placeholder="Ex: Verão 2026" />
              </div>
              <div className="col-span-2">
                <Label className="mb-1.5 block">Grade de Numeração</Label>
                <div className="flex gap-2 mb-2">
                  <Button
                    type="button"
                    variant={form.sizes === '34-40' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1 gap-1.5 h-9"
                    onClick={() => setForm(f => ({ ...f, sizes: '34-40' }))}
                  >
                    <Footprints className="h-4 w-4" /> Adulto (34-40)
                  </Button>
                  <Button
                    type="button"
                    variant={form.sizes === '21-33' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1 gap-1.5 h-9"
                    onClick={() => setForm(f => ({ ...f, sizes: '21-33' }))}
                  >
                    <Footprints className="h-4 w-4" /> Infantil (21-33)
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {getSizesForCategory(form.shoe_category === 'Infantil' || form.sizes === '21-33' ? 'Infantil' : undefined).map(size => (
                    <span key={size} className="h-7 w-9 rounded bg-muted text-xs font-mono flex items-center justify-center text-muted-foreground border">
                      {size}
                    </span>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <Label>Cores / Variações</Label>
                <ColorsMultiSelect
                  value={form.colors}
                  onChange={(v) => setForm(f => ({ ...f, colors: v }))}
                />
              </div>
              <div>
                <Label htmlFor="ref-cost">Preço de Custo</Label>
                <CurrencyInput id="ref-cost" value={form.cost_price} onChange={v => setForm(f => ({ ...f, cost_price: v }))} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="ref-sale">Preço de Venda</Label>
                <CurrencyInput id="ref-sale" value={form.sale_price} onChange={v => setForm(f => ({ ...f, sale_price: v }))} className="mt-1" />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REF_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="ref-desc">Descrição / Observações</Label>
                <Textarea id="ref-desc" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit">{editing ? 'Salvar' : 'Criar'}</Button>
            </div>
          </form>
          {editing && (
            <div className="border-t pt-4 mt-2">
              <MaterialsList referenceId={editing.id} imageUrl={editing.image_url} shoeCategory={editing.shoe_category} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

const ADULT_SIZES = [34, 35, 36, 37, 38, 39, 40];
const CHILD_SIZES = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33];

function getSizesForCategory(shoeCategory?: string): number[] {
  return shoeCategory === 'Infantil' ? CHILD_SIZES : ADULT_SIZES;
}

const emptyMaterialForm: Omit<MaterialFormData, 'product_id'> & { product_id: string } = {
  product_id: '', quantity_per_unit: 0, color: '', width: '', weight: '', supplier: '', notes: '', sizes: '',
};

function MaterialsList({ referenceId, imageUrl, shoeCategory }: { referenceId: string; imageUrl?: string; shoeCategory?: string }) {
  const MATERIAL_SIZES = getSizesForCategory(shoeCategory);
  const { data: materials = [], isLoading } = useReferenceMaterials(referenceId);
  const { data: products = [] } = useProducts();
  const { data: references = [] } = useReferences();
  const { data: recentMaterials = [] } = useRecentMaterials();
  const addMaterial = useAddMaterial();
  const deleteMaterial = useDeleteMaterial();
  const bulkAdd = useBulkAddMaterials();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyMaterialForm);
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [showRecentDialog, setShowRecentDialog] = useState(false);
  const [selectedRecent, setSelectedRecent] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState('components');
  const [topTab, setTopTab] = useState('ficha');

  const usedProductIds = new Set(materials.map(m => m.product_id));
  const availableProducts = products.filter(p => !usedProductIds.has(p.id));
  const otherRefs = references.filter(r => r.id !== referenceId);

  // Group materials by product category
  const groupedMaterials = useMemo(() => {
    const groups: Record<string, typeof materials> = {};
    materials.forEach(m => {
      const cat = (m as any).products?.category || 'Outros';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    });
    return groups;
  }, [materials]);

  // Cost summary by category
  const categoryCosts = useMemo(() => {
    const costs: Record<string, number> = {};
    let total = 0;
    materials.forEach(m => {
      const cat = (m as any).products?.category || 'Outros';
      const cost = Number(m.quantity_per_unit) * Number((m as any).products?.unit_price || 0);
      costs[cat] = (costs[cat] || 0) + cost;
      total += cost;
    });
    return { costs, total };
  }, [materials]);

  // Colors derived from materials in the technical sheet
  const materialColors = useMemo(() => {
    const colorSet = new Set<string>();
    materials.forEach(m => {
      if (m.color) {
        m.color.split(',').forEach(c => {
          const t = c.trim();
          if (t) colorSet.add(t);
        });
      }
    });
    return Array.from(colorSet).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [materials]);

  // Colors grouped by category
  const colorsByCategory = useMemo(() => {
    const map: Record<string, Record<string, string[]>> = {};
    materials.forEach(m => {
      if (!m.color) return;
      const cat = (m as any).products?.category || 'Outros';
      const prodName = (m as any).products?.name || '—';
      m.color.split(',').forEach(c => {
        const t = c.trim();
        if (!t) return;
        if (!map[t]) map[t] = {};
        if (!map[t][cat]) map[t][cat] = [];
        if (!map[t][cat].includes(prodName)) map[t][cat].push(prodName);
      });
    });
    return map;
  }, [materials]);

  const handleAdd = () => {
    if (!form.product_id || form.quantity_per_unit <= 0) return;
    addMaterial.mutate({ referenceId, data: form });
    setAdding(false);
    setForm(emptyMaterialForm);
  };

  const handleCopyFrom = async (sourceRefId: string) => {
    const { data } = await supabase
      .from('reference_materials')
      .select('product_id, quantity_per_unit, color, width, weight, supplier, notes, sizes')
      .eq('reference_id', sourceRefId);
    if (!data?.length) { toast.error('Referência sem materiais'); return; }
    const toAdd = data.filter(m => !usedProductIds.has(m.product_id)).map(m => ({ ...m, sizes: m.sizes || '' }));
    if (!toAdd.length) { toast.info('Todos os materiais já estão na ficha'); return; }
    bulkAdd.mutate({ referenceId, materials: toAdd });
    setShowCopyDialog(false);
  };

  const handleAddRecent = () => {
    const toAdd = recentMaterials
      .filter(m => selectedRecent.has(m.product_id) && !usedProductIds.has(m.product_id))
      .map(m => ({
        product_id: m.product_id,
        quantity_per_unit: m.quantity_per_unit,
        color: m.color || '',
        width: m.width || '',
        weight: m.weight || '',
        supplier: m.supplier || '',
        notes: m.notes || '',
        sizes: '',
      }));
    if (!toAdd.length) { toast.info('Nenhum material novo para adicionar'); return; }
    bulkAdd.mutate({ referenceId, materials: toAdd });
    setShowRecentDialog(false);
    setSelectedRecent(new Set());
  };

  const toggleRecent = (productId: string) => {
    setSelectedRecent(prev => {
      const next = new Set(prev);
      next.has(productId) ? next.delete(productId) : next.add(productId);
      return next;
    });
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);

  const getCategoryConfig = (cat: string) => {
    return COMPONENT_CATEGORIES.find(c => c.key === cat) || { key: cat, label: cat, icon: Package, color: 'text-muted-foreground' };
  };

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <div className="space-y-4">
      {/* Top-level tabs: Ficha Técnica | Cores */}
      <Tabs value={topTab} onValueChange={setTopTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="ficha" className="gap-1.5">
              <Package className="h-4 w-4" /> Ficha Técnica
              <Badge variant="outline" className="font-mono text-[10px] ml-1">{materials.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="cores" className="gap-1.5">
              <Droplets className="h-4 w-4" /> Cores Liberadas
              <Badge variant="outline" className="font-mono text-[10px] ml-1">{materialColors.length}</Badge>
            </TabsTrigger>
          </TabsList>

          {topTab === 'ficha' && (
            <div className="flex gap-1">
              {otherRefs.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setShowCopyDialog(!showCopyDialog)} className="gap-1 h-7 text-xs">
                  <Copy className="h-3 w-3" /> Copiar de Ref.
                </Button>
              )}
              {recentMaterials.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => { setShowRecentDialog(!showRecentDialog); setSelectedRecent(new Set()); }} className="gap-1 h-7 text-xs">
                  <Clock className="h-3 w-3" /> Recentes
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setAdding(!adding)} className="gap-1 h-7 text-xs">
                <Plus className="h-3 w-3" /> Material
              </Button>
            </div>
          )}
        </div>

        {/* ========== TAB: FICHA TÉCNICA ========== */}
        <TabsContent value="ficha" className="space-y-4 mt-3">

      {showCopyDialog && (
        <div className="p-3 rounded-md border bg-muted/30 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Copiar ficha técnica de outra referência:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
            {otherRefs.map(r => (
              <Button key={r.id} variant="ghost" size="sm" className="justify-start h-auto py-2 text-left" onClick={() => handleCopyFrom(r.id)}>
                <div>
                  <span className="text-sm font-medium">{r.name}</span>
                  {r.code && <span className="text-xs text-muted-foreground ml-2 font-mono">{r.code}</span>}
                </div>
              </Button>
            ))}
          </div>
        </div>
      )}

      {showRecentDialog && (
        <div className="p-3 rounded-md border bg-muted/30 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Materiais usados recentemente em outras fichas:</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {recentMaterials.filter(m => !usedProductIds.has(m.product_id)).map(m => {
              const prod = (m as any).products;
              return (
                <label key={m.product_id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm">
                  <input type="checkbox" checked={selectedRecent.has(m.product_id)} onChange={() => toggleRecent(m.product_id)} className="rounded" />
                  <span className="font-medium">{prod?.name ?? '—'}</span>
                  <span className="text-xs text-muted-foreground font-mono">{prod?.sku ?? ''}</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">{prod?.category ?? ''}</Badge>
                </label>
              );
            })}
            {recentMaterials.filter(m => !usedProductIds.has(m.product_id)).length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">Todos os materiais recentes já estão na ficha</p>
            )}
          </div>
          {selectedRecent.size > 0 && (
            <div className="flex justify-end">
              <Button size="sm" className="h-7 text-xs" onClick={handleAddRecent}>
                Adicionar {selectedRecent.size} selecionado(s)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Add material form */}
      {adding && (
        <div className="p-4 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 space-y-3">
          <p className="text-xs font-semibold text-primary">Adicionar Componente à Ficha Técnica</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-3">
              <Label className="text-xs">Material do Estoque</Label>
              <Select value={form.product_id} onValueChange={v => setForm(f => ({ ...f, product_id: v }))}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Selecione o material..." /></SelectTrigger>
                <SelectContent>
                  {COMPONENT_CATEGORIES.map(cat => {
                    const catProducts = availableProducts.filter(p => p.category === cat.key);
                    if (catProducts.length === 0) return null;
                    return (
                      <div key={cat.key}>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">{cat.label}</div>
                        {catProducts.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="flex items-center gap-2">
                              {p.name}
                              <span className="text-muted-foreground font-mono text-xs">({p.sku})</span>
                              <span className="text-muted-foreground text-xs">• {p.unit}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </div>
                    );
                  })}
                  {/* Products without matching category */}
                  {(() => {
                    const catKeys: string[] = COMPONENT_CATEGORIES.map(c => c.key);
                    const uncategorized = availableProducts.filter(p => !catKeys.includes(p.category));
                    if (uncategorized.length === 0) return null;
                    return (
                      <div>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">Outros</div>
                        {uncategorized.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </SelectItem>
                        ))}
                      </div>
                    );
                  })()}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Consumo por Par</Label>
              <Input type="number" min={0} step={0.0001} value={form.quantity_per_unit} onChange={e => setForm(f => ({ ...f, quantity_per_unit: Number(e.target.value) }))} className="mt-1 h-9 text-sm font-mono" placeholder="0,0000" />
            </div>
            <div>
              <Label className="text-xs">Cor do Material</Label>
              <Input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} className="mt-1 h-9 text-sm" placeholder="Ex: Preto" />
            </div>
            <div>
              <Label className="text-xs">Largura/Dimensão</Label>
              <Input value={form.width} onChange={e => setForm(f => ({ ...f, width: e.target.value }))} className="mt-1 h-9 text-sm" placeholder="Ex: 1,40m" />
            </div>
            <div>
              <Label className="text-xs">Peso/Gramatura</Label>
              <Input value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} className="mt-1 h-9 text-sm" placeholder="Ex: 250g/m²" />
            </div>
            <div>
              <Label className="text-xs">Fornecedor</Label>
              <Input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} className="mt-1 h-9 text-sm" placeholder="Ex: Curtume ABC" />
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1 h-9 text-sm" placeholder="Ex: Aplicar ABS no salto" />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <Label className="text-xs font-semibold">Numerações utilizadas</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {MATERIAL_SIZES.map(size => {
                  const sizeStr = String(size);
                  const selectedSizes = form.sizes ? form.sizes.split(',').map(s => s.trim()) : [];
                  const isSelected = selectedSizes.includes(sizeStr);
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        const newSizes = isSelected
                          ? selectedSizes.filter(s => s !== sizeStr)
                          : [...selectedSizes, sizeStr];
                        setForm(f => ({ ...f, sizes: newSizes.filter(Boolean).join(', ') }));
                      }}
                      className={`h-8 w-10 rounded-md text-xs font-mono border transition-colors ${
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      {size}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, sizes: MATERIAL_SIZES.join(', ') }))}
                  className="h-8 px-3 rounded-md text-[10px] border border-dashed border-border hover:border-primary/50 text-muted-foreground"
                >
                  Todos
                </button>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleAdd}>Adicionar Material</Button>
          </div>
        </div>
      )}

      {/* Inner tabs for components/costs/grade */}
      {materials.length > 0 && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="components" className="text-xs gap-1">
              <Layers className="h-3.5 w-3.5" /> Componentes
            </TabsTrigger>
            <TabsTrigger value="costs" className="text-xs gap-1">
              <Package className="h-3.5 w-3.5" /> Custos
            </TabsTrigger>
            <TabsTrigger value="sizes" className="text-xs gap-1">
              <Footprints className="h-3.5 w-3.5" /> Grade
            </TabsTrigger>
          </TabsList>

          {/* TAB: Components by category */}
          <TabsContent value="components" className="space-y-3 mt-3">
            {COMPONENT_CATEGORIES.map(catConfig => {
              const catMaterials = groupedMaterials[catConfig.key];
              if (!catMaterials?.length) return null;
              const CatIcon = catConfig.icon;
              const catCost = categoryCosts.costs[catConfig.key] || 0;

              return (
                <div key={catConfig.key} className="rounded-lg border overflow-hidden">
                  <div className="bg-muted/40 px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CatIcon className={`h-4 w-4 ${catConfig.color}`} />
                      <span className="text-xs font-semibold">{catConfig.label}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{catMaterials.length}</Badge>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{formatCurrency(catCost)}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/10">
                        <TableHead className="text-[11px]">Material</TableHead>
                        <TableHead className="text-[11px]">SKU</TableHead>
                        <TableHead className="text-[11px]">Cor</TableHead>
                        <TableHead className="text-[11px]">Dimensão</TableHead>
                        <TableHead className="text-[11px]">Peso</TableHead>
                        <TableHead className="text-[11px]">Fornecedor</TableHead>
                        <TableHead className="text-[11px] text-right">Consumo/par</TableHead>
                        <TableHead className="text-[11px] text-right">Custo/par</TableHead>
                        <TableHead className="text-[11px] text-right">Estoque</TableHead>
                        <TableHead className="text-[11px] w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catMaterials.map(m => {
                        const prod = (m as any).products;
                        const costPerUnit = Number(m.quantity_per_unit) * Number(prod?.unit_price || 0);
                        const stockQty = Number(prod?.quantity || 0);
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="text-xs font-medium">{prod?.name ?? '—'}</TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{prod?.sku ?? '—'}</TableCell>
                            <TableCell className="text-xs">{m.color || '—'}</TableCell>
                            <TableCell className="text-xs">{m.width || '—'}</TableCell>
                            <TableCell className="text-xs">{m.weight || '—'}</TableCell>
                            <TableCell className="text-xs">{m.supplier || '—'}</TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              {Number(m.quantity_per_unit).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {prod?.unit ?? ''}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono text-muted-foreground">
                              {formatCurrency(costPerUnit)}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              <span className={stockQty <= 0 ? 'text-destructive font-semibold' : ''}>
                                {stockQty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {m.notes && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent><p className="text-xs max-w-[200px]">{m.notes}</p></TooltipContent>
                                  </Tooltip>
                                )}
                                <DeleteConfirmButton onConfirm={() => deleteMaterial.mutate(m.id)} title="Remover material?" size="h-6 w-6" iconSize="h-3 w-3" />
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })}

            {/* Uncategorized materials */}
            {(() => {
              const catKeys: string[] = COMPONENT_CATEGORIES.map(c => c.key);
              const uncatMaterials = materials.filter(m => !catKeys.includes((m as any).products?.category || ''));
              if (!uncatMaterials.length) return null;
              return (
                <div className="rounded-lg border overflow-hidden">
                  <div className="bg-muted/40 px-3 py-2 flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-semibold">Outros</span>
                    <Badge variant="outline" className="text-[10px] font-mono">{uncatMaterials.length}</Badge>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/10">
                        <TableHead className="text-[11px]">Material</TableHead>
                        <TableHead className="text-[11px]">SKU</TableHead>
                        <TableHead className="text-[11px]">Categoria</TableHead>
                        <TableHead className="text-[11px] text-right">Consumo/par</TableHead>
                        <TableHead className="text-[11px] text-right">Custo/par</TableHead>
                        <TableHead className="text-[11px] w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uncatMaterials.map(m => {
                        const prod = (m as any).products;
                        const costPerUnit = Number(m.quantity_per_unit) * Number(prod?.unit_price || 0);
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="text-xs font-medium">{prod?.name ?? '—'}</TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{prod?.sku ?? '—'}</TableCell>
                            <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{prod?.category ?? '—'}</Badge></TableCell>
                            <TableCell className="text-xs text-right font-mono">{Number(m.quantity_per_unit).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {prod?.unit ?? ''}</TableCell>
                            <TableCell className="text-xs text-right font-mono text-muted-foreground">{formatCurrency(costPerUnit)}</TableCell>
                            <TableCell className="text-right">
                              <DeleteConfirmButton onConfirm={() => deleteMaterial.mutate(m.id)} title="Remover material?" size="h-6 w-6" iconSize="h-3 w-3" />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })()}
          </TabsContent>

          {/* TAB: Cost summary */}
          <TabsContent value="costs" className="mt-3">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs">Componente</TableHead>
                    <TableHead className="text-xs text-center">Qtd Materiais</TableHead>
                    <TableHead className="text-xs text-right">Custo Total</TableHead>
                    <TableHead className="text-xs text-right">% do Custo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COMPONENT_CATEGORIES.map(catConfig => {
                    const catMaterials = groupedMaterials[catConfig.key];
                    if (!catMaterials?.length) return null;
                    const catCost = categoryCosts.costs[catConfig.key] || 0;
                    const CatIcon = catConfig.icon;
                    const pct = categoryCosts.total > 0 ? (catCost / categoryCosts.total * 100) : 0;
                    return (
                      <TableRow key={catConfig.key}>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-2">
                            <CatIcon className={`h-4 w-4 ${catConfig.color}`} />
                            <span className="font-medium">{catConfig.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-center font-mono">{catMaterials.length}</TableCell>
                        <TableCell className="text-sm text-right font-mono">{formatCurrency(catCost)}</TableCell>
                        <TableCell className="text-sm text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs font-mono text-muted-foreground w-12 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/20 font-bold">
                    <TableCell className="text-sm">Total por par</TableCell>
                    <TableCell className="text-sm text-center font-mono">{materials.length}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{formatCurrency(categoryCosts.total)}</TableCell>
                    <TableCell className="text-sm text-right font-mono text-muted-foreground">100%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* TAB: Size grid */}
          <TabsContent value="sizes" className="mt-3">
            {(() => {
              const sizeMaterials = materials.filter(m => (m as any).sizes);
              if (sizeMaterials.length === 0) {
                return (
                  <div className="text-center py-8 text-muted-foreground">
                    <Footprints className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nenhum material com numeração definida</p>
                    <p className="text-xs mt-1">Defina as numerações ao adicionar materiais</p>
                  </div>
                );
              }

              const allSizes = new Set<string>();
              sizeMaterials.forEach(m => {
                ((m as any).sizes as string).split(',').map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => allSizes.add(s));
              });
              const sortedSizes = Array.from(allSizes).sort((a, b) => Number(a) - Number(b));

              return (
                <div className="rounded-lg border overflow-hidden">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30">
                          <TableHead className="text-[11px]">Material</TableHead>
                          <TableHead className="text-[11px]">Categoria</TableHead>
                          <TableHead className="text-[11px]">Consumo</TableHead>
                          {sortedSizes.map(size => (
                            <TableHead key={size} className="text-[11px] text-center font-mono w-10">{size}</TableHead>
                          ))}
                          <TableHead className="text-[11px] text-right">Custo/par</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sizeMaterials.map(m => {
                          const prod = (m as any).products;
                          const mSizes = ((m as any).sizes as string).split(',').map((s: string) => s.trim());
                          const costPerUnit = Number(m.quantity_per_unit) * Number(prod?.unit_price || 0);
                          return (
                            <TableRow key={m.id}>
                              <TableCell className="text-xs font-medium">{prod?.name ?? '—'}</TableCell>
                              <TableCell className="text-xs">
                                <Badge variant="outline" className="text-[10px]">{prod?.category ?? '—'}</Badge>
                              </TableCell>
                              <TableCell className="text-xs font-mono">
                                {Number(m.quantity_per_unit).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {prod?.unit ?? ''}
                              </TableCell>
                              {sortedSizes.map(size => (
                                <TableCell key={size} className="text-center">
                                  {mSizes.includes(size) ? (
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-bold">✓</span>
                                  ) : (
                                    <span className="text-muted-foreground/20 text-xs">—</span>
                                  )}
                                </TableCell>
                              ))}
                              <TableCell className="text-xs text-right font-mono text-muted-foreground">{formatCurrency(costPerUnit)}</TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow className="bg-muted/20 font-semibold">
                          <TableCell className="text-xs" colSpan={3}>Materiais por numeração</TableCell>
                          {sortedSizes.map(size => {
                            const count = sizeMaterials.filter(m => ((m as any).sizes as string).split(',').map((s: string) => s.trim()).includes(size)).length;
                            return (
                              <TableCell key={size} className="text-center text-xs font-mono">{count}</TableCell>
                            );
                          })}
                          <TableCell className="text-xs text-right font-mono">
                            {formatCurrency(sizeMaterials.reduce((sum, m) => sum + Number(m.quantity_per_unit) * Number((m as any).products?.unit_price || 0), 0))}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>
      )}

      {materials.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Nenhum material na ficha técnica</p>
          <p className="text-xs mt-1">Adicione materiais usando o botão acima</p>
        </div>
      )}
        </TabsContent>

        {/* ========== TAB: CORES LIBERADAS ========== */}
        <TabsContent value="cores" className="mt-3">
          <ColorsWithRecolor
            materialColors={materialColors}
            colorsByCategory={colorsByCategory}
            imageUrl={imageUrl}
            referenceCode={references.find(r => r.id === referenceId)?.code || ''}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ColorsWithRecolor({
  materialColors,
  colorsByCategory,
  imageUrl,
  referenceCode,
}: {
  materialColors: string[];
  colorsByCategory: Record<string, Record<string, string[]>>;
  imageUrl?: string;
  referenceCode: string;
}) {
  const [recoloredImages, setRecoloredImages] = useState<Record<string, string>>({});
  const [loadingColor, setLoadingColor] = useState<string | null>(null);

  const handleRecolor = useCallback(async (color: string) => {
    if (!imageUrl) {
      toast.error('Esta referência não possui foto cadastrada.');
      return;
    }
    setLoadingColor(color);
    try {
      const { data, error } = await supabase.functions.invoke('recolor-image', {
        body: { imageUrl, targetColor: color, referenceCode },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) {
        setRecoloredImages(prev => ({ ...prev, [color]: data.url }));
        toast.success(`Imagem gerada para cor "${color}"!`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar imagem');
    } finally {
      setLoadingColor(null);
    }
  }, [imageUrl, referenceCode]);

  if (materialColors.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <Droplets className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Nenhuma cor cadastrada nos materiais</p>
        <p className="text-xs mt-1">As cores aparecem aqui quando definidas nos materiais da Ficha Técnica</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Cores disponíveis para este modelo, derivadas dos materiais cadastrados na ficha técnica.
        </p>
        {imageUrl && (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Wand2 className="h-3 w-3" /> IA pode recolorir a foto
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {materialColors.map(color => {
          const catMap = colorsByCategory[color] || {};
          const totalMaterials = Object.values(catMap).reduce((sum, arr) => sum + arr.length, 0);
          const recoloredUrl = recoloredImages[color];
          const isLoading = loadingColor === color;

          return (
            <div key={color} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full border bg-muted" />
                  <span className="text-sm font-semibold">{color}</span>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono">{totalMaterials} material(is)</Badge>
              </div>

              {/* Image preview (original or recolored) */}
              {(recoloredUrl || imageUrl) && (
                <div className="relative rounded-md overflow-hidden border bg-muted/30 aspect-[4/3]">
                  <img
                    src={recoloredUrl || imageUrl}
                    alt={`${color}`}
                    className="w-full h-full object-cover"
                  />
                  {recoloredUrl && (
                    <Badge className="absolute top-1.5 left-1.5 text-[9px] gap-1 bg-primary/90">
                      <Wand2 className="h-2.5 w-2.5" /> IA
                    </Badge>
                  )}
                </div>
              )}

              <div className="space-y-1">
                {Object.entries(catMap).map(([cat, prods]) => {
                  const catConfig = COMPONENT_CATEGORIES.find(c => c.key === cat);
                  return (
                    <div key={cat} className="flex items-start gap-1.5 text-xs">
                      <Badge variant="secondary" className="text-[10px] shrink-0">{catConfig?.label || cat}</Badge>
                      <span className="text-muted-foreground">{prods.join(', ')}</span>
                    </div>
                  );
                })}
              </div>

              {/* Recolor button */}
              {imageUrl && !recoloredUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 h-7 text-xs"
                  disabled={isLoading}
                  onClick={() => handleRecolor(color)}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Gerando imagem...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-3 w-3" />
                      Gerar foto na cor "{color}"
                    </>
                  )}
                </Button>
              )}
              {recoloredUrl && (
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 h-7 text-xs"
                    onClick={() => handleRecolor(color)}
                    disabled={isLoading}
                  >
                    {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    Regerar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    asChild
                  >
                    <a href={recoloredUrl} target="_blank" rel="noopener noreferrer">
                      <Download className="h-3 w-3" /> Abrir
                    </a>
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LinkedSheetView({ sheetId }: { sheetId: string }) {
  const { data: materials = [], isLoading } = useSheetMaterials(sheetId);
  const { data: sheets = [] } = useTechnicalSheets();

  const sheet = sheets.find(s => s.id === sheetId);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;

  const materialColors = [...new Set(
    materials.flatMap(m => m.color ? m.color.split(',').map(c => c.trim()).filter(Boolean) : [])
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Ficha Técnica: {sheet?.name || '—'}</span>
        <Badge variant="outline" className="font-mono text-[10px]">{materials.length} materiais</Badge>
        {materialColors.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">{materialColors.length} cor(es)</Badge>
        )}
      </div>

      {materials.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead className="text-[11px]">Material</TableHead>
              <TableHead className="text-[11px]">Categoria</TableHead>
              <TableHead className="text-[11px]">Cor</TableHead>
              <TableHead className="text-[11px]">Fornecedor</TableHead>
              <TableHead className="text-[11px] text-right">Consumo/par</TableHead>
              <TableHead className="text-[11px] text-right">Custo/par</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {materials.map(m => {
              const prod = (m as any).products;
              const costPerUnit = Number(m.quantity_per_unit) * Number(prod?.unit_price || 0);
              return (
                <TableRow key={m.id}>
                  <TableCell className="text-xs font-medium">{prod?.name ?? '—'}</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{prod?.category ?? '—'}</Badge></TableCell>
                  <TableCell className="text-xs">{m.color || '—'}</TableCell>
                  <TableCell className="text-xs">{m.supplier || '—'}</TableCell>
                  <TableCell className="text-xs text-right font-mono">
                    {Number(m.quantity_per_unit).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {prod?.unit ?? ''}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono text-muted-foreground">{formatCurrency(costPerUnit)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">Ficha técnica sem materiais cadastrados</p>
      )}

      {materialColors.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground">Cores disponíveis:</span>
          {materialColors.map(c => (
            <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}
