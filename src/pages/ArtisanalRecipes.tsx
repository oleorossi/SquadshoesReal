import { useState, useMemo } from 'react';
import { Sparkles, Plus, Pencil, Trash2, Search, Loader2, Calculator, ArrowRight, Users, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import {
  useArtisanalRecipes, useCreateArtisanalRecipe, useUpdateArtisanalRecipe, useDeleteArtisanalRecipe,
  ArtisanalRecipe,
} from '@/hooks/useArtisanalRecipes';
import { useContractors } from '@/hooks/useContractors';
 import { useProducts, getBaseName } from '@/hooks/useProducts';
 import { useGroups } from '@/hooks/useGroups';

const emptyRecipe: Partial<ArtisanalRecipe> = {
  name: '',
  artisanal_product_name: '',
  base_product_name: '',
  yield_per_meter: 1,
  labor_cost_per_meter: 0,
  base_time_minutes: 0,
  default_contractor_id: null,
  notes: '',
  active: true,
};

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export default function ArtisanalRecipes() {
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

  const productNames = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      const base = getBaseName(p.name) || p.name;
      if (base) set.add(base);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return recipes;
    return recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.base_product_name.toLowerCase().includes(q) ||
        r.artisanal_product_name.toLowerCase().includes(q),
    );
  }, [recipes, search]);

  const openNew = () => {
    setEditing({ ...emptyRecipe });
    setIsEditing(false);
    setDialog(true);
  };
  const openEdit = (r: ArtisanalRecipe) => {
    setEditing(r);
    setIsEditing(true);
    setDialog(true);
  };

  const handleSave = () => {
    if (
      !editing.name?.trim() ||
      !editing.base_product_name?.trim() ||
      !editing.artisanal_product_name?.trim()
    ) {
      return;
    }
    const payload = {
      ...editing,
      yield_per_meter: Number(editing.yield_per_meter) || 1,
      labor_cost_per_meter: Number(editing.labor_cost_per_meter) || 0,
    };
    if (isEditing && editing.id) {
      update.mutate(payload as ArtisanalRecipe, { onSuccess: () => setDialog(false) });
    } else {
      create.mutate(payload, { onSuccess: () => setDialog(false) });
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
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="display text-2xl tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> Produtos Artesanais
          </h2>
          <p className="text-sm text-muted-foreground">
            Receitas de transformação de matéria-prima em produtos artesanais via terceirizados
          </p>
        </div>
        <Button onClick={openNew} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nova Receita
        </Button>
      </div>

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
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar receita..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      {/* Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <div className="rounded-md border-0 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs font-semibold">Receita</TableHead>
                  <TableHead className="text-xs font-semibold">Transformação</TableHead>
                  <TableHead className="text-xs font-semibold w-[120px] text-right">Rendimento</TableHead>
                  <TableHead className="text-xs font-semibold w-[120px] text-right">Custo MO/m</TableHead>
                  <TableHead className="text-xs font-semibold w-[110px] text-right">Tempo base</TableHead>
                  <TableHead className="text-xs font-semibold">Terceirizado padrão</TableHead>
                  <TableHead className="text-xs font-semibold w-[80px]">Status</TableHead>
                  <TableHead className="text-xs font-semibold w-[80px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-12">
                      Nenhuma receita cadastrada. Clique em <strong>Nova Receita</strong> para começar.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => {
                    const contractor = contractors.find((c) => c.id === r.default_contractor_id);
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button')) return;
                          openEdit(r);
                        }}
                      >
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
                          <Badge variant={r.active ? 'default' : 'secondary'} className="text-[11px]">
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
          </div>
        </CardContent>
      </Card>

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
                 Grupo de produto base (matéria-prima) *
               </Label>
               <Select
                 value={editing.base_product_name || ''}
                 onValueChange={(v) =>
                   setEditing((p) => ({ ...p, base_product_name: v }))
                 }
               >
                 <SelectTrigger className="h-9">
                   <SelectValue placeholder="Selecione o grupo base..." />
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

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Rendimento (m artesanal por m base) *
              </Label>
              <Input
                type="number"
                step="0.01"
                min={0.01}
                value={editing.yield_per_meter ?? 1}
                onFocus={(e) => {
                  if (Number(e.target.value) === 0) e.target.value = '';
                }}
                onChange={(e) =>
                  setEditing((p) => ({ ...p, yield_per_meter: Number(e.target.value) || 0 }))
                }
                className="h-9 font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Ex: 0,7 = 1m de base produz 0,7m de artesanal
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Custo de MO por metro produzido (R$)
              </Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={editing.labor_cost_per_meter ?? 0}
                onFocus={(e) => {
                  if (Number(e.target.value) === 0) e.target.value = '';
                }}
                onChange={(e) =>
                  setEditing((p) => ({
                    ...p,
                    labor_cost_per_meter: Number(e.target.value) || 0,
                  }))
                }
                className="h-9 font-mono"
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Tempo base por metro (min/m)
              </Label>
              <Input
                type="number"
                step="1"
                min={0}
                value={editing.base_time_minutes ?? 0}
                onFocus={(e) => {
                  if (Number(e.target.value) === 0) e.target.value = '';
                }}
                onChange={(e) =>
                  setEditing((p) => ({
                    ...p,
                    base_time_minutes: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="h-9 font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
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
                <p className="text-[11px] text-muted-foreground">
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
              disabled={create.isPending || update.isPending}
              className="h-9"
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}