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
import { Plus, Trash2, Package2, Copy, ArrowUp, ArrowDown, Send, Check } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
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
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [copyFromGroupId, setCopyFromGroupId] = useState<string>('');
  const [copyOverwrite, setCopyOverwrite] = useState(false);
  // Cópia INVERSA: aplicar consumos DESTE solado em outros (selecionados)
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [applyTargetIds, setApplyTargetIds] = useState<Set<string>>(new Set());
  const [applyOverwrite, setApplyOverwrite] = useState(false);
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

  // Outros grupos de solado que TÊM consumos cadastrados (pra dropdown de cópia)
  const { data: groupsWithMaterials = [] } = useQuery({
    queryKey: ['sole_groups_with_standard_materials', soleGroupId],
    queryFn: async () => {
      const { data: matRows } = await (supabase as any)
        .from('sole_standard_materials')
        .select('sole_group_id, product_groups!sole_group_id(id, name)')
        .neq('sole_group_id', soleGroupId);
      const uniq = new Map<string, { id: string; name: string; count: number }>();
      for (const r of (matRows || []) as any[]) {
        const g = r.product_groups;
        if (!g) continue;
        const ex = uniq.get(g.id) || { id: g.id, name: g.name, count: 0 };
        ex.count += 1;
        uniq.set(g.id, ex);
      }
      return Array.from(uniq.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!soleGroupId,
    staleTime: 60_000,
  });

  // TODOS os grupos de solado (pra "Aplicar este em outros")
  const { data: allOtherSoleGroups = [] } = useQuery({
    queryKey: ['all_sole_groups_except', soleGroupId],
    queryFn: async () => {
      // Pega grupos que contêm pelo menos 1 produto category=Solado
      const { data: prods } = await supabase
        .from('products')
        .select('group_id, product_groups!group_id(id, name)')
        .eq('category', 'Solado')
        .eq('active', true)
        .neq('group_id', soleGroupId);
      const uniq = new Map<string, { id: string; name: string }>();
      for (const p of (prods || []) as any[]) {
        const g = p.product_groups;
        if (g && !uniq.has(g.id)) uniq.set(g.id, { id: g.id, name: g.name });
      }
      return Array.from(uniq.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!soleGroupId,
    staleTime: 60_000,
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

  // Copia todos os consumos de OUTRO grupo pra este grupo. Estratégia:
  // - Se copyOverwrite=true: deleta atuais antes de inserir
  // - Senão: insere só os que NÃO existem (por material_product_id + applies_to)
  const copyMutation = useMutation({
    mutationFn: async () => {
      if (!copyFromGroupId) throw new Error('Selecione o solado de origem.');
      const { data: source, error: srcErr } = await (supabase as any)
        .from('sole_standard_materials')
        .select('material_product_id, consumption_per_pair, unit_override, applies_to, notes, display_order')
        .eq('sole_group_id', copyFromGroupId);
      if (srcErr) throw srcErr;
      if (!source || source.length === 0) throw new Error('Solado de origem não tem materiais.');

      if (copyOverwrite) {
        await (supabase as any).from('sole_standard_materials').delete().eq('sole_group_id', soleGroupId);
      } else {
        // Pula duplicados pra evitar erro de UNIQUE constraint
        const existingKeys = new Set(
          materials.map(m => `${m.material_product_id}|${m.applies_to}`)
        );
        source.forEach((r: any, i: number) => {
          r._key = `${r.material_product_id}|${r.applies_to}`;
          r._displayOrderOffset = materials.length + i;
        });
        source.splice(0, source.length, ...source.filter((r: any) => !existingKeys.has(r._key)));
      }

      const rowsToInsert = source.map((r: any, i: number) => ({
        sole_group_id: soleGroupId,
        material_product_id: r.material_product_id,
        consumption_per_pair: r.consumption_per_pair,
        unit_override: r.unit_override,
        applies_to: r.applies_to,
        notes: r.notes,
        display_order: copyOverwrite ? i : (materials.length + i),
      }));
      if (rowsToInsert.length === 0) {
        throw new Error('Todos os materiais já estão cadastrados (sem duplicados pra inserir).');
      }
      const { error } = await (supabase as any).from('sole_standard_materials').insert(rowsToInsert);
      if (error) throw error;
      return rowsToInsert.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['sole_standard_materials', soleGroupId] });
      toast.success(`${count} material(is) copiado(s).`);
      setShowCopyDialog(false);
      setCopyFromGroupId('');
      setCopyOverwrite(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Cópia INVERSA: aplica os materiais DESTE solado nos solados selecionados
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (applyTargetIds.size === 0) throw new Error('Selecione pelo menos um solado destino.');
      if (materials.length === 0) throw new Error('Este solado não tem materiais pra aplicar.');

      let totalInserted = 0;
      for (const targetGroupId of applyTargetIds) {
        if (applyOverwrite) {
          await (supabase as any).from('sole_standard_materials').delete().eq('sole_group_id', targetGroupId);
        }
        // Lê o que já existe no destino pra evitar duplicar (modo "merge")
        let existingKeys = new Set<string>();
        if (!applyOverwrite) {
          const { data: existing } = await (supabase as any)
            .from('sole_standard_materials')
            .select('material_product_id, applies_to')
            .eq('sole_group_id', targetGroupId);
          existingKeys = new Set((existing || []).map((r: any) => `${r.material_product_id}|${r.applies_to}`));
        }
        const rows = materials
          .filter(m => !existingKeys.has(`${m.material_product_id}|${m.applies_to}`))
          .map((m, i) => ({
            sole_group_id: targetGroupId,
            material_product_id: m.material_product_id,
            consumption_per_pair: m.consumption_per_pair,
            unit_override: m.unit_override,
            applies_to: m.applies_to,
            notes: m.notes,
            display_order: i,
          }));
        if (rows.length === 0) continue;
        const { error } = await (supabase as any).from('sole_standard_materials').insert(rows);
        if (error) throw error;
        totalInserted += rows.length;
      }
      return totalInserted;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['sole_groups_with_standard_materials'] });
      toast.success(`${count} material(is) aplicado(s) em ${applyTargetIds.size} solado(s).`);
      setShowApplyDialog(false);
      setApplyTargetIds(new Set());
      setApplyOverwrite(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Reordena via display_order: swap entre o item alvo e o adjacente
  const reorderMutation = useMutation({
    mutationFn: async ({ id, direction }: { id: string; direction: 'up' | 'down' }) => {
      const flat = materials; // já vem ordenado por display_order
      const idx = flat.findIndex(m => m.id === id);
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (idx < 0 || targetIdx < 0 || targetIdx >= flat.length) return;
      const a = flat[idx];
      const b = flat[targetIdx];
      // Swap display_order
      await Promise.all([
        (supabase as any).from('sole_standard_materials').update({ display_order: b.display_order }).eq('id', a.id),
        (supabase as any).from('sole_standard_materials').update({ display_order: a.display_order }).eq('id', b.id),
      ]);
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
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5 min-w-0">
          <h4 className="text-sm font-bold flex items-center gap-2">
            <Package2 className="h-4 w-4 text-primary" />
            Consumos padrão por par
          </h4>
          <p className="text-[11px] text-muted-foreground">
            Materiais que aparecem automaticamente no BOM de toda ficha técnica que usar este solado.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {groupsWithMaterials.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowCopyDialog(true)}>
              <Copy className="h-3 w-3" /> Copiar de outro
            </Button>
          )}
          {materials.length > 0 && allOtherSoleGroups.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowApplyDialog(true)}>
              <Send className="h-3 w-3" /> Aplicar em outros
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowAddRow(true)}>
            <Plus className="h-3 w-3" /> Adicionar material
          </Button>
        </div>
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
              <div className="flex items-center gap-1">
                <Label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Aplicar quando</Label>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground">
                        <HelpCircle className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      <div className="space-y-1.5">
                        <div><strong>Sempre:</strong> material entra no BOM em qualquer ficha que usar este solado. Use pra cola, linha, embalagem.</div>
                        <div><strong>Só palmilha cortada:</strong> entra só quando o solado é Tipo 1 (tradicional) ou Tipo 3 (conjugado). Use pra forração, palmilha em dm².</div>
                        <div><strong>Só palmilha pronta:</strong> entra só quando o solado é Tipo 2. Use pra reforços/etiquetas exclusivos desse tipo.</div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
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
              {items.map((m, idxInGroup) => {
                const flatIdx = materials.findIndex(x => x.id === m.id);
                const canMoveUp = flatIdx > 0;
                const canMoveDown = flatIdx >= 0 && flatIdx < materials.length - 1;
                void idxInGroup;
                return (
                <div key={m.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/20">
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      type="button"
                      className="h-4 w-4 flex items-center justify-center rounded hover:bg-muted disabled:opacity-30"
                      disabled={!canMoveUp}
                      onClick={() => reorderMutation.mutate({ id: m.id, direction: 'up' })}
                      title="Mover pra cima"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="h-4 w-4 flex items-center justify-center rounded hover:bg-muted disabled:opacity-30"
                      disabled={!canMoveDown}
                      onClick={() => reorderMutation.mutate({ id: m.id, direction: 'down' })}
                      title="Mover pra baixo"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>
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
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Dialog: copiar consumos de outro solado */}
      <Dialog open={showCopyDialog} onOpenChange={setShowCopyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Copiar consumos de outro solado</DialogTitle>
            <DialogDescription className="text-xs">
              Acelera o cadastro quando vários solados compartilham os mesmos materiais (cola, linha, etc).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Solado de origem</Label>
              <Select value={copyFromGroupId} onValueChange={setCopyFromGroupId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione um solado..." /></SelectTrigger>
                <SelectContent>
                  {groupsWithMaterials.map(g => (
                    <SelectItem key={g.id} value={g.id}>
                      <span className="text-sm">{g.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-2">({g.count} {g.count === 1 ? 'material' : 'materiais'})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start gap-2 p-2 rounded border bg-muted/30">
              <input
                type="checkbox"
                id="copy-overwrite"
                checked={copyOverwrite}
                onChange={e => setCopyOverwrite(e.target.checked)}
                className="mt-0.5"
              />
              <label htmlFor="copy-overwrite" className="text-xs cursor-pointer">
                <strong>Sobrescrever materiais atuais</strong>
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  Se marcado, remove os materiais existentes deste solado antes de copiar. Caso contrário, só adiciona os que faltam (sem duplicar).
                </span>
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowCopyDialog(false)}>Cancelar</Button>
            <Button size="sm" onClick={() => copyMutation.mutate()} disabled={!copyFromGroupId || copyMutation.isPending}>
              {copyMutation.isPending ? 'Copiando…' : copyOverwrite ? 'Substituir e copiar' : 'Copiar faltantes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: aplicar consumos DESTE solado em outros (cópia inversa em lote) */}
      <Dialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Aplicar materiais em outros solados</DialogTitle>
            <DialogDescription className="text-xs">
              Copia os {materials.length} material(is) deste solado pra todos os solados que você selecionar.
              Útil quando você cadastra "Cola PU + Linha 60 + Forração X" e quer aplicar em N solados similares de uma vez.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Solados destino ({applyTargetIds.size} selecionado{applyTargetIds.size === 1 ? '' : 's'})
              </Label>
              <div className="mt-1 max-h-64 overflow-y-auto rounded border divide-y">
                {allOtherSoleGroups.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground italic">Não há outros solados cadastrados.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2 p-2 bg-muted/40 hover:bg-muted/60">
                      <Checkbox
                        checked={applyTargetIds.size === allOtherSoleGroups.length}
                        onCheckedChange={(v) => {
                          if (v) setApplyTargetIds(new Set(allOtherSoleGroups.map(g => g.id)));
                          else setApplyTargetIds(new Set());
                        }}
                      />
                      <span className="text-xs font-semibold">Selecionar todos</span>
                    </div>
                    {allOtherSoleGroups.map(g => {
                      const checked = applyTargetIds.has(g.id);
                      return (
                        <label key={g.id} className="flex items-center gap-2 p-2 hover:bg-muted/40 cursor-pointer">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              const next = new Set(applyTargetIds);
                              if (v) next.add(g.id); else next.delete(g.id);
                              setApplyTargetIds(next);
                            }}
                          />
                          <span className="text-xs">{g.name}</span>
                          {checked && <Check className="h-3 w-3 ml-auto text-primary" />}
                        </label>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2 p-2 rounded border bg-muted/30">
              <Checkbox
                id="apply-overwrite"
                checked={applyOverwrite}
                onCheckedChange={(v) => setApplyOverwrite(!!v)}
                className="mt-0.5"
              />
              <label htmlFor="apply-overwrite" className="text-xs cursor-pointer">
                <strong>Sobrescrever materiais existentes nos destinos</strong>
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  Marcado: apaga os materiais atuais dos destinos antes de aplicar. Desmarcado: só adiciona os que faltam (não duplica).
                </span>
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowApplyDialog(false)}>Cancelar</Button>
            <Button size="sm" onClick={() => applyMutation.mutate()} disabled={applyTargetIds.size === 0 || applyMutation.isPending}>
              {applyMutation.isPending ? 'Aplicando…' : `Aplicar em ${applyTargetIds.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
