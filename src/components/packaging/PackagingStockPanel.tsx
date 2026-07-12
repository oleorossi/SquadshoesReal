import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Cube as Box, PencilSimple as Pencil, MagnifyingGlass as Search, Plus, Funnel as Filter, Copy, Trash as Trash2 } from '@phosphor-icons/react';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeleteIndividualPackaging, useDuplicateIndividualPackaging } from '@/hooks/usePackaging';
import { useCan } from '@/hooks/useAccessControl';

type BoxKind = 'individual' | 'master' | 'colmeia' | 'fitilho';

const KIND_LABEL: Record<BoxKind, string> = {
  individual: 'Individual',
  master: 'Master',
  colmeia: 'Colmeia',
  fitilho: 'Fitilho',
};

const KIND_HELPER: Record<BoxKind, string> = {
  individual: '1 par por caixa. Vai dentro da master ou amarrada com fitilho.',
  master: 'Agrupa N pares (típico 12). Na NF: 1 master = 1 volume.',
  colmeia: 'Carrega N pares diretamente. Na NF: 1 colmeia = 1 volume.',
  fitilho: 'Material linear (metros) que amarra individuais. Na NF: cada par é 1 volume.',
};

interface BoxRow {
  id: string;
  nome: string;
  tipo: BoxKind | null;
  interno: boolean;
  pairs_per_box_default: number | null;
  metros_per_amarrado_default: number | null;
  comprimento_cm: number;
  largura_cm: number;
  altura_cm: number;
  peso_kg: number | null;
  /** Tara da caixa vazia em KG — fonte do peso bruto da NF (Σ caixas × tara). */
  empty_weight_kg: number | null;
  empilhamento_maximo: number | null;
  quantity: number;
  min_stock: number;
  unit_price: number;
  supplier_id: string | null;
  active: boolean;
  suppliers?: { id: string; name: string } | null;
}

const emptyForm = {
  nome: '',
  tipo: 'individual' as BoxKind,
  pairs_per_box_default: 1,
  metros_per_amarrado_default: 1,
  comprimento_cm: 0,
  largura_cm: 0,
  altura_cm: 0,
  peso_kg: 0,
  empty_weight_kg: 0,
  empilhamento_maximo: 0,
  quantity: 0,
  min_stock: 0,
  unit_price: 0,
  supplier_id: '',
};

export default function PackagingStockPanel() {
  const qc = useQueryClient();
  const perm = useCan('/embalagens');
  const [editingBox, setEditingBox] = useState<BoxRow | null>(null);
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BoxRow | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | BoxKind>('all');

  const [form, setForm] = useState(emptyForm);

  const deleteMutation = useDeleteIndividualPackaging();
  const duplicateMutation = useDuplicateIndividualPackaging();

  const { data: boxTypes = [], isLoading } = useQuery({
    queryKey: ['box_types_stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('box_types')
        .select('*, suppliers:supplier_id(id, name)')
        .eq('active', true)
        .order('nome');
      if (error) throw error;
      return (data || []) as BoxRow[];
    },
    staleTime: 30_000,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers_for_packaging'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  const filtered = useMemo(
    () =>
      boxTypes.filter((b) => {
        const kind = (b.tipo || (b.interno ? 'individual' : 'master')) as BoxKind;
        const matchesSearch = searchMatchesAllTerms(search, b.nome, KIND_LABEL[kind], b.suppliers?.name);
        const matchesType = typeFilter === 'all' || typeFilter === kind;
        return matchesSearch && matchesType;
      }),
    [boxTypes, search, typeFilter]
  );

  // Summary stats always reflect ALL items, independent of search/filter
  const totalUnits = boxTypes.reduce((s, b) => s + Number(b.quantity || 0), 0);
  const lowStock = boxTypes.filter(
    (b) => Number(b.quantity || 0) <= Number(b.min_stock || 0) && Number(b.min_stock) > 0
  ).length;
  const totalValue = useMemo(
    () => boxTypes.reduce((acc, box) => acc + Number(box.quantity || 0) * Number(box.unit_price || 0), 0),
    [boxTypes],
  );

  const fmtBRL = (n: number) =>
    n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtBRL4 = (n: number) =>
    n.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });

  const openNewDialog = () => {
    setForm(emptyForm);
    setIsNewDialogOpen(true);
  };

  const openEditDialog = (b: BoxRow) => {
    setEditingBox(b);
    setForm({
      nome: b.nome,
      tipo: (b.tipo || (b.interno ? 'individual' : 'master')) as BoxKind,
      pairs_per_box_default: Number(b.pairs_per_box_default ?? (b.interno ? 1 : 12)),
      metros_per_amarrado_default: Number(b.metros_per_amarrado_default ?? 1),
      comprimento_cm: Number(b.comprimento_cm || 0),
      largura_cm: Number(b.largura_cm || 0),
      altura_cm: Number(b.altura_cm || 0),
      peso_kg: Number(b.peso_kg || 0),
      empty_weight_kg: Number(b.empty_weight_kg || 0),
      empilhamento_maximo: Number(b.empilhamento_maximo || 0),
      quantity: Number(b.quantity || 0),
      min_stock: Number(b.min_stock || 0),
      unit_price: Number(b.unit_price || 0),
      supplier_id: b.supplier_id || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingBox) return;
    if (!form.nome.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    try {
      const prevQty = Number(editingBox.quantity || 0);
      const { error } = await (supabase as any)
        .from('box_types')
        .update({
          nome: form.nome,
          tipo: form.tipo,
          // interno espelha tipo='individual' por compat com leitores antigos
          interno: form.tipo === 'individual',
          pairs_per_box_default: form.pairs_per_box_default,
          metros_per_amarrado_default: form.tipo === 'fitilho' ? form.metros_per_amarrado_default : null,
          comprimento_cm: form.comprimento_cm,
          largura_cm: form.largura_cm,
          altura_cm: form.altura_cm,
          peso_kg: form.peso_kg,
          empty_weight_kg: form.empty_weight_kg || null,
          empilhamento_maximo: form.empilhamento_maximo || null,
          quantity: form.quantity,
          min_stock: form.min_stock,
          unit_price: form.unit_price,
          supplier_id: form.supplier_id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingBox.id);
      if (error) throw error;

      const diff = Math.abs(form.quantity - prevQty);
      if (diff > 0) {
        await supabase.from('stock_movements').insert({
          product_id: editingBox.id,
          movement_type: form.quantity > prevQty ? 'in' : 'out',
          quantity: diff,
          previous_stock: prevQty,
          new_stock: form.quantity,
          description: 'Ajuste manual de estoque de embalagem',
        });
      }

      toast.success('Embalagem atualizada!');
      qc.invalidateQueries({ queryKey: ['box_types_stock'] });
      qc.invalidateQueries({ queryKey: ['box_types'] });
      qc.invalidateQueries({ queryKey: ['individualPackaging'] });
      qc.invalidateQueries({ queryKey: ['packagingStats'] });
      qc.invalidateQueries({ queryKey: ['packagingAlerts'] });
      setEditingBox(null);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao salvar');
    }
  };

  const handleSaveNew = async () => {
    if (!form.nome.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    try {
      const { data: created, error } = await (supabase as any).from('box_types').insert({
        nome: form.nome,
        tipo: form.tipo,
        interno: form.tipo === 'individual',
        pairs_per_box_default: form.pairs_per_box_default,
        metros_per_amarrado_default: form.tipo === 'fitilho' ? form.metros_per_amarrado_default : null,
        comprimento_cm: form.comprimento_cm,
        largura_cm: form.largura_cm,
        altura_cm: form.altura_cm,
        peso_kg: form.peso_kg,
        empilhamento_maximo: form.empilhamento_maximo || null,
        quantity: form.quantity,
        min_stock: form.min_stock,
        unit_price: form.unit_price,
        supplier_id: form.supplier_id || null,
        active: true,
      }).select('id').single();
      if (error) throw error;

      if (form.quantity > 0 && created?.id) {
        await supabase.from('stock_movements').insert({
          product_id: created.id,
          movement_type: 'in',
          quantity: form.quantity,
          previous_stock: 0,
          new_stock: form.quantity,
          description: 'Estoque inicial de embalagem',
        });
      }

      toast.success('Embalagem criada!');
      qc.invalidateQueries({ queryKey: ['box_types_stock'] });
      qc.invalidateQueries({ queryKey: ['packagingStats'] });
      setIsNewDialogOpen(false);
      setForm(emptyForm);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao criar');
    }
  };

  const renderForm = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
      <div className="space-y-4">
        <div>
          <Label>Nome *</Label>
          <Input
            value={form.nome}
            onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            placeholder="Ex: Caixa Master 12P"
          />
        </div>
        <div>
          <Label>Tipo</Label>
          <Select
            value={form.tipo}
            onValueChange={(v: BoxKind) =>
              setForm((f) => ({
                ...f,
                tipo: v,
                // sugere capacidade típica do tipo (usuário sobrescreve)
                pairs_per_box_default:
                  v === 'individual' ? 1 : v === 'master' || v === 'colmeia' || v === 'fitilho' ? 12 : f.pairs_per_box_default,
              }))
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">Individual — 1 par</SelectItem>
              <SelectItem value="master">Master — agrupa N pares (NF: 1 master = 1 volume)</SelectItem>
              <SelectItem value="colmeia">Colmeia — carrega N pares direto (NF: 1 colmeia = 1 volume)</SelectItem>
              <SelectItem value="fitilho">Fitilho — material linear (NF: cada par = 1 volume)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">{KIND_HELPER[form.tipo]}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>{form.tipo === 'fitilho' ? 'Pares por amarrado' : 'Pares por caixa'}</Label>
            <Input
              type="number"
              min={1}
              value={form.pairs_per_box_default || ''}
              onChange={(e) => setForm((f) => ({ ...f, pairs_per_box_default: Number(e.target.value) }))}
            />
          </div>
          {form.tipo === 'fitilho' && (
            <div>
              <Label>Metros por amarrado</Label>
              <Input
                type="number"
                step="0.1"
                min={0.1}
                value={form.metros_per_amarrado_default || ''}
                onChange={(e) => setForm((f) => ({ ...f, metros_per_amarrado_default: Number(e.target.value) }))}
              />
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label>Comp. (cm)</Label>
            <Input
              type="number"
              value={form.comprimento_cm || ''}
              onChange={(e) => setForm((f) => ({ ...f, comprimento_cm: Number(e.target.value) }))}
            />
          </div>
          <div>
            <Label>Larg. (cm)</Label>
            <Input
              type="number"
              value={form.largura_cm || ''}
              onChange={(e) => setForm((f) => ({ ...f, largura_cm: Number(e.target.value) }))}
            />
          </div>
          <div>
            <Label>Alt. (cm)</Label>
            <Input
              type="number"
              value={form.altura_cm || ''}
              onChange={(e) => setForm((f) => ({ ...f, altura_cm: Number(e.target.value) }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Peso (g)</Label>
            <Input
              type="number"
              value={form.peso_kg || ''}
              onChange={(e) => setForm((f) => ({ ...f, peso_kg: Number(e.target.value) }))}
            />
          </div>
          <div>
            <Label>Tara — caixa vazia (kg)</Label>
            <Input
              type="number"
              step="0.001"
              value={form.empty_weight_kg || ''}
              onChange={(e) => setForm((f) => ({ ...f, empty_weight_kg: Number(e.target.value) }))}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Peso da caixa vazia em kg. Usado no peso bruto da NF-e (peso líquido + nº de caixas × tara).
            </p>
          </div>
          <div>
            <Label>Empilhamento</Label>
            <Input
              type="number"
              value={form.empilhamento_maximo || ''}
              onChange={(e) => setForm((f) => ({ ...f, empilhamento_maximo: Number(e.target.value) }))}
              placeholder="Níveis"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Estoque Atual</Label>
            <Input
              type="number"
              value={form.quantity || ''}
              onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
            />
          </div>
          <div>
            <Label>Estoque Mínimo</Label>
            <Input
              type="number"
              value={form.min_stock || ''}
              onChange={(e) => setForm((f) => ({ ...f, min_stock: Number(e.target.value) }))}
            />
          </div>
        </div>
        <div>
          <Label>Custo Unitário (R$)</Label>
          <Input
            type="number"
            step="0.0001"
            value={form.unit_price || ''}
            onChange={(e) => setForm((f) => ({ ...f, unit_price: Number(e.target.value) }))}
          />
        </div>
        <div>
          <Label>Fornecedor</Label>
          <Select
            value={form.supplier_id}
            onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecionar..." />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="display text-2xl tabular-nums">{boxTypes.length}</p>
            <p className="text-xs text-muted-foreground">Tipos cadastrados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="display text-2xl tabular-nums">{totalUnits}</p>
            <p className="text-xs text-muted-foreground">Unidades em estoque</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="display text-2xl tabular-nums text-destructive">{lowStock}</p>
            <p className="text-xs text-muted-foreground">Estoque baixo</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="display text-2xl tabular-nums">{fmtBRL(totalValue)}</p>
            <p className="text-xs text-muted-foreground">Valor total em estoque</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, tipo ou fornecedor…"
            resultCount={filtered.length}
            totalCount={boxTypes.length}
            className="w-full sm:max-w-sm"
          />

          <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
            <SelectTrigger className="w-full sm:w-44 gap-2">
              <Filter className="h-4 w-4" />
              <SelectValue placeholder="Todos os tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="individual">Individuais</SelectItem>
              <SelectItem value="master">Master</SelectItem>
              <SelectItem value="colmeia">Colmeia</SelectItem>
              <SelectItem value="fitilho">Fitilho</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {perm.canCreate && (
          <Button onClick={openNewDialog} className="gap-2 w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            Nova Embalagem
          </Button>
        )}
      </div>

      {/* Stock table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-center">Capacidade</TableHead>
              <TableHead className="text-center">Dimensões</TableHead>
              <TableHead className="text-center">Peso</TableHead>
              <TableHead className="text-center">Estoque</TableHead>
              <TableHead className="text-center">Mín</TableHead>
              <TableHead className="text-right">Custo Un.</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead className="text-center w-[140px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11}>
                  {search.trim() ? (
                    <EmptyState
                      size="sm"
                      icon={Search}
                      title={`Nenhum resultado para "${search}"`}
                      action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
                    />
                  ) : (
                    <div className="text-center text-muted-foreground py-8">
                      <Box className="h-10 w-10 mx-auto mb-2 opacity-20" />
                      Nenhuma embalagem encontrada
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((b) => {
                const qty = Number(b.quantity || 0);
                const minStock = Number(b.min_stock || 0);
                const isLow = minStock > 0 && qty <= minStock;
                const supplierName = b.suppliers?.name || '—';
                const kind = (b.tipo || (b.interno ? 'individual' : 'master')) as BoxKind;
                const ppb = b.pairs_per_box_default;
                const mpa = b.metros_per_amarrado_default;
                return (
                  <TableRow key={b.id} className={isLow ? 'bg-destructive/5' : ''}>
                    <TableCell className="font-medium text-sm">{b.nome}</TableCell>
                    <TableCell>
                      <Badge variant={kind === 'individual' ? 'secondary' : 'default'}>
                        {KIND_LABEL[kind]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      {ppb ? (
                        <>
                          <span className="font-semibold">{ppb}</span>{' '}
                          <span className="text-muted-foreground">
                            {kind === 'fitilho' ? 'pares/amarrado' : 'pares/caixa'}
                          </span>
                          {kind === 'fitilho' && mpa ? (
                            <div className="text-xs text-muted-foreground">{mpa} m/amarrado</div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {b.comprimento_cm}×{b.largura_cm}×{b.altura_cm} cm
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      {b.peso_kg ? `${b.peso_kg} g` : '—'}
                      {b.empty_weight_kg ? (
                        <span className="block text-[11px] text-muted-foreground">tara {b.empty_weight_kg} kg</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`font-semibold ${isLow ? 'text-destructive' : ''}`}>
                        {qty}
                        {isLow && (
                          <Badge variant="destructive" className="ml-1 text-xs px-1">
                            BAIXO
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">{minStock}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {Number(b.unit_price) > 0 ? fmtBRL4(Number(b.unit_price)) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">
                      {qty > 0 && Number(b.unit_price) > 0
                        ? fmtBRL(qty * Number(b.unit_price))
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[120px]">
                      {supplierName}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {perm.canEdit && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditDialog(b)}
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {perm.canCreate && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => duplicateMutation.mutate(b.id)}
                            disabled={duplicateMutation.isPending}
                            title="Duplicar"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        )}
                        {perm.canDelete && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteTarget(b)}
                            title="Excluir"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* New dialog */}
      <Dialog open={isNewDialogOpen} onOpenChange={setIsNewDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Nova Embalagem
            </DialogTitle>
          </DialogHeader>
          {renderForm()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveNew}>Cadastrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog (full edit) */}
      <Dialog open={!!editingBox} onOpenChange={(o) => { if (!o) setEditingBox(null); }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Editar Embalagem
            </DialogTitle>
          </DialogHeader>
          {renderForm()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBox(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir embalagem?</AlertDialogTitle>
            <AlertDialogDescription>
              A embalagem <strong>{deleteTarget?.nome}</strong> será removida da lista ativa.
              Esta ação pode ser revertida via banco de dados se necessário.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate({ id: deleteTarget.id });
                  setDeleteTarget(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
