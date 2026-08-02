import { useState, useMemo, useEffect } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { stripColorFromName } from '@/lib/utils';
import GroupDialog from '@/components/groups/GroupDialog';
import { BulkApplyPreview, buildBulkImpact, type BulkImpact } from './BulkApplyPreview';

 import { Plus, PencilSimple as Pencil, FloppyDisk as Save, CircleNotch as Loader2, X, Image as ImageIcon, Package, Stack as Layers, Gear as SettingsIcon, ArrowsLeftRight as ArrowRightLeft } from '@phosphor-icons/react';
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
      // Trocar a cor NÃO renomeia mais o produto: o nome é a única pista de cor
      // que o `partial_name` do `resolve_material_product` tem nos itens de cor
      // vazia, e mexer nele muda quem o PV debita (spec R0.1/R2.1). A cor mora
      // em `products.color`, que é o que a cascata lê primeiro.
      const updates: any = { ...form };
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
                <p className="text-xs text-muted-foreground">Variantes inativas não aparecem em pedidos.</p>
              </div>
              <Switch checked={!!form.active} onCheckedChange={v => update('active', v)} />
            </div>
          </section>

          {/* Estoque */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Estoque</h4>
            {form.unit && form.unit !== (product?.unit || 'un') && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                ⚠ Você mudou a unidade de <strong>{product?.unit}</strong> para <strong>{form.unit}</strong>.
                Os valores numéricos abaixo NÃO são convertidos automaticamente — confira se Quantidade,
                Custo e Estoque mínimo precisam ser reescritos pra nova unidade.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Quantidade atual <span className="text-muted-foreground font-mono">({form.unit ?? 'un'})</span></Label>
                <NumberInput value={form.quantity ?? 0} onChange={v => update('quantity', v)} min={0} step="0.01" className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs">Unidade</Label>
                <Select value={form.unit ?? 'un'} onValueChange={v => update('unit', v)}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Estoque mínimo <span className="text-muted-foreground font-mono">({form.unit ?? 'un'})</span></Label>
                <NumberInput value={form.min_stock ?? 0} onChange={v => update('min_stock', v)} min={0} step="0.01" className="mt-1 h-9" />
              </div>
              {/* Removidos em 2026-05 a pedido do usuário:
                  - "Estoque máximo": nunca usado em business logic
                  - "Estoque de segurança": duplicava conceitualmente o mínimo */}
              <div>
                <Label className="text-xs">Reservado <span className="text-muted-foreground font-mono">({form.unit ?? 'un'})</span></Label>
                <NumberInput value={form.reserved_stock ?? 0} onChange={v => update('reserved_stock', v)} min={0} step="0.01" className="mt-1 h-9" />
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
                <NumberInput value={form.unit_price ?? 0} onChange={v => update('unit_price', v)} min={0} step="0.0001" className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs">Preço atacado (R$)</Label>
                <NumberInput value={form.price_wholesale ?? 0} onChange={v => update('price_wholesale', v)} min={0} step="0.01" className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs">Preço varejo (R$)</Label>
                <NumberInput value={form.price_retail ?? 0} onChange={v => update('price_retail', v)} min={0} step="0.01" className="mt-1 h-9" />
              </div>
              <div>
                <Label className="text-xs">Lead time (dias)</Label>
                <NumberInput value={form.lead_time_days ?? 0} onChange={v => update('lead_time_days', v)} min={0} step="1" decimals={0} className="mt-1 h-9" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Quantidade mínima de compra</Label>
                <NumberInput value={form.min_order_quantity ?? 0} onChange={v => update('min_order_quantity', v)} min={0} step="0.01" className="mt-1 h-9" />
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
  /** Aba de abertura — a lista abre direto em "Aplicar a todas as cores" ou
   *  "Adicionar" conforme a ação clicada (R1.16). */
  initialTab?: 'variants' | 'group' | 'add';
}

/** Campos que a edição em massa grava. Dimensões, `calculation_method` e
 *  `purchase_multiple` saíram daqui em 02/08/2026: moram em `product_groups` e
 *  agora têm porta única no GroupEditDialog (spec R2.11 / R3.3). */
const BULK_FIELDS = [
  'technical_name', 'category', 'group_id', 'supplier_id',
  'yield_per_meter', 'yield_unit',
  'purchase_unit', 'production_unit', 'conversion_rate', 'purchase_order_unit',
  'lead_time_days', 'unit_price', 'price_wholesale', 'price_retail',
  'min_stock', 'max_stock', 'safety_stock', 'location', 'active',
  'min_order_quantity',
] as const;
type BulkField = (typeof BULK_FIELDS)[number];

const BULK_LABELS: Record<BulkField, string> = {
  technical_name: 'Nome técnico',
  category: 'Categoria',
  group_id: 'Grupo de produtos',
  supplier_id: 'Fornecedor padrão',
  yield_per_meter: 'Rendimento por metro',
  yield_unit: 'Unidade de rendimento',
  purchase_unit: 'Unidade de compra',
  production_unit: 'Unidade de produção',
  conversion_rate: 'Taxa de conversão',
  purchase_order_unit: 'Unidade de OC',
  lead_time_days: 'Lead time padrão',
  unit_price: 'Custo unitário',
  price_wholesale: 'Atacado',
  price_retail: 'Varejo',
  min_stock: 'Estoque mínimo',
  max_stock: 'Estoque máximo',
  safety_stock: 'Segurança',
  location: 'Localização física',
  active: 'Status ativo',
  min_order_quantity: 'Qtd mínima de compra',
};

const NUMERIC_BULK_FIELDS = new Set<BulkField>([
  'yield_per_meter', 'conversion_rate', 'lead_time_days', 'unit_price',
  'price_wholesale', 'price_retail', 'min_stock', 'max_stock', 'safety_stock',
  'min_order_quantity',
]);

/** Valores distintos por campo entre as variantes. Campo com mais de um valor é
 *  DIVERGENTE: nasce vazio no form e só é gravado se o usuário preencher, senão
 *  salvar achataria valor próprio em silêncio (R2.5/R2.6). Hoje
 *  `COMPONENTES DIVERSOS` tem 6 custos distintos em 8 itens. */
function computeDivergence(variants: Product[]): Record<string, { valores: Map<string, number>; divergente: boolean }> {
  const out: Record<string, { valores: Map<string, number>; divergente: boolean }> = {};
  for (const f of BULK_FIELDS) {
    const valores = new Map<string, number>();
    for (const v of variants) {
      const raw = (v as any)[f];
      const key = raw == null || raw === '' ? '' : String(raw);
      valores.set(key, (valores.get(key) || 0) + 1);
    }
    out[f] = { valores, divergente: valores.size > 1 };
  }
  return out;
}

/** Rótulo de campo da edição em massa. Quando as cores têm valores diferentes,
 *  mostra quantos são e quais — o campo fica vazio até alguém preencher, então
 *  o selo é o único aviso de que existe valor próprio em jogo (R2.5). */
function BulkLabel({ field, divergence, children }: {
  field: BulkField;
  divergence: Record<string, { valores: Map<string, number>; divergente: boolean }>;
  children: React.ReactNode;
}) {
  const info = divergence[field];
  if (!info?.divergente) return <Label className="text-xs">{children}</Label>;
  const lista = [...info.valores.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <Label className="text-xs flex items-center gap-1.5 flex-wrap">
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="h-4 px-1 text-[10px] font-medium bg-warning/10 text-warning border-warning/30 cursor-help">
            {info.valores.size} valores diferentes
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="text-xs max-w-xs">
          <p className="font-semibold mb-1">Deixe vazio para preservar</p>
          <ul className="space-y-0.5">
            {lista.map(([valor, n]) => (
              <li key={valor}>• {valor === '' ? '(vazio)' : valor} — {n} cor{n === 1 ? '' : 'es'}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </Label>
  );
}

export function MasterVariantDialog({
  open,
  onOpenChange,
  baseName,
  variants,
  onEditVariant: _onEditVariant, // legacy escape-hatch (full ProductFormDialog)
  onDeleteVariant,
  initialTab = 'variants',
}: MasterVariantDialogProps) {
  const [activeTab, setActiveTab] = useState<'variants' | 'group' | 'add'>(initialTab);

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

  // Form da edição em massa. `null` num campo = "não preencher" — é assim que
  // campo divergente nasce, e campo não preenchido nunca entra no payload.
  type GroupForm = {
    technical_name: string | null;
    category: string | null;
    group_id: string | null;
    supplier_id: string | null;
    yield_per_meter: number | null;
    yield_unit: string | null;
    purchase_unit: string | null;
    production_unit: string | null;
    conversion_rate: number | null;
    purchase_order_unit: string | null;
    lead_time_days: number | null;
    unit_price: number | null;
    price_wholesale: number | null;
    price_retail: number | null;
    min_stock: number | null;
    max_stock: number | null;
    safety_stock: number | null;
    location: string | null;
    active: boolean | null;
    min_order_quantity: number | null;
  };
  const [groupForm, setGroupForm] = useState<GroupForm | null>(null);
  /** Só o que o usuário mexeu é gravado (R2.6). */
  const [dirty, setDirty] = useState<Set<BulkField>>(new Set());
  const [savingGroup, setSavingGroup] = useState(false);
  const [confirmUnitOpen, setConfirmUnitOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const divergence = useMemo(() => computeDivergence(variants), [variants]);
  const [openGroupEditor, setOpenGroupEditor] = useState(false);
  const groupOfVariants = useMemo(
    () => groups.find((g: any) => g.id === variants[0]?.group_id) ?? null,
    [groups, variants],
  );

  /** Invariante do CLAUDE.md: `purchase_unit == unit` ⇒ `conversion_rate = 1`.
   *  Com o fator travado, o campo não aceita o 0 que zeraria consumo (R2.13). */
  const conversionTravada = useMemo(() => {
    const compra = groupForm?.purchase_unit ?? variants[0]?.purchase_unit ?? '';
    const estoque = variants[0]?.unit ?? '';
    return !!compra && compra === estoque;
  }, [groupForm?.purchase_unit, variants]);

  useEffect(() => {
    if (conversionTravada && groupForm && groupForm.conversion_rate !== 1) {
      updateGroup('conversion_rate', 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversionTravada]);

  // Helper compartilhado: NaN/null/undefined → fallback (0 por default).
  // Usado nos onChange dos inputs numéricos pra evitar que o state segure
  // NaN, e no payload de save pra blindar valores que escaparam.
  const safeNum = (v: any, fallback = 0): number =>
    Number.isFinite(Number(v)) ? Number(v) : fallback;

  useEffect(() => {
    if (open && variants.length > 0) {
      setActiveGradeTab(variants[0].id);
      setRangeChanges({});
      setActiveTab(initialTab);
      setDirty(new Set());
      const t = variants[0];
      const div = computeDivergence(variants);
      // Campo homogêneo nasce com o valor comum (R2.7); divergente nasce vazio
      // (R2.6), pra que salvar não achate o valor próprio de cada cor.
      const comum = <T,>(f: BulkField, valor: T): T | null => (div[f].divergente ? null : valor);
      setGroupForm({
        technical_name: comum('technical_name', t.technical_name || ''),
        category: comum('category', t.category || ''),
        group_id: comum('group_id', t.group_id || null),
        supplier_id: comum('supplier_id', t.supplier_id || null),
        yield_per_meter: comum('yield_per_meter', Number(t.yield_per_meter) || 0),
        yield_unit: comum('yield_unit', t.yield_unit || 'dm²'),
        purchase_unit: comum('purchase_unit', t.purchase_unit || 'un'),
        production_unit: comum('production_unit', t.production_unit || 'un'),
        conversion_rate: comum('conversion_rate', Number(t.conversion_rate) || 1),
        purchase_order_unit: comum('purchase_order_unit', t.purchase_order_unit || 'un'),
        lead_time_days: comum('lead_time_days', Number(t.lead_time_days) || 0),
        unit_price: comum('unit_price', Number(t.unit_price) || 0),
        price_wholesale: comum('price_wholesale', Number(t.price_wholesale) || 0),
        price_retail: comum('price_retail', Number(t.price_retail) || 0),
        min_stock: comum('min_stock', Number(t.min_stock) || 0),
        max_stock: comum('max_stock', Number(t.max_stock) || 0),
        safety_stock: comum('safety_stock', Number(t.safety_stock) || 0),
        location: comum('location', t.location || ''),
        active: comum('active', t.active ?? true),
        min_order_quantity: comum('min_order_quantity', Number(t.min_order_quantity) || 0),
      });
    }
  }, [open, variants, initialTab]);

  const updateGroup = <K extends keyof GroupForm>(k: K, v: GroupForm[K]) => {
    setGroupForm(prev => (prev ? { ...prev, [k]: v } : prev));
    setDirty(prev => new Set(prev).add(k as BulkField));
  };

  /** Campos que o usuário mexeu e que vão pro payload. */
  const camposAlterados = useMemo<BulkField[]>(() => {
    if (!groupForm) return [];
    return BULK_FIELDS.filter(f => dirty.has(f) && (groupForm as any)[f] != null);
  }, [groupForm, dirty]);

  /** Quantas cores perdem valor PRÓPRIO em cada campo alterado — é o que a
   *  prévia mostra antes de gravar (R2.8). */
  const impacto = useMemo<BulkImpact[]>(() => {
    if (!groupForm) return [];
    const diff = Object.fromEntries(camposAlterados.map(f => [f, (groupForm as any)[f]]));
    return buildBulkImpact(diff, BULK_LABELS, variants, (v, campo) => (v as any)[campo], v => v.color || v.sku);
  }, [camposAlterados, groupForm, variants]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);

  const handleAddVariant = async () => {
    if (!newColor.trim()) { toast.error('Informe a cor da variante'); return; }
    if (!newSku.trim()) { toast.error('Informe o SKU da variante'); return; }
    const exists = variants.some(v => (v.color || '').toLowerCase().trim() === newColor.toLowerCase().trim());
    if (exists) { toast.error('Já existe uma variante com esta cor'); return; }

    const newProduct: ProductFormData = {
      // A cor nova herda o NOME do material das irmãs, sem sufixo de cor: a cor
      // mora em `products.color`, que é o que o débito lê. 189 dos 195 nomes
      // ativos são "crus" — o sufixo " - cor" só criaria um padrão novo.
      name: stripColorFromName(template.name, template.color).trim() || template.name,
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

    if (camposAlterados.length === 0) {
      toast.info('Nenhuma alteração para aplicar');
      return;
    }

    // ─── Validações de consistência ───────────────────────────────────
    // Só validam campo que o usuário mexeu — campo intocado mantém o valor
    // próprio de cada cor e não precisa passar por aqui.
    if (dirty.has('category') && !(groupForm.category || '').trim()) {
      toast.error('Categoria é obrigatória'); return;
    }
    if (dirty.has('conversion_rate') && (groupForm.conversion_rate ?? 0) <= 0) {
      toast.error('Taxa de conversão deve ser maior que 0 — caso contrário o cálculo de consumo quebra');
      return;
    }
    if (dirty.has('lead_time_days') && (groupForm.lead_time_days ?? 0) < 0) {
      toast.error('Lead time não pode ser negativo'); return;
    }
    // Cores duplicadas continuam sendo bloqueio: duas linhas com a mesma cor no
    // mesmo grupo fazem o `resolve_material_product` escolher por maior saldo,
    // não pela intenção de quem digitou o PV.
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
    if (dirty.has('purchase_unit') || dirty.has('production_unit')) {
      setConfirmUnitOpen(true);
      return;
    }
    setPreviewOpen(true);
  };

  // Persistência de fato. Grava SÓ os campos preenchidos pelo usuário
  // (`camposAlterados`) — campo intocado preserva o valor próprio de cada cor.
  // NÃO grava `name`: renomear mudaria a pista que o `partial_name` do
  // `resolve_material_product` usa nos 21 produtos de cor vazia (spec R2.1).
  const doSaveGroupForm = async () => {
    if (!groupForm) return;

    setSavingGroup(true);
    try {
      const payload: any = {};
      for (const f of camposAlterados) {
        const valor = (groupForm as any)[f];
        payload[f] = NUMERIC_BULK_FIELDS.has(f) ? safeNum(valor) : valor;
      }
      if (payload.conversion_rate != null) payload.conversion_rate = safeNum(payload.conversion_rate, 1) || 1;
      if (payload.yield_per_meter != null) payload.yield_per_meter = safeNum(payload.yield_per_meter) || null;

      for (const v of variants) {
        const { error } = await supabase.from('products').update(payload).eq('id', v.id);
        if (error) throw new Error(`Variante "${v.color || v.sku}": ${error.message}`);
      }
      queryClient.invalidateQueries({ queryKey: ['products'] });
      // Invalida caches dependentes — fichas técnicas, BOM, consumo
      queryClient.invalidateQueries({ queryKey: ['technical_sheets'] });
      queryClient.invalidateQueries({ queryKey: ['order-consumption'] });
      queryClient.invalidateQueries({ queryKey: ['sole_standard_items'] });
      toast.success(
        `${camposAlterados.length} campo${camposAlterados.length === 1 ? '' : 's'} aplicado${camposAlterados.length === 1 ? '' : 's'} a ${variants.length} cor${variants.length === 1 ? '' : 'es'}`,
      );
      setDirty(new Set());
      setPreviewOpen(false);
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
      // O grid de numeração do PV (SaleOrderItemForm) cacheia o range do solado
      // por 5 min via estas queries. Sem invalidar, editar a faixa aqui deixa o
      // PV mostrando o range antigo (mesmo gap já corrigido em SolesCadastroTab).
      queryClient.invalidateQueries({ queryKey: ['sole_size_range_specific'] });
      queryClient.invalidateQueries({ queryKey: ['sole_size_conjugations'] });
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
      // Grava SÓ a cor. O rename que existia aqui ("<base> - <cor>") violava o
      // mesmo invariante do salvar em massa: `products.name` é a pista que o
      // `partial_name` do `resolve_material_product` usa nos itens de cor vazia,
      // e o nome não deve mudar como efeito colateral (spec R0.1/R2.1).
      const { error } = await supabase.from('products')
        .update({ color: newVal })
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
              {/* Nome do GRUPO de estoque — não o nome-base derivado por corte
                  de palavra, que exibia "NAPA" para a NAPA SOFT (R2.3). */}
              {groupOfVariants?.name || baseName}
              <Badge variant="outline" className="font-normal text-xs">
                {variants.length} cor{variants.length === 1 ? '' : 'es'}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              Edite cores individuais, aplique um valor a todas de uma vez ou adicione novas cores.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="mt-2">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="variants" className="gap-1.5"><Layers className="h-3.5 w-3.5" /> Variantes</TabsTrigger>
              {/* "Dados do Grupo" era enganoso: esta aba nunca tocou
                  `product_groups` — grava nos PRODUTOS, todos de uma vez (R2.4). */}
              <TabsTrigger value="group" className="gap-1.5"><SettingsIcon className="h-3.5 w-3.5" /> Aplicar a todas as cores</TabsTrigger>
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
                            <Badge variant="secondary" className="text-xs px-1 py-0">{label}</Badge>
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
                        Preencha só o que deve valer para <strong>todas as {variants.length} cor{variants.length === 1 ? '' : 'es'}</strong>.
                        Campo deixado <strong>vazio não é gravado</strong> — cada cor mantém o valor próprio.
                        O nome dos produtos nunca é alterado aqui.
                      </div>

                      <section className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide flex items-center gap-2">
                          <Package className="h-3 w-3" /> Identificação
                        </h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <BulkLabel field="technical_name" divergence={divergence}>Nome técnico</BulkLabel>
                            <Input value={groupForm.technical_name ?? ''} onChange={e => updateGroup('technical_name', e.target.value)} className="mt-1 h-9" placeholder={divergence.technical_name.divergente ? 'Manter valor de cada cor' : ''} />
                          </div>
                          <div>
                            <BulkLabel field="category" divergence={divergence}>Categoria</BulkLabel>
                            <Select value={groupForm.category ?? ''} onValueChange={v => updateGroup('category', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Manter valor de cada cor" /></SelectTrigger>
                              <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <BulkLabel field="group_id" divergence={divergence}>Grupo de produtos</BulkLabel>
                            <Select value={groupForm.group_id ?? ''} onValueChange={v => updateGroup('group_id', v === '__none__' ? null : v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Manter valor de cada cor" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— Sem grupo —</SelectItem>
                                {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <BulkLabel field="supplier_id" divergence={divergence}>Fornecedor padrão</BulkLabel>
                            <Select value={groupForm.supplier_id ?? ''} onValueChange={v => updateGroup('supplier_id', v === '__none__' ? null : v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Manter valor de cada cor" /></SelectTrigger>
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
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <BulkLabel field="unit_price" divergence={divergence}>Custo unitário (R$ por {template?.unit || 'un'})</BulkLabel>
                            <NumberInput value={groupForm.unit_price ?? undefined} onChange={v => updateGroup('unit_price', v)} step="0.0001" className="mt-1 h-9" />
                          </div>
                          <div>
                            <BulkLabel field="price_wholesale" divergence={divergence}>Atacado (R$)</BulkLabel>
                            <NumberInput value={groupForm.price_wholesale ?? undefined} onChange={v => updateGroup('price_wholesale', v)} step="0.01" className="mt-1 h-9" />
                          </div>
                          <div>
                            <BulkLabel field="price_retail" divergence={divergence}>Varejo (R$)</BulkLabel>
                            <NumberInput value={groupForm.price_retail ?? undefined} onChange={v => updateGroup('price_retail', v)} step="0.01" className="mt-1 h-9" />
                          </div>
                        </div>
                      </section>

                      <section className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Estoque &amp; Localização</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <BulkLabel field="min_stock" divergence={divergence}>Estoque mínimo ({template?.unit || 'un'})</BulkLabel>
                            <NumberInput value={groupForm.min_stock ?? undefined} onChange={v => updateGroup('min_stock', v)} className="mt-1 h-9" />
                          </div>
                          <div>
                            <BulkLabel field="max_stock" divergence={divergence}>Estoque máximo ({template?.unit || 'un'})</BulkLabel>
                            <NumberInput value={groupForm.max_stock ?? undefined} onChange={v => updateGroup('max_stock', v)} className="mt-1 h-9" />
                          </div>
                          <div>
                            <BulkLabel field="safety_stock" divergence={divergence}>Segurança ({template?.unit || 'un'})</BulkLabel>
                            <NumberInput value={groupForm.safety_stock ?? undefined} onChange={v => updateGroup('safety_stock', v)} className="mt-1 h-9" />
                          </div>
                          <div className="col-span-full">
                            <BulkLabel field="location" divergence={divergence}>Localização física</BulkLabel>
                            <Select value={groupForm.location ?? ''} onValueChange={v => updateGroup('location', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Manter valor de cada cor" /></SelectTrigger>
                              <SelectContent>{LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </div>
                      </section>

                      {/* Dimensões saíram daqui em 02/08/2026: moram em
                          `product_groups` e são cadastradas no grupo de estoque
                          (spec R2.11 / R3.3). Duas portas gravando o mesmo
                          conceito era a origem do 1370 no grupo × 1000 nos itens. */}
                      <section className="rounded-md border border-dashed px-3 py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium">Dimensões, embalagem e múltiplo de compra</p>
                          <p className="text-xs text-muted-foreground">
                            Pertencem ao grupo de estoque, não à cor — inclusive a largura que converte dm² em metro.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 gap-1.5"
                          disabled={!groupForm.group_id && !template?.group_id}
                          onClick={() => setOpenGroupEditor(true)}
                        >
                          <SettingsIcon className="h-3.5 w-3.5" /> Editar no grupo
                        </Button>
                      </section>

                      <section className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide flex items-center gap-2">
                          <ArrowRightLeft className="h-3 w-3" /> Conversão de Unidades
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <BulkLabel field="purchase_unit" divergence={divergence}>Unidade de compra</BulkLabel>
                            <Select value={groupForm.purchase_unit ?? ''} onValueChange={v => updateGroup('purchase_unit', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Manter" /></SelectTrigger>
                              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <BulkLabel field="production_unit" divergence={divergence}>Unidade de produção</BulkLabel>
                            <Select value={groupForm.production_unit ?? ''} onValueChange={v => updateGroup('production_unit', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Manter" /></SelectTrigger>
                              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <BulkLabel field="conversion_rate" divergence={divergence}>Taxa de conversão</BulkLabel>
                            {/* Invariante do CLAUDE.md: unidade de compra igual à de
                                estoque ⇒ fator 1. Travado em leitura pra não voltar
                                o `conversion_rate = 0`, que zera consumo (R2.13). */}
                            {conversionTravada ? (
                              <div className="mt-1 h-9 flex items-center gap-2 rounded-md border bg-muted/40 px-3">
                                <span className="font-mono text-sm">1×</span>
                                <span className="text-xs text-muted-foreground">compra = estoque</span>
                              </div>
                            ) : (
                              <NumberInput value={groupForm.conversion_rate ?? undefined} onChange={v => updateGroup('conversion_rate', v)} step="0.0001" className="mt-1 h-9" />
                            )}
                          </div>
                          <div>
                            <BulkLabel field="yield_per_meter" divergence={divergence}>Rendimento por metro</BulkLabel>
                            <NumberInput value={groupForm.yield_per_meter ?? undefined} onChange={v => updateGroup('yield_per_meter', v)} step="0.0001" className="mt-1 h-9" />
                          </div>
                          <div>
                            <BulkLabel field="yield_unit" divergence={divergence}>Unidade de rendimento</BulkLabel>
                            <Select value={groupForm.yield_unit ?? ''} onValueChange={v => updateGroup('yield_unit', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Manter" /></SelectTrigger>
                              <SelectContent>{['dm²', 'cm²', 'm²', 'cm', 'm'].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div>
                            <BulkLabel field="purchase_order_unit" divergence={divergence}>Unidade de OC</BulkLabel>
                            <Select value={groupForm.purchase_order_unit ?? ''} onValueChange={v => updateGroup('purchase_order_unit', v)}>
                              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Manter" /></SelectTrigger>
                              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </div>
                      </section>

                      <section className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Reposição</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <BulkLabel field="lead_time_days" divergence={divergence}>Lead time padrão (dias)</BulkLabel>
                            <NumberInput value={groupForm.lead_time_days ?? undefined} onChange={v => updateGroup('lead_time_days', v)} className="mt-1 h-9" />
                          </div>
                          <div>
                            <BulkLabel field="min_order_quantity" divergence={divergence}>Qtd mínima de compra ({groupForm.purchase_unit ?? template?.purchase_unit ?? 'un'})</BulkLabel>
                            <NumberInput value={groupForm.min_order_quantity ?? undefined} onChange={v => updateGroup('min_order_quantity', v)} className="mt-1 h-9" />
                          </div>
                        </div>
                      </section>

                      <section className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div>
                          <BulkLabel field="active" divergence={divergence}>Status ativo</BulkLabel>
                          <p className="text-xs text-muted-foreground">Desativar remove todas as cores de novos pedidos.</p>
                        </div>
                        <Switch checked={groupForm.active ?? false} onCheckedChange={v => updateGroup('active', v)} />
                      </section>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-4 border-t bg-background">
                    <span className="mr-auto text-xs text-muted-foreground">
                      {camposAlterados.length === 0
                        ? 'Nenhum campo preenchido'
                        : `${camposAlterados.length} campo${camposAlterados.length === 1 ? '' : 's'} para aplicar`}
                    </span>
                    <Button variant="ghost" onClick={() => setActiveTab('variants')} disabled={savingGroup}>Cancelar</Button>
                    <Button onClick={handleSaveGroupForm} disabled={savingGroup || camposAlterados.length === 0} className="gap-1 min-w-[200px]">
                      {savingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Revisar e aplicar
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

      {/* Mudança de unidade afeta o consumo de TODAS as referências — confirmação estruturada */}
      <AlertDialog open={confirmUnitOpen} onOpenChange={setConfirmUnitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alterar unidade de compra/produção?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso afeta o cálculo de consumo de TODAS as referências que usam estas variantes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmUnitOpen(false); setPreviewOpen(true); }}>
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Prévia obrigatória antes de gravar (R2.8). Nomeia a cor que perde valor
          próprio — sem isso o achatamento era invisível até alguém notar o custo
          errado no custeio. */}
      <AlertDialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Aplicar {camposAlterados.length} campo{camposAlterados.length === 1 ? '' : 's'} a {variants.length} cor{variants.length === 1 ? '' : 'es'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Os nomes dos produtos não são alterados. Campos não preenchidos ficam como estão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <BulkApplyPreview impacto={impacto} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingGroup}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void doSaveGroupForm(); }} disabled={savingGroup}>
              {savingGroup ? 'Aplicando…' : 'Aplicar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dimensões e embalagem vivem no grupo de estoque (R2.11). */}
      {openGroupEditor && groupOfVariants && (
        <GroupDialog
          open={openGroupEditor}
          onOpenChange={setOpenGroupEditor}
          group={groupOfVariants}
        />
      )}
    </>
  );
}
