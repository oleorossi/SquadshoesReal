import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
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
import { BoxTypeFormDialog, KIND_LABEL, type BoxKind, type BoxRow } from './BoxTypeFormDialog';

/**
 * Lista + estoque das caixas. O CADASTRO (medidas, preço, estoque, fornecedor)
 * mora em `BoxTypeFormDialog`, compartilhado com a aba Embalagem do solado —
 * não reintroduzir um formulário local aqui.
 */

export default function PackagingStockPanel() {
  const qc = useQueryClient();
  const perm = useCan('/embalagens');
  const [editingBox, setEditingBox] = useState<BoxRow | null>(null);
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BoxRow | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | BoxKind>('all');

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

  const openNewDialog = () => setIsNewDialogOpen(true);

  const openEditDialog = (b: BoxRow) => setEditingBox(b);


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

      {/* Cadastro/edição — MESMO componente que a aba Embalagem do solado usa.
          Não recriar um formulário local aqui: a porta é única
          (`BoxTypeFormDialog`), senão os dois voltam a divergir. */}
      <BoxTypeFormDialog
        open={isNewDialogOpen || !!editingBox}
        onOpenChange={(o) => { if (!o) { setIsNewDialogOpen(false); setEditingBox(null); } }}
        box={editingBox}
      />

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
