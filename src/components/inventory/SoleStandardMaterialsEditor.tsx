/**
 * Editor de consumos padrão de um grupo de solado.
 *
 * Permite o usuário cadastrar materiais (cola, linha, forração, palmilha, etc.)
 * com seu consumo por par. Quando a ficha técnica selecionar esse solado,
 * o sistema automaticamente puxa esses materiais pro BOM da ficha
 * (auto-fill respeita applies_to vs sole_classification).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Package2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  soleGroupId: string;
  /** Classificação do solado pra orientar quais materiais sugerir (não bloqueia) */
  soleClassification?: 'tradicional' | 'palmilha_pronta' | 'conjugado';
}

type AppliesTo = 'any' | 'palmilha_cortada' | 'palmilha_pronta';

interface StandardMaterial {
  id: string;
  sole_group_id: string;
  material_product_id: string;
  consumption_per_pair: number;
  unit_override: string | null;
  applies_to: AppliesTo;
  notes: string | null;
  display_order: number;
  // join
  products?: { name: string; unit: string; sku: string | null; category: string };
}

const APPLIES_TO_LABEL: Record<AppliesTo, string> = {
  any: 'Sempre',
  palmilha_cortada: 'Palmilha cortada (Tipo 1 + 3)',
  palmilha_pronta: 'Palmilha pronta (Tipo 2)',
};

const APPLIES_TO_BADGE: Record<AppliesTo, string> = {
  any: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800',
  palmilha_cortada: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800',
  palmilha_pronta: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-800',
};

export function SoleStandardMaterialsEditor({ soleGroupId, soleClassification }: Props) {
  const qc = useQueryClient();
  const [showAddRow, setShowAddRow] = useState(false);
  const [newMaterial, setNewMaterial] = useState<{
    productId: string;
    qty: number;
    unit: string;
    appliesTo: AppliesTo;
    notes: string;
  }>({
    productId: '',
    qty: 0,
    unit: '',
    appliesTo: 'any',
    notes: '',
  });

  // Lista os materiais padrão atuais
  const { data: materials = [], isLoading } = useQuery({
    queryKey: ['sole_standard_materials', soleGroupId],
    enabled: !!soleGroupId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sole_standard_materials')
        .select('*, products!material_product_id(name, unit, sku, category)')
        .eq('sole_group_id', soleGroupId)
        .order('display_order')
        .order('created_at');
      if (error) throw error;
      return (data || []) as StandardMaterial[];
    },
  });

  // Lista produtos que podem ser materiais padrão (exclui categoria Solado)
  const { data: availableProducts = [] } = useQuery({
    queryKey: ['products_for_standard_materials'],
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, sku, unit, category')
        .eq('active', true)
        .neq('category', 'Solado')
        .order('category')
        .order('name')
        .limit(500);
      return (data || []) as Array<{ id: string; name: string; sku: string | null; unit: string; category: string }>;
    },
    staleTime: 5 * 60_000,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!newMaterial.productId) throw new Error('Selecione o material.');
      if (newMaterial.qty <= 0) throw new Error('Consumo deve ser maior que zero.');
      const { error } = await (supabase as any).from('sole_standard_materials').insert({
        sole_group_id: soleGroupId,
        material_product_id: newMaterial.productId,
        consumption_per_pair: newMaterial.qty,
        unit_override: newMaterial.unit || null,
        applies_to: newMaterial.appliesTo,
        notes: newMaterial.notes || null,
        display_order: materials.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sole_standard_materials', soleGroupId] });
      setNewMaterial({ productId: '', qty: 0, unit: '', appliesTo: 'any', notes: '' });
      setShowAddRow(false);
      toast.success('Material padrão adicionado.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('sole_standard_materials').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sole_standard_materials', soleGroupId] });
      toast.success('Material removido.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<StandardMaterial> }) => {
      const { error } = await (supabase as any).from('sole_standard_materials').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sole_standard_materials', soleGroupId] }),
    onError: (err: Error) => toast.error(err.message),
  });

  if (!soleGroupId) {
    return (
      <div className="text-xs text-muted-foreground italic p-3 rounded border border-dashed">
        Salve o solado primeiro pra cadastrar consumos padrão.
      </div>
    );
  }

  // Agrupa por applies_to pra organizar visualmente
  const grouped = {
    any: materials.filter(m => m.applies_to === 'any'),
    palmilha_cortada: materials.filter(m => m.applies_to === 'palmilha_cortada'),
    palmilha_pronta: materials.filter(m => m.applies_to === 'palmilha_pronta'),
  };

  const productById = (id: string) => availableProducts.find(p => p.id === id);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h4 className="text-sm font-bold flex items-center gap-2">
            <Package2 className="h-4 w-4 text-primary" />
            Consumos padrão por par
          </h4>
          <p className="text-[11px] text-muted-foreground">
            Materiais que aparecem automaticamente no BOM de toda ficha técnica que usar este solado.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowAddRow(true)}>
          <Plus className="h-3 w-3" /> Adicionar material
        </Button>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground italic">Carregando…</div>}

      {!isLoading && materials.length === 0 && !showAddRow && (
        <div className="text-center py-6 px-4 rounded border border-dashed text-xs text-muted-foreground">
          Nenhum material padrão cadastrado.
          <br />
          <span className="text-[10px]">Ex.: Cola PU 0,02 kg/par · Linha 60 1,5 m/par · Forro 4 dm²/par</span>
        </div>
      )}

      {/* Linha de adição inline */}
      {showAddRow && (
        <div className="rounded border-2 border-primary/30 bg-primary/5 p-3 space-y-2 animate-in fade-in slide-in-from-top-1">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="md:col-span-5">
              <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Material</Label>
              <Select
                value={newMaterial.productId}
                onValueChange={(v) => {
                  const prod = productById(v);
                  setNewMaterial({ ...newMaterial, productId: v, unit: prod?.unit || '' });
                }}
              >
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {availableProducts.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="text-xs"><strong>{p.name}</strong> · <span className="text-muted-foreground">{p.category}</span></span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Qtd/par</Label>
              <NumberInput
                value={newMaterial.qty}
                onChange={v => setNewMaterial({ ...newMaterial, qty: v })}
                step="0.0001"
                min={0}
                className="h-8 text-xs mt-0.5"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Unidade</Label>
              <Input
                value={newMaterial.unit}
                onChange={e => setNewMaterial({ ...newMaterial, unit: e.target.value })}
                placeholder="kg, m, dm²..."
                className="h-8 text-xs mt-0.5"
              />
            </div>
            <div className="md:col-span-3">
              <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Aplicar quando</Label>
              <Select value={newMaterial.appliesTo} onValueChange={(v) => setNewMaterial({ ...newMaterial, appliesTo: v as AppliesTo })}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Sempre</SelectItem>
                  <SelectItem value="palmilha_cortada">Só palmilha cortada</SelectItem>
                  <SelectItem value="palmilha_pronta">Só palmilha pronta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Input
            value={newMaterial.notes}
            onChange={e => setNewMaterial({ ...newMaterial, notes: e.target.value })}
            placeholder="Observação (opcional)"
            className="h-7 text-[11px]"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddRow(false)}>Cancelar</Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
              {addMutation.isPending ? 'Salvando…' : 'Adicionar'}
            </Button>
          </div>
        </div>
      )}

      {/* Lista agrupada por applies_to */}
      {(['any', 'palmilha_cortada', 'palmilha_pronta'] as AppliesTo[]).map(group => {
        const items = grouped[group];
        if (items.length === 0) return null;
        const isHighlighted = soleClassification && (
          (group === 'any') ||
          (group === 'palmilha_cortada' && (soleClassification === 'tradicional' || soleClassification === 'conjugado')) ||
          (group === 'palmilha_pronta' && soleClassification === 'palmilha_pronta')
        );
        return (
          <div key={group} className={cn(
            'rounded border overflow-hidden transition-opacity',
            isHighlighted ? 'opacity-100 border-border' : 'opacity-50 border-dashed'
          )}>
            <div className="px-3 py-1.5 bg-muted/40 flex items-center justify-between">
              <Badge variant="outline" className={cn('text-[10px] h-5', APPLIES_TO_BADGE[group])}>
                {APPLIES_TO_LABEL[group]}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {items.length} {items.length === 1 ? 'material' : 'materiais'}
              </span>
            </div>
            <div className="divide-y">
              {items.map(m => (
                <div key={m.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/20">
                  <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate">{m.products?.name || '—'}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                      {m.products?.sku && <span>SKU {m.products.sku}</span>}
                      {m.products?.category && <span>· {m.products.category}</span>}
                      {m.notes && <span className="italic">· {m.notes}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <NumberInput
                      value={m.consumption_per_pair}
                      onChange={v => updateMutation.mutate({ id: m.id, patch: { consumption_per_pair: v } })}
                      step="0.0001"
                      min={0}
                      className="h-7 w-20 text-xs text-right font-mono"
                    />
                  </div>
                  <Input
                    value={m.unit_override || m.products?.unit || ''}
                    onChange={e => updateMutation.mutate({ id: m.id, patch: { unit_override: e.target.value || null } })}
                    className="h-7 w-16 text-xs"
                    placeholder="un"
                  />
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => removeMutation.mutate(m.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
