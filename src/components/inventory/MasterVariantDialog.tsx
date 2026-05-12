import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

 import { Plus, Pencil, Save, Loader2, X, Image as ImageIcon, Package, Layers, Settings as SettingsIcon, ArrowRightLeft } from 'lucide-react';
import { Product, ProductFormData, CATEGORIES, UNITS, LOCATIONS } from '@/types/inventory';
import { useAddProduct } from '@/hooks/useProducts';
import { useGroups } from '@/hooks/useGroups';
import { useSuppliers } from '@/hooks/useSuppliers';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { toast } from 'sonner';
import { SoleSizeConjugationsEditor } from './SoleSizeConjugationsEditor';

const ALL_SIZES = Array.from({ length: 22 }, (_, i) => 20 + i); // 20–41
const CALC_METHODS: Array<'weight' | 'meter' | 'unit'> = ['weight', 'meter', 'unit'];

/* ── Size range editor for a single sole variant ── */
function VariantSizeRangeEditor({ product, onChange }: {
  product: Product;
  onChange: (id: string, sizeFrom: number | null, sizeTo: number | null) => void;
}) {
  const existing = product.stock_grade as Record<string, any> | null;
  const [sizeFrom, setSizeFrom] = useState<number | null>(null);
  const [sizeTo, setSizeTo] = useState<number | null>(null);

  useEffect(() => {
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      const fromVal = existing._size_from != null ? Number(existing._size_from) : null;
      const toVal = existing._size_to != null ? Number(existing._size_to) : null;
      if (fromVal != null && toVal != null) { setSizeFrom(fromVal); setSizeTo(toVal); return; }
      const keys = Object.keys(existing).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
      if (keys.length > 0) { setSizeFrom(keys[0]); setSizeTo(keys[keys.length - 1]); }
    }
  }, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onChange(product.id, sizeFrom, sizeTo);
  }, [sizeFrom, sizeTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const rangeLabel = sizeFrom != null && sizeTo != null && sizeTo >= sizeFrom
    ? `${sizeTo - sizeFrom + 1} tamanhos` : '—';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">De (número inicial)</Label>
          <Select value={sizeFrom != null ? String(sizeFrom) : ''} onValueChange={v => setSizeFrom(Number(v))}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{ALL_SIZES.map(s => (<SelectItem key={s} value={String(s)}>{s}</SelectItem>))}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Até (número final)</Label>
          <Select value={sizeTo != null ? String(sizeTo) : ''} onValueChange={v => setSizeTo(Number(v))}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{ALL_SIZES.filter(s => sizeFrom == null || s >= sizeFrom).map(s => (<SelectItem key={s} value={String(s)}>{s}</SelectItem>))}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between p-2 rounded-lg border bg-muted/30">
        <p className="text-sm">Faixa: <strong className="font-mono">{sizeFrom ?? '?'} — {sizeTo ?? '?'}</strong></p>
        <Badge variant="secondary" className="text-xs">{rangeLabel}</Badge>
      </div>
    </div>
  );
}

/* ── Sheet lateral: edição COMPLETA de uma única variante ── */
type VariantEditableFields = Pick<Product,
  'color' | 'sku' | 'image_url' | 'active' | 'location' | 'supplier_id' |
  'quantity' | 'min_stock' | 'max_stock' | 'safety_stock' | 'reserved_stock' |
  'unit_price' | 'price_wholesale' | 'price_retail' | 'unit' |
  'lead_time_days' | 'min_order_quantity'
>;

function VariantDetailSheet({ open, onOpenChange, product, otherVariants }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: Product | null;
  otherVariants: Product[];
}) {
  const queryClient = useQueryClient();
  const { data: suppliers = [] } = useSuppliers();
  const [form, setForm] = useState<Partial<VariantEditableFields>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!product) { setForm({}); return; }
    setForm({
      color: product.color || '',
      sku: product.sku || '',
      image_url: product.image_url || '',
      active: product.active,
      location: product.location || '',
      supplier_id: product.supplier_id || null,
      quantity: Number(product.quantity) || 0,
      min_stock: Number(product.min_stock) || 0,
      max_stock: Number(product.max_stock) || 0,
      safety_stock: Number(product.safety_stock) || 0,
      reserved_stock: Number(product.reserved_stock) || 0,
      unit_price: Number(product.unit_price) || 0,
      price_wholesale: Number(product.price_wholesale) || 0,
      price_retail: Number(product.price_retail) || 0,
      unit: product.unit || 'un',
      lead_time_days: Number(product.lead_time_days) || 0,
      min_order_quantity: Number(product.min_order_quantity) || 0,
    });
  }, [product]);

  const update = <K extends keyof VariantEditableFields>(k: K, v: VariantEditableFields[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  if (!product) return null;

  const handleSave = async () => {
    const newColor = (form.color ?? '').toString().trim();
    if (!newColor) { toast.error('Cor é obrigatória'); return; }
    if (!(form.sku ?? '').toString().trim()) { toast.error('SKU é obrigatório'); return; }
    const dup = otherVariants.some(o =>
      (o.color || '').toLowerCase().trim() === newColor.toLowerCase()
    );
    if (dup) { toast.error('Já existe outra variante com esta cor'); return; }

    setSaving(true);
    try {
      const updates: any = { ...form };
      // Sync product name with the new color (keep the part before " - ")
      const fullName = product.name || '';
      const dashIdx = fullName.lastIndexOf(' - ');
      const baseName = dashIdx > 0 ? fullName.slice(0, dashIdx) : fullName;
      updates.name = `${baseName} - ${newColor}`;

      const { error } = await supabase.from('products').update(updates).eq('id', product.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['technical_sheets'] });
      queryClient.invalidateQueries({ queryKey: ['order-consumption'] });
      queryClient.invalidateQueries({ queryKey: ['sole_standard_items'] });
      toast.success('Variante atualizada');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Editar variante completa
          </SheetTitle>
          <SheetDescription>Edição detalhada de todos os campos desta variante de cor.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Identificação */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Identificação</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Cor *</Label>
                <Input value={form.color ?? ''} onChange={e => update('color', e.target.value)} className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs">SKU *</Label>
                <Input value={form.sku ?? ''} onChange={e => update('sku', e.target.value)} className="mt-1 h-9 font-mono" />
              </div>
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1"><ImageIcon className="h-3 w-3" /> URL da imagem</Label>
              <Input value={form.image_url ?? ''} onChange={e => update('image_url', e.target.value)} className="mt-1 h-9" placeholder="https://…" />
              {form.image_url && (
                <img
                  src={form.image_url}
                  alt={form.color ?? ''}
                  className="mt-2 h-20 w-20 rounded border object-cover"
                  onError={(e) => ((e.currentTarget.style.display = 'none'))}
                />
              )}
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label className="text-xs font-medium">Ativa</Label>
                <p className="text-[11px] text-muted-foreground">Variantes inativas não aparecem em pedidos.</p>
              </div>
              <Switch checked={!!form.active} onCheckedChange={v => update('active', v)} />
            </div>
          </section>

          {/* Estoque */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Estoque</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Quantidade atual</Label>
                <Input type="number" min={0} value={form.quantity ?? 0} onChange={e => update('quantity', Number(e.target.value))} className="mt-1 h-9 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Unidade</Label>
                <Select value={form.unit ?? 'un'} onValueChange={v => update('unit', v)}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Estoque mínimo</Label>
                <Input type="number" min={0} value={form.min_stock ?? 0} onChange={e => update('min_stock', Number(e.target.value))} className="mt-1 h-9 font-mono" />
              </div>
              {/* Removidos em 2026-05 a pedido do usuário:
                  - "Estoque máximo": nunca usado em business logic
                  - "Estoque de segurança": duplicava conceitualmente o mínimo */}
              <div>
                <Label className="text-xs">Reservado</Label>
                <Input type="number" min={0} value={form.reserved_stock ?? 0} onChange={e => update('reserved_stock', Number(e.target.value))} className="mt-1 h-9 font-mono" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Localização física</Label>
              <Select value={form.location ?? ''} onValueChange={v => update('location', v)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </section>

          {/* Preços e compras */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Preços & Compras</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Custo unitário (R$)</Label>
                <Input type="number" step="0.0001" min={0} value={form.unit_price ?? 0} onChange={e => update('unit_price', Number(e.target.value))} className="mt-1 h-9 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Preço atacado (R$)</Label>
                <Input type="number" step="0.01" min={0} value={form.price_wholesale ?? 0} onChange={e => update('price_wholesale', Number(e.target.value))} className="mt-1 h-9 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Preço varejo (R$)</Label>
                <Input type="number" step="0.01" min={0} value={form.price_retail ?? 0} onChange={e => update('price_retail', Number(e.target.value))} className="mt-1 h-9 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Lead time (dias)</Label>
                <Input type="number" min={0} value={form.lead_time_days ?? 0} onChange={e => update('lead_time_days', Number(e.target.value))} className="mt-1 h-9 font-mono" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Quantidade mínima de compra</Label>
                <Input type="number" min={0} value={form.min_order_quantity ?? 0} onChange={e => update('min_order_quantity', Number(e.target.value))} className="mt-1 h-9 font-mono" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Fornecedor</Label>
              <Select value={form.supplier_id ?? '__none__'} onValueChange={v => update('supplier_id', v === '__none__' ? null : v)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Sem fornecedor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Sem fornecedor —</SelectItem>
                  {suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </section>
        </div>

        <SheetFooter className="mt-6 gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar variante
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

interface MasterVariantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseName: string;
  variants: Product[];
  onEditVariant: (product: Product) => void;
  onDeleteVariant: (id: string) => void;
}

export function MasterVariantDialog({
  open,
  onOpenChange,
  baseName,
  variants,
  onEditVariant: _onEditVariant, // legacy escape-hatch (full ProductFormDialog)
  onDeleteVariant,
}: MasterVariantDialogProps) {
  const [activeTab, setActiveTab] = useState<'variants' | 'group' | 'add'>('variants');

  // ── add new variant
  const [newColor, setNewColor] = useState('');
  const [newSku, setNewSku] = useState('');
  const [adding, setAdding] = useState(false);

  // ── grade (solado)
  const [savingGrade, setSavingGrade] = useState(false);
  const [activeGradeTab, setActiveGradeTab] = useState('');
  const [rangeChanges, setRangeChanges] = useState<Record<string, { sizeFrom: number | null; sizeTo: number | null }>>({});

  // ── inline color edit (kept as quick action)
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [editingColorValue, setEditingColorValue] = useState('');
  const [savingColorId, setSavingColorId] = useState<string | null>(null);

  // ── side sheet for full variant edit
  const [detailVariant, setDetailVariant] = useState<Product | null>(null);

  // ── shared-group editing
  const { data: groups = [] } = useGroups();
  const { data: suppliers = [] } = useSuppliers();

  const addProduct = useAddProduct();
  const queryClient = useQueryClient();

  const isSolado = useMemo(() => variants.some(v => v.category === 'Solado'), [variants]);
  const template = variants[0];

  // Group form state — initialised from the first variant; saving propagates to all.
  type GroupForm = {
    baseName: string;
    technical_name: string;
    category: string;
    group_id: string | null;
    supplier_id: string | null;
    dimensions_length: number;
    dimensions_width: number;
    dimensions_height: number;
    dimensions_thickness: number;
    dimensions_unit: string;
    yield_per_meter: number;
    yield_unit: string;
    purchase_unit: string;
    production_unit: string;
    conversion_rate: number;
     purchase_order_unit: string;
     calculation_method: 'weight' | 'meter' | 'unit';
     lead_time_days: number;
     unit_price: number;
     price_wholesale: number;
     price_retail: number;
     min_stock: number;
     max_stock: number;
     safety_stock: number;
     location: string;
     active: boolean;
     min_order_quantity: number;
   };
  const [groupForm, setGroupForm] = useState<GroupForm | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);

  useEffect(() => {
    if (open && variants.length > 0) {
      setActiveGradeTab(variants[0].id);
      setRangeChanges({});
      setActiveTab('variants');
      const t = variants[0];
      setGroupForm({
        baseName,
        technical_name: t.technical_name || '',
        category: t.category || '',
        group_id: t.group_id || null,
        supplier_id: t.supplier_id || null,
        dimensions_length: Number(t.dimensions_length) || 0,
        dimensions_width: Number(t.dimensions_width) || 0,
        dimensions_height: Number(t.dimensions_height) || 0,
        dimensions_thickness: Number(t.dimensions_thickness) || 0,
        dimensions_unit: t.dimensions_unit || 'mm',
        yield_per_meter: Number(t.yield_per_meter) || 0,
        yield_unit: t.yield_unit || 'dm²',
        purchase_unit: t.purchase_unit || 'un',
        production_unit: t.production_unit || 'un',
        conversion_rate: Number(t.conversion_rate) || 1,
         purchase_order_unit: t.purchase_order_unit || 'un',
         calculation_method: ((t.calculation_method as any) || 'weight') as 'weight' | 'meter' | 'unit',
         lead_time_days: Number(t.lead_time_days) || 0,
         unit_price: Number(t.unit_price) || 0,
         price_wholesale: Number(t.price_wholesale) || 0,
         price_retail: Number(t.price_retail) || 0,
         min_stock: Number(t.min_stock) || 0,
         max_stock: Number(t.max_stock) || 0,
         safety_stock: Number(t.safety_stock) || 0,
         location: t.location || '',
         active: t.active ?? true,
         min_order_quantity: Number(t.min_order_quantity) || 0,
       });
    }
  }, [open, variants, baseName]);

  const updateGroup = <K extends keyof GroupForm>(k: K, v: GroupForm[K]) =>
    setGroupForm(prev => (prev ? { ...prev, [k]: v } : prev));

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);

  const handleAddVariant = async () => {
    if (!newColor.trim()) { toast.error('Informe a cor da variante'); return; }
    if (!newSku.trim()) { toast.error('Informe o SKU da variante'); return; }
    const exists = variants.some(v => (v.color || '').toLowerCase().trim() === newColor.toLowerCase().trim());
    if (exists) { toast.error('Já existe uma variante com esta cor'); return; }

    const newProduct: ProductFormData = {
      name: `${groupForm?.baseName ?? baseName} - ${newColor.trim()}`,
      technical_name: template.technical_name || '',
      sku: newSku.trim(),
      category: template.category || '',
      color: newColor.trim(),
      quantity: 0,
      min_stock: template.min_stock ?? 0,
      max_stock: template.max_stock ?? 0,
      unit: template.unit || 'un',
      unit_price: template.unit_price ?? 0,
      location: template.location || '',
      group_id: template.group_id || null,
      active: true,
      image_url: '',
      yield_per_meter: template.yield_per_meter ?? null,
      yield_unit: template.yield_unit || 'dm²',
      dimensions_length: template.dimensions_length ?? 0,
      dimensions_width: template.dimensions_width ?? 0,
      dimensions_height: template.dimensions_height ?? 0,
      dimensions_thickness: template.dimensions_thickness ?? 0,
      dimensions_unit: template.dimensions_unit || 'mm',
      purchase_unit: template.purchase_unit || 'un',
      production_unit: template.production_unit || 'un',
      conversion_rate: template.conversion_rate ?? 1,
      purchase_order_unit: template.purchase_order_unit || 'un',
      min_order_quantity: template.min_order_quantity ?? 1,
      safety_stock: template.safety_stock ?? 0,
      lead_time_days: template.lead_time_days ?? 7,
      calculation_method: (template.calculation_method as 'weight' | 'meter' | 'unit') || 'weight',
    };

    setAdding(true);
    try {
      await addProduct.mutateAsync(newProduct);
      setNewColor('');
      setNewSku('');
      setActiveTab('variants');
    } finally {
      setAdding(false);
    }
  };

  const handleSaveGroupForm = async () => {
    if (!groupForm) return;
    const newBase = groupForm.baseName.trim();
    if (!newBase) { toast.error('Nome do modelo não pode ser vazio'); return; }

    // ─── Validações de consistência ───────────────────────────────────
    if (!groupForm.category || !groupForm.category.trim()) {
      toast.error('Categoria é obrigatória'); return;
    }
    if ((groupForm.conversion_rate ?? 0) <= 0) {
      toast.error('Taxa de conversão deve ser maior que 0 — caso contrário o cálculo de consumo quebra');
      return;
    }
    if (groupForm.lead_time_days < 0) {
      toast.error('Lead time não pode ser negativo'); return;
    }
    // Cores únicas entre variantes (case-insensitive). Se houver duplicata o
    // rename "<base> - <cor>" geraria nomes idênticos no banco.
    const colorMap = new Map<string, number>();
    for (const v of variants) {
      const k = (v.color || '').toLowerCase().trim();
      colorMap.set(k, (colorMap.get(k) || 0) + 1);
    }
    const dupColor = [...colorMap.entries()].find(([, c]) => c > 1);
    if (dupColor) {
      toast.error(`Existem variantes com a mesma cor ("${dupColor[0] || '(vazio)'}"). Corrija antes de aplicar mudanças no grupo.`);
      return;
    }
    // Confirmação para mudança crítica de unidade
    const tpl = variants[0];
    const unitChanged =
      groupForm.purchase_unit !== (tpl.purchase_unit || 'un') ||
      groupForm.production_unit !== (tpl.production_unit || 'un');
    if (unitChanged) {
      const ok = window.confirm(
        'Você alterou a unidade de compra ou de produção. Isso afeta o cálculo de consumo de TODAS as referências que usam estas variantes. Deseja continuar?'
      );
      if (!ok) return;
    }

    setSavingGroup(true);
    try {
      // Apply shared fields to every variant; rename keeps " - cor".
      for (const v of variants) {
        const newFullName = v.color ? `${newBase} - ${v.color}` : newBase;
        const payload: any = {
          name: newFullName,
          technical_name: groupForm.technical_name || null,
          category: groupForm.category || v.category,
          group_id: groupForm.group_id,
          supplier_id: groupForm.supplier_id,
          dimensions_length: groupForm.dimensions_length,
          dimensions_width: groupForm.dimensions_width,
          dimensions_height: groupForm.dimensions_height,
          dimensions_thickness: groupForm.dimensions_thickness,
          dimensions_unit: groupForm.dimensions_unit,
          yield_per_meter: groupForm.yield_per_meter || null,
          yield_unit: groupForm.yield_unit,
          purchase_unit: groupForm.purchase_unit,
          production_unit: groupForm.production_unit,
          conversion_rate: groupForm.conversion_rate || 1,
           purchase_order_unit: groupForm.purchase_order_unit,
           calculation_method: groupForm.calculation_method,
           lead_time_days: groupForm.lead_time_days,
           unit_price: groupForm.unit_price,
           price_wholesale: groupForm.price_wholesale,
           price_retail: groupForm.price_retail,
           min_stock: groupForm.min_stock,
           max_stock: groupForm.max_stock,
           safety_stock: groupForm.safety_stock,
           location: groupForm.location,
           active: groupForm.active,
           min_order_quantity: groupForm.min_order_quantity,
         };
        const { error } = await supabase.from('products').update(payload).eq('id', v.id);
        if (error) throw new Error(`Variante "${v.color || v.sku}": ${error.message}`);
      }
      queryClient.invalidateQueries({ queryKey: ['products'] });
      // Invalida caches dependentes — fichas técnicas, BOM, consumo
      queryClient.invalidateQueries({ queryKey: ['technical_sheets'] });
      queryClient.invalidateQueries({ queryKey: ['order-consumption'] });
      queryClient.invalidateQueries({ queryKey: ['sole_standard_items'] });
      toast.success('Dados do grupo aplicados a todas as variantes');
    } catch (err: any) {
      toast.error(`Erro ao salvar grupo: ${err.message}`);
    } finally {
      setSavingGroup(false);
    }
  };

  const handleSaveRanges = async () => {
    const updates = Object.entries(rangeChanges).filter(([, r]) => r.sizeFrom != null && r.sizeTo != null);
    if (updates.length === 0) { toast.info('Nenhuma alteração'); return; }
    setSavingGrade(true);
    try {
      for (const [productId, { sizeFrom, sizeTo }] of updates) {
        const variant = variants.find(v => v.id === productId);
        const existingGrade = (variant?.stock_grade as Record<string, any>) || {};
        const gradeObj = {
          ...existingGrade,
          _size_from: sizeFrom,
          _size_to: sizeTo
        };
        
        const { error } = await supabase.from('products').update({ 
          stock_grade: gradeObj as any 
        }).eq('id', productId);
        
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`Faixa atualizada para ${updates.length} variante(s)!`);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSavingGrade(false);
    }
  };

  const startEditColor = (v: Product) => { setEditingColorId(v.id); setEditingColorValue(v.color || ''); };
  const cancelEditColor = () => { setEditingColorId(null); setEditingColorValue(''); };
  const saveColor = async (v: Product) => {
    const newVal = editingColorValue.trim();
    if (!newVal) { toast.error('Informe a cor'); return; }
    if (newVal.toLowerCase() === (v.color || '').toLowerCase()) { cancelEditColor(); return; }
    const duplicate = variants.some(x => x.id !== v.id && (x.color || '').toLowerCase().trim() === newVal.toLowerCase());
    if (duplicate) { toast.error('Já existe uma variante com esta cor'); return; }
    setSavingColorId(v.id);
    try {
      // Also rename the product so the suffix stays in sync
      const fullName = v.name || '';
      const dashIdx = fullName.lastIndexOf(' - ');
      const baseN = dashIdx > 0 ? fullName.slice(0, dashIdx) : fullName;
      const { error } = await supabase.from('products')
        .update({ color: newVal, name: `${baseN} - ${newVal}` })
        .eq('id', v.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Cor atualizada');
      cancelEditColor();
    } catch (err: any) {
      toast.error(`Erro ao salvar cor: ${err.message}`);
    } finally {
      setSavingColorId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              {baseName}
              <Badge variant="outline" className="font-normal text-xs">
                {variants.length} variante{variants.length === 1 ? '' : 's'}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              Edite cores individuais, ajuste dados compartilhados do grupo ou adicione novas variantes.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="mt-2">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="variants" className="gap-1.5"><Layers className="h-3.5 w-3.5" /> Variantes</TabsTrigger>
              <TabsTrigger value="group" className="gap-1.5"><SettingsIcon className="h-3.5 w-3.5" /> Dados do Grupo</TabsTrigger>
              <TabsTrigger value="add" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Adicionar</TabsTrigger>
            </TabsList>

            {/* ─── ABA: Variantes ─── */}
            <TabsContent value="variants" className="space-y-4 mt-4">
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Cor</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                      <TableHead className="text-right">Custo Unit.</TableHead>
                      <TableHead className="text-right w-32">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variants.map(v => (
                      <TableRow key={v.id}>
                        <TableCell>
                          {v.image_url ? (
                            <img src={v.image_url} alt={v.color || ''} className="h-8 w-8 rounded object-cover border" onError={(e) => ((e.currentTarget.style.display = 'none'))} />
                          ) : (
                            <div className="h-8 w-8 rounded bg-muted/50 border flex items-center justify-center">
                              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingColorId === v.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                autoFocus
                                value={editingColorValue}
                                onChange={(e) => setEditingColorValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveColor(v); if (e.key === 'Escape') cancelEditColor(); }}
                                className="h-7 w-32 text-xs"
                                placeholder="Cor"
                              />
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveColor(v)} disabled={savingColorId === v.id}>
                                {savingColorId === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEditColor} disabled={savingColorId === v.id}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => startEditColor(v)} className="inline-flex items-center gap-1 group" title="Clique para editar a cor">
                              <Badge variant="secondary">{v.color || '—'}</Badge>
                              <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60" />
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{v.sku}</TableCell>
                        <TableCell className="text-center">
                          {v.active ? (
                            <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20 border-green-500/30">Ativa</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">Inativa</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">{(Number(v.quantity) || 0).toLocaleString('pt-BR')} {v.unit}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(Number(v.unit_price) || 0)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setDetailVariant(v)}>
                              <Pencil className="h-3 w-3" /> Editar completo
                            </Button>
                            <DeleteConfirmButton onConfirm={() => onDeleteVariant(v.id)} title="Excluir variante?" size="h-7 w-7" iconSize="h-3.5 w-3.5" />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Faixa de numeração — só para Solado */}
              {isSolado && variants.length > 0 && (
                <div className="border rounded-lg p-4 space-y-3 bg-muted/10">
                  <p className="text-sm font-semibold">Faixa de Numeração por Variante</p>
                  <Tabs value={activeGradeTab} onValueChange={setActiveGradeTab}>
                    <TabsList className="w-full flex flex-wrap h-auto gap-1 p-1">
                      {variants.map(v => {
                        const existing = v.stock_grade as Record<string, any> | null;
                        const from = rangeChanges[v.id]?.sizeFrom ?? (existing?._size_from ?? null);
                        const to = rangeChanges[v.id]?.sizeTo ?? (existing?._size_to ?? null);
                        const label = from != null && to != null ? `${from}–${to}` : '—';
                        return (
                          <TabsTrigger key={v.id} value={v.id} className="flex-1 min-w-[90px] gap-1 text-xs py-1.5">
                            <span className="truncate">{v.color || 'Sem cor'}</span>
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">{label}</Badge>
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                    {variants.map(v => (
                      <TabsContent key={v.id} value={v.id} className="mt-3">
                        <VariantSizeRangeEditor product={v} onChange={(id, sizeFrom, sizeTo) =>
                          setRangeChanges(prev => ({ ...prev, [id]: { sizeFrom, sizeTo } }))} />
                      </TabsContent>
                    ))}
                  </Tabs>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={handleSaveRanges} disabled={savingGrade}>
                      {savingGrade ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                      Salvar Faixa
                    </Button>
                  </div>

                  {/* ── Numerações conjugadas (compartilhadas pelo grupo) ── */}
                  {(() => {
                    const activeVariant = variants.find(v => v.id === activeGradeTab) || variants[0];
                    const existing = activeVariant?.stock_grade as Record<string, any> | null;
                    const sizeFrom = rangeChanges[activeVariant?.id]?.sizeFrom
                      ?? (existing?._size_from != null ? Number(existing._size_from) : null);
                    const sizeTo = rangeChanges[activeVariant?.id]?.sizeTo
                      ?? (existing?._size_to != null ? Number(existing._size_to) : null);
                    return (
                      <div className="pt-3 border-t">
                        <SoleSizeConjugationsEditor
                          soleGroupId={activeVariant?.group_id ?? null}
                          sizeFrom={sizeFrom}
                          sizeTo={sizeTo}
                        />
                      </div>
                    );
                  })()}
                </div>
              )}
            </TabsContent>

            {/* ─── ABA: Dados do Grupo ─── */}
            {/* Audit visual #36: ScrollArea com flex-1 + max-h-[60vh] estava
                cortando inputs (Estoque Mínimo/Máximo/Segurança) quando o
                Dialog não tinha altura suficiente pra resolver o flex.
                Trocado por overflow-y-auto direto no wrapper, ancorado em
                max-h calculado pelo viewport menos o header e footer fixos. */}
            <TabsContent value="group" className="mt-4 flex flex-col min-h-0">
              {!groupForm ? (
                <div className="text-sm text-muted-foreground p-6 text-center">Carregando…</div>
              ) : (
                <div className="flex flex-col space-y-4">
                  <div className="overflow-y-auto pr-2 sm:pr-4 max-h-[calc(92vh-260px)]">
                    <div className="space-y-6 pb-32 sm:pb-8">
                      <div className="rounded-md border-l-4 border-l-primary bg-primary/5 p-3 text-xs text-muted-foreground">
                        Os campos abaixo são <strong>compartilhados por todas as variantes</strong>. Salvar aqui aplica
                        em <strong>{variants.length} variante{variants.length === 1 ? '' : 's'}</strong> de uma vez.
                      </div>

                      <section className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide flex items-center gap-2">
                          <Package className="h-3 w-3" /> Identificação
                        </h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Nome do modelo *</Label>
                            <Input value={groupForm.baseName} onChange={e => updateGroup('baseName', e.target.value)} className="mt-1 h-9" />
                          </div>
                          <div>
                            <Label className="text-xs">Nome técnico</Label>
                            <Input value={groupForm.technical_name} onChange={e => updateGroup('technical_name', e.target.value)} className="mt-1 h-9" />
                          </div>
                          <div>
                            <Label className="text-xs">Categoria</Label>
                            <Select value={groupForm.category} onValueChange={v => updateGroup('category', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Grupo de produtos</Label>
                            <Select value={groupForm.group_id ?? '__none__'} onValueChange={v => updateGroup('group_id', v === '__none__' ? null : v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Sem grupo" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— Sem grupo —</SelectItem>
                                {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Fornecedor padrão</Label>
                            <Select value={groupForm.supplier_id ?? '__none__'} onValueChange={v => updateGroup('supplier_id', v === '__none__' ? null : v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Sem fornecedor" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— Sem fornecedor —</SelectItem>
                                {suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </section>

                      <section className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Preços Base</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label className="text-xs">Custo unitário (R$)</Label>
                            <Input type="number" step="0.0001" value={groupForm.unit_price} onChange={e => updateGroup('unit_price', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div>
                            <Label className="text-xs">Atacado (R$)</Label>
                            <Input type="number" step="0.01" value={groupForm.price_wholesale} onChange={e => updateGroup('price_wholesale', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div>
                            <Label className="text-xs">Varejo (R$)</Label>
                            <Input type="number" step="0.01" value={groupForm.price_retail} onChange={e => updateGroup('price_retail', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                        </div>
                      </section>

                      <section className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Estoque & Localização</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label className="text-xs">Estoque Mínimo</Label>
                            <Input type="number" value={groupForm.min_stock} onChange={e => updateGroup('min_stock', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div>
                            <Label className="text-xs">Estoque Máximo</Label>
                            <Input type="number" value={groupForm.max_stock} onChange={e => updateGroup('max_stock', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div>
                            <Label className="text-xs">Segurança</Label>
                            <Input type="number" value={groupForm.safety_stock} onChange={e => updateGroup('safety_stock', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div className="col-span-3">
                            <Label className="text-xs">Localização física</Label>
                            <Select value={groupForm.location} onValueChange={v => updateGroup('location', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Selecione localização" /></SelectTrigger>
                              <SelectContent>{LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </div>
                      </section>

                      <section className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide flex items-center gap-2">
                          <Layers className="h-3 w-3" /> Dimensões
                        </h4>
                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <Label className="text-xs">Comprimento</Label>
                            <Input type="number" value={groupForm.dimensions_length} onChange={e => updateGroup('dimensions_length', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div>
                            <Label className="text-xs">Largura</Label>
                            <Input type="number" value={groupForm.dimensions_width} onChange={e => updateGroup('dimensions_width', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div>
                            <Label className="text-xs">Altura</Label>
                            <Input type="number" value={groupForm.dimensions_height} onChange={e => updateGroup('dimensions_height', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div>
                            <Label className="text-xs">Espessura</Label>
                            <Input type="number" value={groupForm.dimensions_thickness} onChange={e => updateGroup('dimensions_thickness', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div className="col-span-4">
                            <Label className="text-xs">Unidade dimensional</Label>
                            <Select value={groupForm.dimensions_unit} onValueChange={v => updateGroup('dimensions_unit', v)}>
                              <SelectTrigger className="mt-1 h-9 max-w-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {['mm', 'cm', 'm'].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </section>

                      <section className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide flex items-center gap-2">
                          <ArrowRightLeft className="h-3 w-3" /> Conversão de Unidades
                        </h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label className="text-xs">Unidade de compra</Label>
                            <Select value={groupForm.purchase_unit} onValueChange={v => updateGroup('purchase_unit', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Unidade de produção</Label>
                            <Select value={groupForm.production_unit} onValueChange={v => updateGroup('production_unit', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Taxa de conversão</Label>
                            <Input type="number" step="0.0001" value={groupForm.conversion_rate} onChange={e => updateGroup('conversion_rate', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div>
                            <Label className="text-xs">Rendimento por metro</Label>
                            <Input type="number" step="0.0001" value={groupForm.yield_per_meter} onChange={e => updateGroup('yield_per_meter', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div>
                            <Label className="text-xs">Unidade de rendimento</Label>
                            <Select value={groupForm.yield_unit} onValueChange={v => updateGroup('yield_unit', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>{['dm²', 'cm²', 'm²', 'cm', 'm'].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Unidade de OC</Label>
                            <Select value={groupForm.purchase_order_unit} onValueChange={v => updateGroup('purchase_order_unit', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </div>
                      </section>

                      <section className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Cálculo & Logística</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Método de cálculo</Label>
                            <Select value={groupForm.calculation_method} onValueChange={v => updateGroup('calculation_method', v as 'weight' | 'meter' | 'unit')}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {CALC_METHODS.map(m => (
                                  <SelectItem key={m} value={m}>
                                    {m === 'weight' ? 'Peso' : m === 'meter' ? 'Metro' : 'Unidade'}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Lead time padrão (dias)</Label>
                            <Input type="number" value={groupForm.lead_time_days} onChange={e => updateGroup('lead_time_days', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Qtd mínima de compra</Label>
                            <Input type="number" value={groupForm.min_order_quantity} onChange={e => updateGroup('min_order_quantity', Number(e.target.value))} className="mt-1 h-9 font-mono" />
                          </div>
                        </div>
                      </section>

                      <section className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div>
                          <Label className="text-xs font-medium">Status Ativo (Grupo)</Label>
                          <p className="text-[11px] text-muted-foreground">Desativar remove todas as variantes de novos pedidos.</p>
                        </div>
                        <Switch checked={groupForm.active} onCheckedChange={v => updateGroup('active', v)} />
                      </section>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-4 border-t bg-background">
                    <Button variant="ghost" onClick={() => setActiveTab('variants')} disabled={savingGroup}>Cancelar</Button>
                    <Button onClick={handleSaveGroupForm} disabled={savingGroup} className="gap-1 min-w-[200px]">
                      {savingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Salvar Dados do Grupo
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ─── ABA: Adicionar variante ─── */}
            <TabsContent value="add" className="mt-4">
              <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Plus className="h-4 w-4" /> Nova variante de cor
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="new-color" className="text-xs">Cor *</Label>
                    <Input id="new-color" value={newColor} onChange={e => setNewColor(e.target.value)}
                      placeholder="Ex: Preto, Caramelo" className="mt-1 h-9" />
                  </div>
                  <div>
                    <Label htmlFor="new-sku" className="text-xs">SKU *</Label>
                    <Input id="new-sku" value={newSku} onChange={e => setNewSku(e.target.value)}
                      placeholder="Ex: DUB-PRETO-001" className="mt-1 h-9 font-mono" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Dados técnicos (categoria, grupo, dimensões, custo, fornecedor) serão copiados das variantes existentes.
                  Você pode ajustá-los depois clicando em <strong>Editar completo</strong>.
                </p>
                <Button onClick={handleAddVariant} disabled={adding} size="sm" className="gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  {adding ? 'Adicionando...' : 'Adicionar Variante'}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <VariantDetailSheet
        open={!!detailVariant}
        onOpenChange={(o) => { if (!o) setDetailVariant(null); }}
        product={detailVariant}
        otherVariants={detailVariant ? variants.filter(v => v.id !== detailVariant.id) : []}
      />
    </>
  );
}
