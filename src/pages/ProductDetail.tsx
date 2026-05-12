import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
 import { useUpdateProduct, useDeleteProduct, ProductSchema, useProducts } from '@/hooks/useProducts';
 import { useCurrentProfile } from '@/hooks/useUserManagement';
import { useGroups } from '@/hooks/useGroups';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useComponentSheets, useAddComponentSheet, useUpdateComponentSheet } from '@/hooks/useComponentSheets';
import { Product, ProductFormData, CATEGORIES, UNITS, LOCATIONS } from '@/types/inventory';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
 import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
 import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
 import { ArrowLeft, Save, Trash2, Package, Loader2, ImageIcon, X, Layers, Footprints, History, PlusCircle, MinusCircle, AlertTriangle } from 'lucide-react';
import { cn, stripColorFromName } from '@/lib/utils';
import { toast } from 'sonner';
import { z } from 'zod';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { SoleTechnicalDetails } from "@/components/technical-sheets/SoleTechnicalDetails";
 import { SoleStandardItemsPanel } from "@/components/technical-sheets/SoleStandardItemsPanel";
 import { SoleSilkPanel } from "@/components/technical-sheets/SoleSilkPanel";
 import StockHistory from './StockHistory';

const SOLADO_COLORS = ['Preto', 'Caramelo'];
const ADULT_SIZES = [34, 35, 36, 37, 38, 39, 40];
const CHILD_SIZES = Array.from({ length: 16 }, (_, i) => 21 + i);


const PURCHASE_UNITS = ['metro', 'm²', 'dm²', 'chapa', 'kg', 'un', 'rolo', 'cx'] as const;
const PRODUCTION_UNITS = ['dm²', 'm²', 'un', 'par', 'gr', 'ml', 'metros'] as const;

type PurchaseUnit = (typeof PURCHASE_UNITS)[number];
type ProductionUnit = (typeof PRODUCTION_UNITS)[number];

const normalizePurchaseUnit = (value?: string | null): PurchaseUnit => {
  if (!value) return 'un';
  const n = value.trim().toLowerCase();
  if (n === 'm' || n === 'metro' || n === 'metros') return 'metro';
  if (n === 'unidade') return 'un';
  if (n === 'm²' || n === 'm2' || n === 'metro quadrado') return 'm²';
  if (n === 'dm²' || n === 'dm2') return 'dm²';
  return PURCHASE_UNITS.includes(n as PurchaseUnit) ? (n as PurchaseUnit) : 'un';
};

const normalizeProductionUnit = (value?: string | null): ProductionUnit => {
  if (!value) return 'un';
  const n = value.trim().toLowerCase();
  if (n === 'm' || n === 'metro' || n === 'metros') return 'metros';
  if (n === 'unidade') return 'un';
  if (n === 'dm²' || n === 'dm2') return 'dm²';
  return PRODUCTION_UNITS.includes(n as ProductionUnit) ? (n as ProductionUnit) : 'un';
};

const normalizeCalculationMethod = (value?: string | null): 'weight' | 'meter' | 'unit' => {
  if (value === 'weight' || value === 'meter' || value === 'unit') return value;
  return 'weight';
};

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [zoomOpen, setZoomOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: product, isLoading, isError } = useQuery({
    queryKey: ['product-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Product;
    },
    enabled: !!id,
  });

  const { data: groups = [] } = useGroups();
  const { data: suppliers = [] } = useSuppliers();
  const { data: componentSheets = [] } = useComponentSheets();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const { data: allProducts = [] } = useProducts();
  const addComponentSheet = useAddComponentSheet();
  const updateComponentSheet = useUpdateComponentSheet();

  // Form state
  const [form, setForm] = useState<ProductFormData>({
    name: '', technical_name: '', sku: '', category: '', color: '', quantity: 0, min_stock: 0, max_stock: 0,
    unit: 'un', unit_price: 0, location: '', group_id: null, active: true, image_url: '',
    min_stock_grade: {}, stock_grade: {}, yield_per_meter: null, yield_unit: 'dm²',
    dimensions_length: 0, dimensions_width: 0, dimensions_thickness: 0, dimensions_unit: 'mm',
    purchase_unit: 'un', production_unit: 'un', conversion_rate: 1, purchase_order_unit: 'un',
    min_order_quantity: 1, safety_stock: 0, lead_time_days: 7, calculation_method: 'weight',
    supplier_id: null, lot_number: null, expiration_date: null, is_chemical: false,
    linked_last_id: null, sole_material: null, heel_height: null,
  });

  const [soladoColor, setSoladoColor] = useState('');
  const [soladoGrade, setSoladoGrade] = useState<Record<string, number>>({});
  const [minStockGrade, setMinStockGrade] = useState<Record<string, number>>({});
  const [shoeCategory, setShoeCategory] = useState<'adulto' | 'infantil'>('adulto');
  const [yieldPerSize, setYieldPerSize] = useState<Record<string, number>>({});
  const [wastePct, setWastePct] = useState(8);
  const [plateLength, setPlateLength] = useState(0);
  const [plateWidth, setPlateWidth] = useState(0);
  const [plateThickness, setPlateThickness] = useState(0);
  const [plateUnit, setPlateUnit] = useState('mm');

  const existingSheet = useMemo(() => {
    if (!product) return null;
    return (componentSheets as any[]).find((s: any) => s.product_id === product.id) || null;
  }, [product, componentSheets]);

  const isSolado = form.category.toLowerCase().includes('solado');
  const hasGrade = isSolado;
  const currentSizes = shoeCategory === 'infantil' ? CHILD_SIZES : ADULT_SIZES;

  // Populate form from product
  useEffect(() => {
    if (!product) return;
    const { id: _id, created_at, updated_at, ...rest } = product;
    const cleanName = stripColorFromName(rest.name || '', rest.color);
    setForm({
      name: cleanName, technical_name: rest.technical_name || '', sku: rest.sku || '',
      category: rest.category || '', color: rest.color || '', quantity: rest.quantity ?? 0,
      min_stock: rest.min_stock ?? 0, max_stock: rest.max_stock ?? 0, unit: rest.unit || 'un',
      unit_price: rest.unit_price ?? 0, location: rest.location || '', group_id: rest.group_id || null,
      active: rest.active ?? true, image_url: rest.image_url || '',
      min_stock_grade: (rest.min_stock_grade && typeof rest.min_stock_grade === 'object' && !Array.isArray(rest.min_stock_grade))
        ? (rest.min_stock_grade as Record<string, number>) : {},
      stock_grade: (rest.stock_grade && typeof rest.stock_grade === 'object' && !Array.isArray(rest.stock_grade))
        ? (rest.stock_grade as Record<string, number>) : {},
      yield_per_meter: rest.yield_per_meter ?? null, yield_unit: rest.yield_unit || 'dm²',
      dimensions_length: rest.dimensions_length ?? 0, dimensions_width: rest.dimensions_width ?? 0,
      dimensions_thickness: rest.dimensions_thickness ?? 0, dimensions_unit: rest.dimensions_unit || 'mm',
      purchase_unit: normalizePurchaseUnit(rest.purchase_unit),
      production_unit: normalizeProductionUnit(rest.production_unit),
      conversion_rate: rest.conversion_rate ?? 1,
      purchase_order_unit: normalizePurchaseUnit(rest.purchase_order_unit),
      min_order_quantity: rest.min_order_quantity ?? 1,
      safety_stock: rest.safety_stock ?? 0, lead_time_days: rest.lead_time_days ?? 7,
      calculation_method: normalizeCalculationMethod(rest.calculation_method),
      supplier_id: (rest as any).supplier_id || null,
      lot_number: rest.lot_number || null, expiration_date: rest.expiration_date || null,
      is_chemical: rest.is_chemical ?? false,
      linked_last_id: rest.linked_last_id || null,
      sole_material: rest.sole_material || null,
      heel_height: rest.heel_height ?? null,
    });
    setPlateLength(rest.dimensions_length || 0);
    setPlateWidth(rest.dimensions_width || 0);
    setPlateThickness(rest.dimensions_thickness || 0);
    setPlateUnit(rest.dimensions_unit || 'mm');

    if (rest.stock_grade && typeof rest.stock_grade === 'object' && !Array.isArray(rest.stock_grade)) {
      setSoladoGrade(rest.stock_grade as Record<string, number>);
      const keys = Object.keys(rest.stock_grade as object).map(Number).filter(n => !isNaN(n));
      if (keys.some(k => k < 34)) setShoeCategory('infantil');
    }
    if (rest.min_stock_grade && typeof rest.min_stock_grade === 'object') {
      setMinStockGrade(rest.min_stock_grade as Record<string, number>);
      const keys = Object.keys(rest.min_stock_grade as object).map(Number).filter(n => !isNaN(n));
      if (keys.some(k => k < 34)) setShoeCategory('infantil');
    }
    if (rest.color) setSoladoColor(rest.color);

    const sheet = (componentSheets as any[]).find((s: any) => s.product_id === product.id);
    if (sheet) {
      setYieldPerSize(sheet.yield_per_size && typeof sheet.yield_per_size === 'object' ? sheet.yield_per_size as Record<string, number> : {});
      setWastePct(sheet.waste_pct ?? 0);
    }
  }, [product, componentSheets]);

  // Sync grade total into quantity
  useEffect(() => {
    if (hasGrade) {
      const total = Object.values(soladoGrade).reduce((s, v) => s + (v || 0), 0);
      update('quantity', total);
    }
  }, [soladoGrade, hasGrade]);

  const update = <K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) =>
    setForm(prev => {
      const next = { ...prev, [key]: value };
      
      if (key === 'purchase_order_unit' || key === 'unit') {
        const pUnit = normalizePurchaseUnit(key === 'purchase_order_unit' ? (value as string) : prev.purchase_order_unit);
        const sUnit = key === 'unit' ? (value as string) : prev.unit;
        
        if (pUnit === 'm²' && sUnit === 'dm²') {
          next.conversion_rate = 100;
        } else if (pUnit === 'dm²' && sUnit === 'm²') {
          next.conversion_rate = 0.01;
        } else if (pUnit === sUnit && (pUnit === 'm²' || pUnit === 'dm²')) {
          next.conversion_rate = 1;
        }
      }
      
      return next;
    });

  const handleSave = async () => {
    if (!product) return;
    setSaving(true);
    try {
      const baseData = { ...form };
      if (hasGrade) {
        baseData.min_stock_grade = minStockGrade;
        baseData.min_stock = Object.values(minStockGrade).reduce((s, v) => s + (v || 0), 0);
        baseData.stock_grade = soladoGrade;
      }
      baseData.dimensions_length = plateLength;
      baseData.dimensions_width = plateWidth;
      baseData.dimensions_thickness = plateThickness;
      baseData.dimensions_unit = plateUnit;

      const validatedData = ProductSchema.parse(baseData);
      await updateProduct.mutateAsync({ id: product.id, data: validatedData as any });

      // Save component sheet
      const hasYieldData = Object.values(yieldPerSize).some(v => v > 0);
      const sheetData = {
        product_id: product.id,
        group_id: form.group_id || null,
        dimensions_length: plateLength,
        dimensions_width: plateWidth,
        dimensions_thickness: plateThickness,
        dimensions_unit: plateUnit,
        yield_per_size: yieldPerSize,
        waste_pct: wastePct,
      };
      if (existingSheet) {
        await updateComponentSheet.mutateAsync({ id: existingSheet.id, data: sheetData });
      } else if (hasYieldData) {
        await addComponentSheet.mutateAsync({ ...sheetData, notes: '' });
      }

      qc.invalidateQueries({ queryKey: ['product-detail', id] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['component_sheets'] });
      toast.success('Material salvo com sucesso');
    } catch (error) {
      if (error instanceof z.ZodError) {
        error.errors.forEach(err => toast.error(err.message));
      } else {
        toast.error('Erro ao salvar material');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!product) return;
    deleteProduct.mutate(product.id, {
      onSuccess: () => { toast.success('Material excluído'); navigate('/estoque'); },
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <p className="font-semibold text-foreground">Falha ao carregar dados</p>
          <p className="text-sm text-muted-foreground">Verifique sua conexão e recarregue a página.</p>
        </div>
      </AppLayout>
    );
  }

  if (!product) {
    return (
      <AppLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Material não encontrado</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/estoque')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar ao Estoque
          </Button>
        </div>
      </AppLayout>
    );
  }

  const groupName = groups.find(g => g.id === product.group_id)?.name || '—';

   return (
     <AppLayout>
       <div className="space-y-6 max-w-5xl">
         {/* Header */}
         <div className="flex items-center gap-4 flex-wrap mb-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/estoque')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Estoque
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold flex items-center gap-2 truncate">
              <Package className="h-5 w-5 text-primary shrink-0" />
              {stripColorFromName(product.name, product.color)}
              {product.color && <Badge variant="secondary">{product.color}</Badge>}
            </h1>
            <p className="text-sm text-muted-foreground font-mono">{product.sku}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar
            </Button>
            <DeleteConfirmButton onConfirm={handleDelete} title="Excluir material?" />
          </div>
        </div>

         <Tabs defaultValue="details" className="w-full">
           <TabsList className="grid w-full grid-cols-2 mb-6">
             <TabsTrigger value="details">Informações e Dados</TabsTrigger>
             <TabsTrigger value="history" className="gap-2">
               <History className="h-4 w-4" />
               Histórico e Ações
             </TabsTrigger>
           </TabsList>
 
           <TabsContent value="details" className="space-y-6">
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
           {/* Image */}
           <Card>
             <CardContent className="p-4 flex flex-col items-center gap-3">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name}
                  className="w-full max-h-64 object-contain rounded-lg cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                  onClick={() => setZoomOpen(true)} />
              ) : (
                <div className="w-full h-48 bg-muted rounded-lg flex items-center justify-center">
                  <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
                </div>
              )}
              <div className="w-full">
                <Label className="text-xs text-muted-foreground">URL da Imagem</Label>
                <Input value={form.image_url} onChange={e => update('image_url', e.target.value)} className="mt-1 text-xs" placeholder="https://..." />
              </div>
            </CardContent>
          </Card>

          {/* Basic Info */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3"><CardTitle className="text-base">Informações Básicas</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Nome *</Label>
                  <Input value={form.name} onChange={e => update('name', e.target.value)} className="mt-1" />
                </div>
                <div className="col-span-2">
                  <Label>Nome Técnico</Label>
                  <Textarea value={form.technical_name || ''} onChange={e => update('technical_name', e.target.value)} className="mt-1 min-h-[50px]" />
                </div>
                {!hasGrade && (
                  <div>
                    <Label>Cor</Label>
                    <Input value={form.color} onChange={e => update('color', e.target.value)} className="mt-1" />
                  </div>
                )}
                <div>
                  <Label>Código (SKU) *</Label>
                  <Input value={form.sku} onChange={e => update('sku', e.target.value)} className="mt-1 font-mono" />
                </div>
                <div>
                  <Label>Categoria *</Label>
                  <Select value={form.category} onValueChange={v => update('category', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {isSolado && (
                  <>
                    <div>
                      <Label>Material do Solado</Label>
                      <Input
                        value={form.sole_material || ''}
                        onChange={e => update('sole_material', e.target.value)}
                        placeholder="TR, PVC, etc."
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Altura do Salto (mm)</Label>
                      <NumberInput
                        value={form.heel_height || 0}
                        onChange={v => update('heel_height', v)}
                        className="mt-1"
                      />
                    </div>
                    <div className="col-span-2">
                      <Label>Fôrma Vinculada</Label>
                      <Select 
                        value={form.linked_last_id || 'none'} 
                        onValueChange={v => update('linked_last_id', v === 'none' ? null : v)}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Selecione a fôrma correspondente" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhuma fôrma vinculada</SelectItem>
                          {allProducts
                            .filter(p => p.category === 'Fôrma' || p.category === 'Ferramentas' || p.id === form.linked_last_id)
                            .map(p => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} {p.sku ? `(${p.sku})` : ''}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                <div>
                  <Label>Grupo</Label>
                  <Select value={form.group_id || 'none'} onValueChange={v => update('group_id', v === 'none' ? null : v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Sem grupo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem grupo</SelectItem>
                      {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Fornecedor</Label>
                  <Select value={form.supplier_id || 'none'} onValueChange={v => update('supplier_id', v === 'none' ? null : v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Sem fornecedor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem fornecedor</SelectItem>
                      {suppliers.filter(s => s.active).map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.trade_name || s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Unidade de Medida</Label>
                  <Select value={form.unit} onValueChange={v => update('unit', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Localização</Label>
                  <Select value={form.location} onValueChange={v => update('location', v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 pt-4">
                  <Switch id="active" checked={form.active} onCheckedChange={v => update('active', v)} />
                  <Label htmlFor="active">Material Ativo</Label>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Solado-specific */}
        {isSolado && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Cor do Solado</CardTitle></CardHeader>
            <CardContent>
              <Select value={soladoColor} onValueChange={setSoladoColor}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Selecione a cor" /></SelectTrigger>
                <SelectContent>
                  {SOLADO_COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

        {/* Grade de numeração */}
        {hasGrade && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Footprints className="h-4 w-4 text-primary" /> Grade de Numeração
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button type="button" variant={shoeCategory === 'adulto' ? 'default' : 'outline'} size="sm" onClick={() => setShoeCategory('adulto')}>
                  Adulto (34-40)
                </Button>
                <Button type="button" variant={shoeCategory === 'infantil' ? 'default' : 'outline'} size="sm" onClick={() => setShoeCategory('infantil')}>
                  Infantil (21-36)
                </Button>
              </div>
              <div>
                <Label className="text-xs font-semibold">Estoque por Tamanho (pares)</Label>
                <div className={`grid gap-2 mt-2 ${shoeCategory === 'infantil' ? 'grid-cols-8' : 'grid-cols-7'}`}>
                  {currentSizes.map(size => (
                    <div key={size} className="text-center">
                      <span className="text-xs text-muted-foreground font-medium">{size}</span>
                      <NumberInput min={0} step="1" value={soladoGrade[String(size)] || 0}
                        onChange={v => setSoladoGrade(prev => ({ ...prev, [String(size)]: v }))}
                        className="h-8 text-xs text-center px-1" />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Total: <span className="font-semibold text-foreground">{Object.values(soladoGrade).reduce((s, v) => s + (v || 0), 0)} pares</span>
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Estoque & Custo */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Estoque & Custo</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {!hasGrade && (
                <div>
                  <Label>Quantidade Atual</Label>
                  <NumberInput min={0} step="0.0001" value={form.quantity} onChange={v => update('quantity', v)} className="mt-1" />
                </div>
              )}
              {/* "Estoque Máximo" e "Estoque de Segurança" removidos em 2026-05 a
                  pedido do usuário — máximo não tinha uso e segurança duplicava
                  conceitualmente o mínimo. Colunas seguem no DB com default 0. */}
              <div>
                <Label>Custo Unitário (R$)</Label>
                <CurrencyInput value={form.unit_price} onChange={v => update('unit_price', v)} className="mt-1" />
              </div>
              <div>
                <Label>Cálculo de Consumo</Label>
                <Select value={normalizeCalculationMethod(form.calculation_method)} onValueChange={v => update('calculation_method', v as any)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weight">Por Peso (kg)</SelectItem>
                    <SelectItem value="meter">Por Metro (m/dm²)</SelectItem>
                    <SelectItem value="unit">Por Unidade (un/par/pc)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Lead Time (dias)</Label>
                <NumberInput value={form.lead_time_days ?? 7} onChange={v => update('lead_time_days', v)} min={0} step="1" className="mt-1" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Dimensões */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Dimensões do Material</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Altura</Label>
                <NumberInput value={plateLength} onChange={setPlateLength} min={0} step="0.1" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Largura</Label>
                <NumberInput value={plateWidth} onChange={setPlateWidth} min={0} step="0.1" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Espessura</Label>
                <NumberInput value={plateThickness} onChange={setPlateThickness} min={0} step="0.01" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Unidade</Label>
                <Select value={plateUnit} onValueChange={setPlateUnit}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mm">mm</SelectItem>
                    <SelectItem value="cm">cm</SelectItem>
                    <SelectItem value="m">m</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rendimento Técnico */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" /> Rendimento Técnico (dm²/par por numeração)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Consumo em dm² por par para cada numeração. Usado no cálculo de pares estimados no estoque.
            </p>
            <div className="flex gap-2 mb-2">
              <Button type="button" variant={shoeCategory === 'adulto' ? 'default' : 'outline'} size="sm" onClick={() => setShoeCategory('adulto')}>
                Adulto (34-40)
              </Button>
              <Button type="button" variant={shoeCategory === 'infantil' ? 'default' : 'outline'} size="sm" onClick={() => setShoeCategory('infantil')}>
                Infantil (21-36)
              </Button>
            </div>
            <div className={`grid gap-2 ${shoeCategory === 'infantil' ? 'grid-cols-8' : 'grid-cols-7'}`}>
              {currentSizes.map(size => (
                <div key={`yield-${size}`} className="text-center">
                  <span className="text-xs text-muted-foreground font-medium">{size}</span>
                  <NumberInput min={0} step="0.01" value={yieldPerSize[String(size)] || 0}
                    onChange={v => setYieldPerSize(prev => ({ ...prev, [String(size)]: v }))}
                    className="h-8 text-xs text-center px-1" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Perda / Desperdício (%)</Label>
                <NumberInput value={wastePct} onChange={setWastePct} min={0} step="0.5" className="mt-1" />
              </div>
              <div className="flex items-end">
                {existingSheet
                  ? <Badge variant="secondary" className="text-[10px]">Ficha existente</Badge>
                  : Object.values(yieldPerSize).some(v => v > 0)
                    ? <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Nova ficha será criada</Badge>
                    : <span className="text-xs text-muted-foreground italic">Sem ficha de componente</span>
                }
              </div>
            </div>
          </CardContent>
        </Card>
        
        {isSolado && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Footprints className="h-4 w-4 text-primary" /> Grade e Consumos de Forração / Palmilha
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Define as numerações deste solado e os consumos de forração e palmilha por par.
              </p>
            </CardHeader>
            <CardContent>
              <SoleTechnicalDetails
                soleId={product.id}
                soleName={stripColorFromName(product.name, product.color)}
              />
            </CardContent>
          </Card>
        )}

        {isSolado && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Footprints className="h-4 w-4 text-primary" /> Itens Padrão por Numeração
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure o consumo de cola, EVA, linha, solado, palmilha e outros itens comuns a todos os calçados com este solado.
                Esses valores são usados automaticamente como base na ficha técnica.
              </p>
            </CardHeader>
            <CardContent>
              <SoleStandardItemsPanel soleProductId={product.id} />
            </CardContent>
          </Card>
        )}

        {isSolado && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" /> Cadastro de Silk por Solado
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Artes de silk vinculadas a este solado. Podem ser diferenciadas por cliente ou grupo econômico.
              </p>
            </CardHeader>
            <CardContent>
              <SoleSilkPanel
                soleProductId={product.id}
                soleName={stripColorFromName(product.name, product.color)}
              />
            </CardContent>
          </Card>
        )}

        {/* Conversão Industrial */}

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Conversão Industrial & Reposição</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Unidade de Compra</Label>
                <Select value={normalizePurchaseUnit(form.purchase_unit)} onValueChange={v => update('purchase_unit', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PURCHASE_UNITS.map(u => <SelectItem key={u} value={u}>{u === 'metro' ? 'Metros' : u === 'm²' ? 'Metro quadrado (m²)' : u === 'dm²' ? 'Decímetro quadrado (dm²)' : u === 'chapa' ? 'Chapa/Folha' : u === 'kg' ? 'Quilo' : u === 'rolo' ? 'Rolo' : u === 'cx' ? 'Caixa' : 'Unidade'}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Unidade de Consumo</Label>
                <Select value={normalizeProductionUnit(form.production_unit)} onValueChange={v => update('production_unit', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRODUCTION_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Fator de Conversão</Label>
                <NumberInput value={form.conversion_rate ?? 1} onChange={v => update('conversion_rate', v)} min={0.0001} step="0.01" className="mt-1" />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  1 {normalizePurchaseUnit(form.purchase_unit)} = {form.conversion_rate ?? 1} {normalizeProductionUnit(form.production_unit)}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Unidade na OC</Label>
                <Select value={normalizePurchaseUnit(form.purchase_order_unit)} onValueChange={v => update('purchase_order_unit', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PURCHASE_UNITS.map(u => <SelectItem key={u} value={u}>{u === 'metro' ? 'Metros' : u === 'm²' ? 'Metro quadrado (m²)' : u === 'dm²' ? 'Decímetro quadrado (dm²)' : u === 'chapa' ? 'Chapa' : u === 'kg' ? 'Quilo' : u === 'rolo' ? 'Rolo' : u === 'cx' ? 'Caixa' : 'Unidade'}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Lote Mínimo de Compra</Label>
                <NumberInput value={form.min_order_quantity ?? 1} onChange={v => update('min_order_quantity', v)} min={0} step="1" className="mt-1" />
              </div>
            </div>
          </CardContent>
        </Card>

             {/* Lote & Químico */}
             <Card>
               <CardHeader className="pb-3"><CardTitle className="text-base">Rastreabilidade</CardTitle></CardHeader>
               <CardContent>
                 <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                   <div>
                     <Label>Nº do Lote</Label>
                     <Input value={form.lot_number || ''} onChange={e => update('lot_number', e.target.value || null)} className="mt-1" />
                   </div>
                   <div>
                     <Label>Data de Validade</Label>
                     <Input type="date" value={form.expiration_date || ''} onChange={e => update('expiration_date', e.target.value || null)} className="mt-1" />
                   </div>
                   <div className="flex items-center gap-3 pt-6">
                     <Switch id="is_chemical" checked={form.is_chemical ?? false} onCheckedChange={v => update('is_chemical', v)} />
                     <Label htmlFor="is_chemical">Produto Químico</Label>
                   </div>
                 </div>
               </CardContent>
             </Card>
           </TabsContent>
 
            <TabsContent value="history" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <StockMovementForm product={product} type="in" />
                <StockMovementForm product={product} type="out" />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Histórico de Movimentações</CardTitle>
                </CardHeader>
                <CardContent>
                  <StockHistory filterProductId={product.id} hideHeader={true} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
 
         {/* Bottom save bar */}
         <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t p-4 -mx-4 flex justify-end gap-3">
           <Button variant="outline" onClick={() => navigate('/estoque')}>Cancelar</Button>
           <Button onClick={handleSave} disabled={saving} className="gap-1.5">
             {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
             Salvar Alterações
           </Button>
         </div>
       </div>
 
       {/* Zoom dialog */}
       {product.image_url && (
         <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
           <DialogContent className="max-w-3xl p-2 bg-background/95 backdrop-blur-sm">
             <button className="absolute top-2 right-2 z-10 rounded-full bg-background/80 p-1.5 hover:bg-muted transition-colors" onClick={() => setZoomOpen(false)}>
               <X className="h-4 w-4" />
             </button>
             <div className="flex items-center justify-center min-h-[300px]">
               <img src={product.image_url} alt={product.name} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
             </div>
           </DialogContent>
         </Dialog>
       )}
     </AppLayout>
   );
 }
 
 function StockMovementForm({ product, type }: { product: Product, type: 'in' | 'out' }) {
   const qc = useQueryClient();
   const { data: profile } = useCurrentProfile();
   const [quantity, setQuantity] = useState(0);
   const [description, setDescription] = useState('');
   const [responsible, setResponsible] = useState('');
   const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
   const [lotNumber, setLotNumber] = useState(product.lot_number || '');
   const [loading, setLoading] = useState(false);
 
   const handleMovement = async () => {
     if (quantity <= 0) {
       toast.error('Informe uma quantidade válida');
       return;
     }
 
     setLoading(true);
     try {
       const prevStock = Number(product.quantity);
       const newStock = type === 'in' ? prevStock + quantity : prevStock - quantity;
 
       const finalResponsible = responsible || profile?.full_name || profile?.email || 'Sistema';
 
       const { error: moveError } = await supabase.from('stock_movements').insert({
         product_id: product.id,
         movement_type: type,
         quantity: quantity,
         previous_stock: prevStock,
         new_stock: newStock,
         description: description || (type === 'in' ? 'Entrada manual' : 'Saída manual'),
         lot_number: lotNumber,
         created_at: new Date(date).toISOString(),
         responsible: finalResponsible,
         user_email: profile?.email || null
       });
 
       if (moveError) throw moveError;
 
       const { error: prodError } = await supabase.from('products').update({ 
         quantity: newStock,
         lot_number: lotNumber || product.lot_number 
       }).eq('id', product.id);
       
       if (prodError) throw prodError;
 
       toast.success(type === 'in' ? 'Entrada registrada!' : 'Saída registrada!');
       setQuantity(0);
       setDescription('');
       qc.invalidateQueries({ queryKey: ['product-detail', product.id] });
       qc.invalidateQueries({ queryKey: ['stock_movements'] });
     } catch (error: any) {
       toast.error(`Erro: ${error.message}`);
     } finally {
       setLoading(false);
     }
   };
 
   return (
     <Card className={cn("border-l-4", type === 'in' ? "border-l-success" : "border-l-destructive")}>
       <CardHeader className="pb-2">
         <CardTitle className="text-sm flex items-center gap-2">
           {type === 'in' ? <PlusCircle className="h-4 w-4 text-success" /> : <MinusCircle className="h-4 w-4 text-destructive" />}
           Registrar {type === 'in' ? 'Entrada' : 'Saída'}
         </CardTitle>
       </CardHeader>
       <CardContent className="space-y-3">
         <div className="grid grid-cols-2 gap-3">
           <div className="space-y-1">
             <Label className="text-[10px] uppercase text-muted-foreground">Quantidade ({product.unit})</Label>
             <NumberInput value={quantity} onChange={setQuantity} min={0} step="0.0001" />
           </div>
           <div className="space-y-1">
             <Label className="text-[10px] uppercase text-muted-foreground">Data</Label>
             <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
           </div>
         </div>
         <div className="grid grid-cols-2 gap-3">
           <div className="space-y-1">
             <Label className="text-[10px] uppercase text-muted-foreground">Lote</Label>
             <Input value={lotNumber} onChange={e => setLotNumber(e.target.value)} placeholder="Opcional" />
           </div>
           <div className="space-y-1">
             <Label className="text-[10px] uppercase text-muted-foreground">Responsável</Label>
             <Input value={responsible} onChange={e => setResponsible(e.target.value)} placeholder="Nome..." />
           </div>
         </div>
         <div className="space-y-1">
           <Label className="text-[10px] uppercase text-muted-foreground">Motivo / Descrição</Label>
           <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Compra NF 123, Ajuste..." />
         </div>
         <Button
           className={cn("w-full mt-2", type === 'in' ? "bg-success hover:bg-success/90" : "")}
           variant={type === 'in' ? 'default' : 'destructive'}
           onClick={handleMovement}
           disabled={loading || quantity <= 0}
         >
           {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
           Confirmar {type === 'in' ? 'Entrada' : 'Saída'}
         </Button>
       </CardContent>
     </Card>
   );
 }
