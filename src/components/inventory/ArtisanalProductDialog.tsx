import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { FlaskConical, ArrowRight, Package, Scissors, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Product } from '@/types/inventory';
import { useContractors } from '@/hooks/useContractors';
import {
  useArtisanalRecipes,
  useCreateArtisanalRecipe,
  useUpdateArtisanalRecipe,
} from '@/hooks/useArtisanalRecipes';
import { useGroups } from '@/hooks/useGroups';

 interface Props {
   product?: Product | null;
   products?: Product[];
   open: boolean;
   onOpenChange: (open: boolean) => void;
 }

interface RecipeForm {
  isArtisanal: boolean;
  baseMaterial: string;
  yieldPerMeter: string;
  laborCostPerMeter: string;
  contractorId: string;
  notes: string;
}

const EMPTY_FORM: RecipeForm = {
  isArtisanal: false,
  baseMaterial: '',
  yieldPerMeter: '1',
  laborCostPerMeter: '0',
  contractorId: '',
  notes: '',
};

function useSetArtisanal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase
        .from('products')
        .update({ is_artisanal: value } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
    onError: (e: any) => toast.error(e.message),
  });
}

/** Derive the type/group name for a product (without color suffix) */
function getOutputName(product: Product, groupName?: string): string {
  if (groupName) return groupName;
  const name = product.name;
  const colonIdx = name.lastIndexOf(':');
  if (colonIdx > 0) return name.substring(0, colonIdx).trim();
  const dashIdx = name.lastIndexOf(' - ');
  if (dashIdx > 0) return name.substring(0, dashIdx).trim();
  return name;
}

 export function ArtisanalProductDialog({ product, products, open, onOpenChange }: Props) {
  const { data: recipes = [] } = useArtisanalRecipes();
  const { data: contractors = [] } = useContractors();
  const { data: groups = [] } = useGroups();
  const createRecipe = useCreateArtisanalRecipe();
  const updateRecipe = useUpdateArtisanalRecipe();
   const setArtisanal = useSetArtisanal();
   const targetProducts = products || (product ? [product] : []);
   const firstProduct = targetProducts[0];

  const [form, setForm] = useState<RecipeForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

   const groupName = firstProduct ? groups.find(g => g.id === firstProduct.group_id)?.name : undefined;
   const outputName = firstProduct ? getOutputName(firstProduct, groupName) : '';

  const existingRecipe = recipes.find(
    r => r.artisanal_product_name.toLowerCase() === outputName.toLowerCase()
  );

   useEffect(() => {
     if (targetProducts.length === 0 || !open) return;
     // If multiple products, check if at least one is artisanal or if recipe exists
     const isArt = targetProducts.some(p => (p as any).is_artisanal === true) || !!existingRecipe;
     setForm({
       isArtisanal: isArt,
       baseMaterial: existingRecipe?.base_product_name || '',
       yieldPerMeter: existingRecipe ? String(existingRecipe.yield_per_meter) : '1',
       laborCostPerMeter: existingRecipe ? String(existingRecipe.labor_cost_per_meter) : '0',
       contractorId: existingRecipe?.default_contractor_id || '',
       notes: existingRecipe?.notes || '',
     });
   }, [firstProduct?.id, open, targetProducts.length]);

  const set = <K extends keyof RecipeForm>(k: K, v: RecipeForm[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

   const handleSave = async () => {
     if (targetProducts.length === 0) return;
     setSaving(true);
     try {
       // Update all products in the batch
       await Promise.all(targetProducts.map(p => 
         setArtisanal.mutateAsync({ id: p.id, value: form.isArtisanal })
       ));
 
       if (form.isArtisanal) {
        if (!form.baseMaterial.trim()) {
          toast.error('Informe a matéria-prima base.');
          setSaving(false);
          return;
        }
        if (Number(form.yieldPerMeter) <= 0) {
          toast.error('Rendimento deve ser maior que zero.');
          setSaving(false);
          return;
        }

        const payload = {
          name: `Receita: ${outputName}`,
          artisanal_product_name: outputName,
          base_product_name: form.baseMaterial.trim(),
          yield_per_meter: Number(form.yieldPerMeter),
          labor_cost_per_meter: Number(form.laborCostPerMeter) || 0,
          default_contractor_id: form.contractorId || null,
          notes: form.notes.trim() || null,
          active: true,
        };

        if (existingRecipe) {
          await updateRecipe.mutateAsync({ id: existingRecipe.id, ...payload });
        } else {
          await createRecipe.mutateAsync(payload);
        }
      }

      toast.success(form.isArtisanal ? 'Produto marcado como artesanal!' : 'Produto desmarcado como artesanal.');
      onOpenChange(false);
    } catch {
      // errors handled by individual mutation hooks
    } finally {
      setSaving(false);
    }
  };

  const yieldNum = Number(form.yieldPerMeter);

   if (targetProducts.length === 0) return null;
 
   return (
     <Dialog open={open} onOpenChange={onOpenChange}>
       <DialogContent className="max-w-md">
         <DialogHeader>
           <DialogTitle className="flex items-center gap-2">
             <FlaskConical className="h-5 w-5 text-primary" />
             Produção Artesanal
           </DialogTitle>
         </DialogHeader>
 
         <div className="space-y-4">
           {/* Product summary */}
           <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
             {targetProducts.length === 1 ? (
               <>
                 <p className="font-semibold text-sm leading-snug">{firstProduct.name}</p>
                 {firstProduct.color && (
                   <p className="text-xs text-muted-foreground">Cor: {firstProduct.color}</p>
                 )}
               </>
             ) : (
               <p className="font-semibold text-sm leading-snug">
                 Grupo: {outputName} ({targetProducts.length} itens)
               </p>
             )}
             <p className="text-xs text-muted-foreground">
               Tipo: <span className="font-medium text-foreground">{outputName}</span>
             </p>
           </div>

          {/* Toggle */}
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <Label className="font-medium cursor-pointer">Este produto é artesanal</Label>
            <Switch
              checked={form.isArtisanal}
              onCheckedChange={v => set('isArtisanal', v)}
            />
          </div>

          {form.isArtisanal && (
            <>
              {/* Visual conversion diagram */}
              <div className="flex items-center gap-2 text-sm">
                <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 rounded px-2 py-1.5 flex-1 min-w-0">
                  <Package className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-xs font-medium">
                    {form.baseMaterial || '(matéria-prima)'}
                  </span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 rounded px-2 py-1.5 flex-1 min-w-0">
                  <Scissors className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-xs font-medium">{outputName}</span>
                </div>
              </div>

              <Separator />

              {/* Fields */}
              <div className="space-y-3">
                 <div className="space-y-1">
                   <Label className="text-xs text-muted-foreground">Grupo de matéria-prima base</Label>
                   <Select
                     value={form.baseMaterial}
                     onValueChange={v => set('baseMaterial', v)}
                   >
                     <SelectTrigger className="h-9">
                       <SelectValue placeholder="Selecione o grupo base..." />
                     </SelectTrigger>
                     <SelectContent>
                       {groups.map(g => (
                         <SelectItem key={g.id} value={g.name}>{g.name}</SelectItem>
                       ))}
                     </SelectContent>
                   </Select>
                 </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Rendimento (m saída / m base)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0.01}
                      value={form.yieldPerMeter}
                      onChange={e => set('yieldPerMeter', e.target.value)}
                      className="h-9 font-mono"
                      placeholder="Ex: 88"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Custo MO / metro (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={form.laborCostPerMeter}
                      onChange={e => set('laborCostPerMeter', e.target.value)}
                      className="h-9 font-mono"
                      placeholder="0,00"
                    />
                  </div>
                </div>

                {/* Yield preview */}
                {form.baseMaterial.trim() && yieldNum > 0 && (
                  <div className="rounded bg-primary/5 border border-primary/20 px-3 py-2 text-xs">
                    1 m de{' '}
                    <span className="font-semibold">{form.baseMaterial}</span>
                    {' → '}
                    <span className="font-semibold text-primary">{yieldNum} m</span>
                    {' de '}
                    <span className="font-semibold">{outputName}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Terceirizado padrão</Label>
                  <Select
                    value={form.contractorId || 'none'}
                    onValueChange={v => set('contractorId', v === 'none' ? '' : v)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Selecione o prestador..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {contractors.filter(c => c.active).map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Notas</Label>
                  <Textarea
                    value={form.notes}
                    onChange={e => set('notes', e.target.value)}
                    className="resize-none h-16 text-sm"
                    placeholder="Observações sobre a produção artesanal..."
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
