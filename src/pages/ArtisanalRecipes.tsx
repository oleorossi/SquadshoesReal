import { useState, useMemo } from 'react';
import { Sparkle as Sparkles, Plus, PencilSimple as Pencil, Trash as Trash2, MagnifyingGlass as Search, CircleNotch as Loader2, Calculator, ArrowRight, Users, Warning as AlertTriangle, Scissors, X } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { confirmAndBulkDelete } from '@/lib/bulkConfirm';
import {
  useArtisanalRecipes, useCreateArtisanalRecipe, useUpdateArtisanalRecipe, useDeleteArtisanalRecipe,
  ArtisanalRecipe,
} from '@/hooks/useArtisanalRecipes';
import { useContractors } from '@/hooks/useContractors';
 import { useProducts, getBaseName } from '@/hooks/useProducts';
 import { useGroups } from '@/hooks/useGroups';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import CuttingOptimizerPanel from '@/components/recipes/CuttingOptimizerPanel';

const emptyRecipe: Partial<ArtisanalRecipe> = {
  name: '',
  artisanal_product_name: '',
  base_product_name: '',
  yield_per_meter: 1,
  labor_cost_per_meter: 0,
  base_time_minutes: 0,
  cut_width_mm: null,
  default_contractor_id: null,
  notes: '',
  active: true,
};

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/** Normaliza p/ comparar tipo/base sem acento nem caixa. */
const normKey = (v: string) =>
  (v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Uma base da receita (matéria-prima). O mesmo tipo de tira pode ter várias
 *  bases (ex.: NAPA SOFT e NAPA MADRID), cada uma com seu rendimento/custo —
 *  materializadas como uma linha em `artisanal_recipes` por base (irmãs). */
interface BaseRow {
  id?: string; // id da receita irmã existente (update) ou vazio (create)
  base_product_name: string;
  yield_per_meter: number;
  labor_cost_per_meter: number;
}

const emptyBaseRow = (): BaseRow => ({ base_product_name: '', yield_per_meter: 1, labor_cost_per_meter: 0 });

export default function ArtisanalRecipes({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
   const { data: recipes = [], isLoading, isError } = useArtisanalRecipes();
   const { data: contractors = [] } = useContractors();
   const { data: products = [] } = useProducts();
   const { data: groups = [] } = useGroups();
  const create = useCreateArtisanalRecipe();
  const update = useUpdateArtisanalRecipe();
  const remove = useDeleteArtisanalRecipe();

  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Partial<ArtisanalRecipe>>(emptyRecipe);
  const [isEditing, setIsEditing] = useState(false);
  // Bases (matéria-prima) da receita em edição — uma linha por base.
  const [baseRows, setBaseRows] = useState<BaseRow[]>([emptyBaseRow()]);
  // Ids das receitas-irmãs carregadas ao abrir (pra saber o que apagar se a base for removida).
  const [loadedSiblingIds, setLoadedSiblingIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const productNames = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      const base = getBaseName(p.name) || p.name;
      if (base) set.add(base);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [products]);

  const filtered = useMemo(() => {
    if (!search.trim()) return recipes;
    // espaço/"/" = refinamento AND (ex.: "trançado natural")
    return recipes.filter((r) =>
      searchMatchesAllTerms(
        search,
        r.name,
        r.base_product_name,
        r.artisanal_product_name,
        contractors.find((c) => c.id === r.default_contractor_id)?.name,
      ),
    );
  }, [recipes, search, contractors]);

  const sel = useMarqueeSelection(filtered, (r) => r.id);
  const handleBulkDeleteRecipes = async () => {
    const ids = Array.from(sel.selectedIds);
    const sampleLines = filtered
      .filter(r => sel.selectedIds.has(r.id))
      .slice(0, 5)
      .map(r => `• ${r.name}`);
    await confirmAndBulkDelete({
      ids,
      entityLabel: 'receita',
      sampleLines,
      deleteOne: (id) => remove.mutateAsync(id),
      onAfter: () => sel.clear(),
    });
  };

  const openNew = () => {
    setEditing({ ...emptyRecipe });
    setBaseRows([emptyBaseRow()]);
    setLoadedSiblingIds([]);
    setIsEditing(false);
    setDialog(true);
  };
  const openEdit = (r: ArtisanalRecipe) => {
    // Carrega TODAS as receitas-irmãs do mesmo tipo de tira (mesmo
    // artisanal_product_name) — cada base vira uma linha editável.
    const siblings = recipes.filter(
      (x) => normKey(x.artisanal_product_name) === normKey(r.artisanal_product_name),
    );
    setEditing({ ...r });
    setBaseRows(
      (siblings.length ? siblings : [r]).map((s) => ({
        id: s.id,
        base_product_name: s.base_product_name,
        yield_per_meter: Number(s.yield_per_meter) || 1,
        labor_cost_per_meter: Number(s.labor_cost_per_meter) || 0,
      })),
    );
    setLoadedSiblingIds(siblings.map((s) => s.id));
    setIsEditing(true);
    setDialog(true);
  };

  const setBaseRow = (i: number, patch: Partial<BaseRow>) =>
    setBaseRows((rows) => rows.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const addBaseRow = () => setBaseRows((rows) => [...rows, emptyBaseRow()]);
  const removeBaseRow = (i: number) =>
    setBaseRows((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  const handleSave = async () => {
    const type = (editing.artisanal_product_name || '').trim();
    const validRows = baseRows.filter((r) => r.base_product_name?.trim());
    if (!editing.name?.trim() || !type || validRows.length === 0) {
      toast.error('Preencha nome, produto artesanal e ao menos uma base.');
      return;
    }
    // Base duplicada dentro da mesma receita não faz sentido.
    const seen = new Set<string>();
    for (const r of validRows) {
      const k = normKey(r.base_product_name);
      if (seen.has(k)) { toast.error(`Base "${r.base_product_name}" repetida.`); return; }
      seen.add(k);
    }
    const cutWidth = Number(editing.cut_width_mm);
    const shared = {
      name: editing.name!.trim(),
      artisanal_product_name: type,
      base_time_minutes: Math.max(0, Number(editing.base_time_minutes) || 0),
      cut_width_mm: Number.isFinite(cutWidth) && cutWidth > 0 ? Math.round(cutWidth) : null,
      default_contractor_id: editing.default_contractor_id || null,
      notes: editing.notes?.trim() || null,
      active: editing.active ?? true,
    };
    setSaving(true);
    try {
      // Upsert idempotente por (tipo, base). Mantém as bases não-editadas de outras
      // cores; cada base é uma receita irmã (o débito da OS resolve pela receita).
      const existingByBase = new Map(
        recipes
          .filter((x) => normKey(x.artisanal_product_name) === normKey(type))
          .map((x) => [normKey(x.base_product_name), x.id] as const),
      );
      for (const row of validRows) {
        const base = row.base_product_name.trim();
        const payload = {
          ...shared,
          base_product_name: base,
          yield_per_meter: Number(row.yield_per_meter) || 1,
          labor_cost_per_meter: Number(row.labor_cost_per_meter) || 0,
        };
        const existingId = row.id || existingByBase.get(normKey(base));
        if (existingId) {
          const { error } = await supabase.from('artisanal_recipes').update(payload as any).eq('id', existingId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('artisanal_recipes').insert(payload as any);
          if (error) throw error;
        }
      }
      // Bases removidas: irmãs carregadas que não estão mais na lista → apagar.
      const keptIds = new Set(validRows.map((r) => r.id).filter(Boolean) as string[]);
      const toDelete = loadedSiblingIds.filter((id) => !keptIds.has(id));
      for (const id of toDelete) {
        const { error } = await supabase.from('artisanal_recipes').delete().eq('id', id);
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ['artisanal_recipes'] });
      toast.success(
        validRows.length > 1
          ? `Receita salva com ${validRows.length} bases.`
          : 'Receita salva!',
      );
      setDialog(false);
    } catch (e: any) {
      toast.error(`Erro ao salvar receita: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
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
    <div className="space-y-4">
      {/* Header — omitido quando embutido numa aba (ex.: hub Terceirizados);
          a ação "Nova Receita" vira uma barra compacta pra não sumir. */}
      {embedded ? (
        <div className="flex justify-end">
          <Button onClick={openNew} className="gap-1.5">
            <Plus className="h-4 w-4" /> Nova Receita
          </Button>
        </div>
      ) : (
        <EditorialPageHeader
          sectionLabel="ENGENHARIA · RECEITAS"
          title="Produtos Artesanais"
          description="Receitas de transformação de matéria-prima em produtos artesanais via terceirizados"
          actions={
            <Button onClick={openNew} className="gap-1.5">
              <Plus className="h-4 w-4" /> Nova Receita
            </Button>
          }
        />
      )}

      <Tabs defaultValue="recipes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="recipes" className="gap-1.5">
            <Sparkles className="h-4 w-4" /> Receitas
          </TabsTrigger>
          <TabsTrigger value="optimizer" className="gap-1.5">
            <Scissors className="h-4 w-4" /> Otimização de Corte de Rolo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recipes" className="space-y-4 mt-0">
      {/* How-to card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 text-sm space-y-2">
          <div className="flex items-center gap-2 font-semibold text-primary">
            <Calculator className="h-4 w-4" /> Como funciona
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Cadastre uma receita para cada transformação artesanal (ex: trançado, perfuração, bordado).
            Ao criar uma <strong>Ordem de Serviço</strong> em <em>Terceirizados</em>, vincule a receita,
            informe os metros do produto base enviados e os metros do artesanal a serem produzidos.
            Quando concluída, o sistema dá baixa automática da MP, lança a entrada do artesanal no estoque
            e gera a conta a pagar para o terceirizado.
          </p>
        </CardContent>
      </Card>

      {/* Search */}
      <SearchInput
        className="max-w-sm"
        inputClassName="h-9"
        value={search}
        onChange={setSearch}
        placeholder="Buscar por receita, produto base, artesanal, terceirizado…"
        resultCount={filtered.length}
        totalCount={recipes.length}
      />

      {/* Table */}
      <Panel flush>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead className="w-8">
                    <Checkbox
                      checked={filtered.length > 0 && filtered.every(r => sel.isSelected(r.id))}
                      onCheckedChange={(v) => filtered.forEach(r => { if (!!v !== sel.isSelected(r.id)) sel.toggle(r.id); })}
                      aria-label="Selecionar todas"
                    />
                  </TableHead>
                  <TableHead>Receita</TableHead>
                  <TableHead>Transformação</TableHead>
                  <TableHead className="w-[120px] text-right">Rendimento</TableHead>
                  <TableHead className="w-[120px] text-right">Custo MO/m</TableHead>
                  <TableHead className="w-[110px] text-right">Tempo base</TableHead>
                  <TableHead>Terceirizado padrão</TableHead>
                  <TableHead className="w-[80px]">Status</TableHead>
                  <TableHead className="w-[80px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="p-0">
                      <EmptyState
                        icon={search ? Search : Sparkles}
                        title={search ? `Nenhum resultado para "${search}"` : 'Nenhuma receita cadastrada'}
                        description={search ? undefined : 'Crie a primeira receita de transformação artesanal.'}
                        action={search
                          ? <Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>
                          : <Button onClick={openNew} className="gap-1.5"><Plus className="h-4 w-4" />Nova Receita</Button>}
                        size="sm"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => {
                    const contractor = contractors.find((c) => c.id === r.default_contractor_id);
                    return (
                      <TableRow
                        key={r.id}
                        className={`cursor-pointer hover:bg-muted/50 transition-colors ${sel.isSelected(r.id) ? 'bg-primary/5 hover:bg-primary/10' : ''}`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button,[role="checkbox"]')) return;
                          openEdit(r);
                        }}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={sel.isSelected(r.id)}
                            onCheckedChange={() => sel.toggle(r.id)}
                            aria-label={`Selecionar ${r.name}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm font-medium">{r.name}</TableCell>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-muted-foreground">{r.base_product_name}</span>
                            <ArrowRight className="h-3 w-3 text-primary" />
                            <span className="font-medium">{r.artisanal_product_name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono">
                          {(Number(r.yield_per_meter) || 1).toFixed(2)} m/m
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono">
                          {fmtCurrency(Number(r.labor_cost_per_meter) || 0)}
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono text-muted-foreground">
                          {Number(r.base_time_minutes) > 0 ? `${r.base_time_minutes} min/m` : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {contractor ? (
                            <span className="flex items-center gap-1 text-xs">
                              <Users className="h-3 w-3 text-muted-foreground" />
                              {contractor.name}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.active ? 'default' : 'secondary'} className="text-xs">
                            {r.active ? 'Ativa' : 'Inativa'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openEdit(r)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Excluir receita?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Esta ação não pode ser desfeita. Ordens de serviço já lançadas
                                    perderão o vínculo com esta receita.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => remove.mutate(r.id)}>
                                    Excluir
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
      </Panel>
        </TabsContent>

        <TabsContent value="optimizer" className="mt-0">
          <CuttingOptimizerPanel recipes={recipes} />
        </TabsContent>
      </Tabs>

      {/* Recipe Dialog */}
      <Dialog
        open={dialog}
        onOpenChange={(open) => {
          setDialog(open);
          if (!open) {
            setEditing(emptyRecipe);
            setIsEditing(false);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {isEditing ? 'Editar' : 'Nova'} Receita Artesanal
            </DialogTitle>
            <DialogDescription>
              Define a transformação de uma matéria-prima em um produto artesanal.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Nome da receita *</Label>
              <Input
                placeholder="Ex: Trançado de couro liso natural"
                value={editing.name || ''}
                onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                className="h-9"
              />
            </div>

             <div className="col-span-2 space-y-1.5">
               <Label className="text-xs font-medium text-muted-foreground">
                 Grupo de produto artesanal (resultado) *
               </Label>
               <Select
                 value={editing.artisanal_product_name || ''}
                 onValueChange={(v) =>
                   setEditing((p) => ({ ...p, artisanal_product_name: v }))
                 }
               >
                 <SelectTrigger className="h-9">
                   <SelectValue placeholder="Selecione o grupo de resultado..." />
                 </SelectTrigger>
                 <SelectContent>
                   {groups.map((g) => (
                     <SelectItem key={g.id} value={g.name}>
                       {g.name}
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>

            {/* Bases (matéria-prima) — a MESMA tira pode ser cortada de várias napas
                (ex.: NAPA SOFT e NAPA MADRID), cada uma com seu rendimento. Cada base
                vira uma variação da receita; na OS você escolhe a base e o débito baixa
                a napa certa na cor da tira. */}
            <div className="col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">
                  Bases (matéria-prima) *
                </Label>
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addBaseRow}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar base
                </Button>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                A mesma tira pode ser cortada de mais de uma napa. Cada base tem seu próprio
                rendimento; na produção você escolhe de qual base cortar.
              </p>
              {baseRows.map((row, i) => (
                <div key={row.id || i} className="relative rounded-lg border p-2.5 pt-3 space-y-2 bg-muted/20">
                  {baseRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeBaseRow(i)}
                      className="absolute -right-2 -top-2 rounded-full border bg-card p-0.5 text-muted-foreground hover:text-destructive"
                      aria-label="Remover base"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <Select
                    value={row.base_product_name || ''}
                    onValueChange={(v) => setBaseRow(i, { base_product_name: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Selecione o grupo base..." />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.name}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Rendimento (m/m base) *</Label>
                      <NumberInput
                        min={0.01}
                        value={row.yield_per_meter ?? 1}
                        onChange={(n) => setBaseRow(i, { yield_per_meter: n })}
                        className="h-9 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">MO / metro (R$)</Label>
                      <NumberInput
                        value={row.labor_cost_per_meter ?? 0}
                        onChange={(n) => setBaseRow(i, { labor_cost_per_meter: n })}
                        className="h-9 font-mono"
                      />
                    </div>
                  </div>
                  {row.base_product_name && Number(row.yield_per_meter) > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      1 m de {row.base_product_name} → {Number(row.yield_per_meter)} m de {editing.artisanal_product_name || 'tira'}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Largura de corte da tira (mm)
              </Label>
              <NumberInput
                min={1}
                decimals={0}
                placeholder="Ex: 150"
                unit="mm"
                value={editing.cut_width_mm}
                onChange={(n) =>
                  setEditing((p) => ({
                    ...p,
                    cut_width_mm: n === 0 ? null : n,
                  }))
                }
                className="h-9 font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Largura da tira para o cálculo de <strong>corte do rolo</strong> no PV
                (rolo padrão 40 m × 1370 mm). Deixe vazio se a tira não é cortada de rolo.
              </p>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Tempo base por metro (min/m)
              </Label>
              <NumberInput
                decimals={0}
                value={editing.base_time_minutes ?? 0}
                onChange={(n) =>
                  setEditing((p) => ({
                    ...p,
                    base_time_minutes: n,
                  }))
                }
                className="h-9 font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Tempo estimado total das etapas manuais (separação, cola, enfeite, etc.) por metro de produto artesanal produzido.
              </p>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Terceirizado padrão
              </Label>
              <Select
                value={editing.default_contractor_id || '__none__'}
                onValueChange={(v) =>
                  setEditing((p) => ({
                    ...p,
                    default_contractor_id: v === '__none__' ? null : v,
                  }))
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {contractors
                    .filter((c) => c.active)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Observações</Label>
              <Textarea
                value={editing.notes || ''}
                onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="resize-none"
              />
            </div>

            <div className="col-span-2 flex items-center justify-between rounded-lg border p-3 bg-muted/20">
              <div>
                <Label className="text-xs font-medium">Receita ativa</Label>
                <p className="text-xs text-muted-foreground">
                  Receitas inativas não aparecem na seleção em OS
                </p>
              </div>
              <Switch
                checked={editing.active ?? true}
                onCheckedChange={(v) => setEditing((p) => ({ ...p, active: v }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDialog(false)} className="h-9">
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-9"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkActionsBar
        selectedIds={sel.selectedIds}
        onClear={sel.clear}
        itemLabel={sel.selectedIds.size === 1 ? 'receita' : 'receitas'}
        actions={[
          {
            label: 'Excluir',
            variant: 'destructive',
            icon: <Trash2 className="h-3.5 w-3.5" />,
            onClick: handleBulkDeleteRecipes,
          },
        ]}
      />
    </div>
  );
}