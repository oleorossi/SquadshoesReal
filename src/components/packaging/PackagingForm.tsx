import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useProducts } from '@/hooks/useProducts';
import { useSuppliers } from '@/hooks/useSuppliers';

const packagingSchema = z.object({
  product_reference: z.string().min(1, 'Referência do produto é obrigatória'),
  product_name: z.string().min(1, 'Nome do produto é obrigatório'),
  packaging_type: z.enum(['box', 'bag', 'bottle', 'tube', 'jar', 'blister', 'sachet', 'other']),
  material: z.enum(['cardboard', 'plastic', 'glass', 'metal', 'paper', 'composite']),
  dimensions_length: z.number().min(0.1, 'Comprimento deve ser maior que 0'),
  dimensions_width: z.number().min(0.1, 'Largura deve ser maior que 0'),
  dimensions_height: z.number().min(0.1, 'Altura deve ser maior que 0'),
  dimensions_weight: z.number().min(0.1, 'Peso deve ser maior que 0'),
  color: z.string().optional(),
  finish: z.string().optional(),
  supplier_id: z.string().optional(),
  unit_cost: z.number().min(0),
  minimum_stock: z.number().min(0),
  current_stock: z.number().min(0),
  barcode: z.string().optional(),
  internal_code: z.string().min(1, 'Código interno é obrigatório'),
  notes: z.string().optional(),
  is_active: z.boolean(),
});

type PackagingFormData = z.infer<typeof packagingSchema>;

interface PackagingFormProps {
  initialData?: Record<string, any> | null;
  onSubmit: (data: any) => Promise<void> | void;
  isLoading?: boolean;
}

const PackagingForm = ({ initialData, onSubmit, isLoading }: PackagingFormProps) => {
  const { data: products = [] } = useProducts();
  const { data: suppliers = [] } = useSuppliers();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PackagingFormData>({
    resolver: zodResolver(packagingSchema),
    defaultValues: {
      product_reference: initialData?.product_reference || '',
      product_name: initialData?.product_name || '',
      packaging_type: initialData?.packaging_type || 'box',
      material: initialData?.material || 'cardboard',
      dimensions_length: initialData?.dimensions?.length || 0,
      dimensions_width: initialData?.dimensions?.width || 0,
      dimensions_height: initialData?.dimensions?.height || 0,
      dimensions_weight: initialData?.dimensions?.weight || 0,
      color: initialData?.color || '',
      finish: initialData?.finish || '',
      supplier_id: initialData?.supplier_id || '',
      unit_cost: initialData?.unit_cost || 0,
      minimum_stock: initialData?.minimum_stock || 0,
      current_stock: initialData?.current_stock || 0,
      barcode: initialData?.barcode || '',
      internal_code: initialData?.internal_code || '',
      notes: initialData?.notes || '',
      is_active: initialData?.is_active ?? true,
    },
  });

  const l = watch('dimensions_length') || 0;
  const w = watch('dimensions_width') || 0;
  const h = watch('dimensions_height') || 0;
  const calculatedVolume = l * w * h;

  const handleFormSubmit = async (data: PackagingFormData) => {
    await onSubmit({
      product_reference: data.product_reference,
      product_name: data.product_name,
      packaging_type: data.packaging_type,
      material: data.material,
      internal_code: data.internal_code,
      dimensions: {
        length: data.dimensions_length,
        width: data.dimensions_width,
        height: data.dimensions_height,
        weight: data.dimensions_weight,
        volume: calculatedVolume,
      },
      unit_cost: data.unit_cost,
      minimum_stock: data.minimum_stock,
      current_stock: data.current_stock,
      supplier_name: suppliers.find(s => s.id === data.supplier_id)?.name || null,
      notes: data.notes || null,
      is_active: data.is_active,
    });
  };

  const handleProductSelect = (sku: string) => {
    const selected = products.find((p: any) => p.sku === sku);
    if (selected) {
      setValue('product_reference', selected.sku);
      setValue('product_name', selected.name);
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      {/* Produto */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Produto</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Produto</Label>
            <Select onValueChange={handleProductSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar produto..." />
              </SelectTrigger>
              <SelectContent>
                {products.map((p: any) => (
                  <SelectItem key={p.id} value={p.sku}>
                    {p.name} ({p.sku})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Código Interno</Label>
            <Input {...register('internal_code')} />
            {errors.internal_code && <p className="text-xs text-destructive">{errors.internal_code.message}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Referência</Label>
            <Input {...register('product_reference')} />
            {errors.product_reference && <p className="text-xs text-destructive">{errors.product_reference.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Nome do Produto</Label>
            <Input {...register('product_name')} />
            {errors.product_name && <p className="text-xs text-destructive">{errors.product_name.message}</p>}
          </div>
        </div>
      </div>

      {/* Tipo e Material */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Tipo e Material</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Tipo de Embalagem</Label>
            <Select value={watch('packaging_type')} onValueChange={v => setValue('packaging_type', v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="box">Caixa</SelectItem>
                <SelectItem value="bag">Sacola</SelectItem>
                <SelectItem value="bottle">Garrafa</SelectItem>
                <SelectItem value="tube">Tubo</SelectItem>
                <SelectItem value="jar">Pote</SelectItem>
                <SelectItem value="blister">Blister</SelectItem>
                <SelectItem value="sachet">Sachê</SelectItem>
                <SelectItem value="other">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Material</Label>
            <Select value={watch('material')} onValueChange={v => setValue('material', v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cardboard">Papelão</SelectItem>
                <SelectItem value="plastic">Plástico</SelectItem>
                <SelectItem value="glass">Vidro</SelectItem>
                <SelectItem value="metal">Metal</SelectItem>
                <SelectItem value="paper">Papel</SelectItem>
                <SelectItem value="composite">Composto</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Dimensões */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Dimensões</h3>
        <div className="grid grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Comprimento (cm)</Label>
            <Input type="number" step="0.1" {...register('dimensions_length', { valueAsNumber: true })} />
            {errors.dimensions_length && <p className="text-xs text-destructive">{errors.dimensions_length.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Largura (cm)</Label>
            <Input type="number" step="0.1" {...register('dimensions_width', { valueAsNumber: true })} />
            {errors.dimensions_width && <p className="text-xs text-destructive">{errors.dimensions_width.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Altura (cm)</Label>
            <Input type="number" step="0.1" {...register('dimensions_height', { valueAsNumber: true })} />
            {errors.dimensions_height && <p className="text-xs text-destructive">{errors.dimensions_height.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Peso (g)</Label>
            <Input type="number" step="0.1" {...register('dimensions_weight', { valueAsNumber: true })} />
            {errors.dimensions_weight && <p className="text-xs text-destructive">{errors.dimensions_weight.message}</p>}
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <span className="text-muted-foreground">Volume calculado: </span>
          <span className="font-mono font-semibold">{calculatedVolume.toLocaleString()} cm³</span>
        </div>
      </div>

      {/* Estoque e Custo */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Estoque e Custo</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Custo Unitário (R$)</Label>
            <Input type="number" step="0.0001" {...register('unit_cost', { valueAsNumber: true })} />
          </div>
          <div className="space-y-2">
            <Label>Estoque Atual</Label>
            <Input type="number" {...register('current_stock', { valueAsNumber: true })} />
          </div>
          <div className="space-y-2">
            <Label>Estoque Mínimo</Label>
            <Input type="number" {...register('minimum_stock', { valueAsNumber: true })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Fornecedor</Label>
            <Select value={watch('supplier_id')} onValueChange={v => setValue('supplier_id', v)}>
              <SelectTrigger><SelectValue placeholder="Selecionar fornecedor..." /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Código de Barras</Label>
            <Input {...register('barcode')} />
          </div>
        </div>
      </div>

      {/* Observações */}
      <div className="space-y-2">
        <Label>Observações</Label>
        <Textarea {...register('notes')} rows={3} />
      </div>

      {/* Ativo */}
      <div className="flex items-center gap-3">
        <Switch
          checked={watch('is_active')}
          onCheckedChange={v => setValue('is_active', v)}
        />
        <Label>Embalagem ativa</Label>
      </div>

      <Button type="submit" disabled={isLoading} className="w-full">
        {initialData ? 'Salvar Alterações' : 'Criar Embalagem'}
      </Button>
    </form>
  );
};

export default PackagingForm;
