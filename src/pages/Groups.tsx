import AppLayout from "@/components/layout/AppLayout";
import { useState } from 'react';
import { CircleNotch as Loader2, Plus, PencilSimple as Pencil, Trash as Trash2, FolderOpen, CaretDown as ChevronDown, CaretUp as ChevronUp, Warning as AlertTriangle } from '@phosphor-icons/react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { confirmAndBulkDelete } from '@/lib/bulkConfirm';
import { useGroups, useAddGroup, useUpdateGroup, useDeleteGroup, ProductGroup } from '@/hooks/useGroups';
import { useProducts } from '@/hooks/useProducts';
import { Switch } from '@/components/ui/switch';
import SupplierPanel from '@/components/groups/SupplierPanel';
import GroupEditDialog from '@/components/groups/GroupEditDialog';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

export default function Groups() {
  const { data: groups = [], isLoading, isError } = useGroups();
  const { data: products = [] } = useProducts();
  const addGroup = useAddGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();

  const sel = useMarqueeSelection(groups, (g) => g.id);
  const handleBulkDeleteGroups = async () => {
    const ids = Array.from(sel.selectedIds);
    const sampleLines = groups
      .filter(g => sel.selectedIds.has(g.id))
      .slice(0, 5)
      .map(g => `• ${g.name}`);
    await confirmAndBulkDelete({
      ids,
      entityLabel: 'grupo',
      sampleLines,
      deleteOne: (id) => deleteGroup.mutateAsync(id),
      onAfter: () => sel.clear(),
    });
  };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductGroup | null>(null);
  const emptyForm = {
    name: '',
    description: '',
    auto_component_sheet: false,
    pairs_per_box_individual: null as number | null,
    pairs_per_box_master: null as number | null,
    pairs_per_box_colmeia: null as number | null,
    pairs_per_box_fitilho: null as number | null,
  };
  const [form, setForm] = useState(emptyForm);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState<ProductGroup | null>(null);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (g: ProductGroup) => { setEditGroup(g); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addGroup.mutate(form);
    setDialogOpen(false);
  };

  const parseIntOrNull = (v: string): number | null => {
    if (v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const countProducts = (groupId: string) => products.filter(p => p.group_id === groupId).length;

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
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
    <AppLayout>
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="ENGENHARIA · GRUPOS"
          title="Grupos de Produtos"
          description="Organize produtos em grupos com fornecedores, materiais e informações técnicas"
          actions={
            <Button onClick={openAdd} className="gap-2">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Novo Grupo</span>
            </Button>
          }
        />

        {groups.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={FolderOpen}
              title="Nenhum grupo cadastrado"
              description="Crie o primeiro grupo de produtos para organizar fornecedores e materiais."
              action={<Button onClick={openAdd} className="gap-2"><Plus className="h-4 w-4" />Novo Grupo</Button>}
            />
          </Panel>
        ) : (
        <Panel
          eyebrow="ENGENHARIA · GRUPOS"
          title="Grupos de Produtos"
          subtitle={`${groups.length} ${groups.length === 1 ? 'grupo' : 'grupos'}`}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead className="w-8">
                  <Checkbox
                    checked={groups.length > 0 && groups.every(g => sel.isSelected(g.id))}
                    onCheckedChange={(v) => groups.forEach(g => { if (!!v !== sel.isSelected(g.id)) sel.toggle(g.id); })}
                    aria-label="Selecionar todos"
                  />
                </TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-center">Produtos</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(g => {
                  const isExpanded = expandedGroup === g.id;
                  return (
                    <Collapsible key={g.id} asChild open={isExpanded} onOpenChange={() => setExpandedGroup(isExpanded ? null : g.id)}>
                      <>
                        <TableRow className={sel.isSelected(g.id) ? "bg-primary/5 group" : "group"}>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={sel.isSelected(g.id)}
                              onCheckedChange={() => sel.toggle(g.id)}
                              aria-label={`Selecionar ${g.name}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{g.name}</TableCell>
                          <TableCell className="text-muted-foreground">{g.description || '—'}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline">{countProducts(g.id)}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(g)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <DeleteConfirmButton onConfirm={() => deleteGroup.mutate(g.id)} title="Excluir grupo?" size="h-8 w-8" iconSize="h-4 w-4" />
                              <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </Button>
                              </CollapsibleTrigger>
                            </div>
                          </TableCell>
                        </TableRow>
                        <CollapsibleContent asChild>
                          <tr>
                            <td colSpan={4} className="p-0">
                              <SupplierPanel groupId={g.id} />
                            </td>
                          </tr>
                        </CollapsibleContent>
                      </>
                    </Collapsible>
                  );
                })}
            </TableBody>
          </Table>
        </Panel>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditing(null); setForm(emptyForm); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo grupo de material</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div>
              <Label htmlFor="group-name">Nome do grupo de material *</Label>
              <Input id="group-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1" placeholder="Ex: Solados, Santorine, Colas" />
            </div>
            <div>
              <Label htmlFor="group-desc">Descrição</Label>
              <Textarea id="group-desc" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" rows={3} placeholder="Descrição opcional do grupo" />
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
              <Switch
                id="auto-bom"
                checked={form.auto_component_sheet}
                onCheckedChange={v => setForm(f => ({ ...f, auto_component_sheet: v }))}
              />
              <Label htmlFor="auto-bom" className="cursor-pointer text-sm">
                Ficha de Componente (BOM) — itens deste grupo entram automaticamente
              </Label>
            </div>
            <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
              <Label className="text-sm font-medium">Pares por embalagem (opcional)</Label>
              <p className="text-xs text-muted-foreground -mt-1">
                Use somente os tipos de caixa aplicáveis a este grupo. Pode ajustar depois na edição.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="ppb-ind" className="text-xs">Individual</Label>
                  <Input
                    id="ppb-ind" type="number" min={1} step={1}
                    value={form.pairs_per_box_individual ?? ''}
                    onChange={e => setForm(f => ({ ...f, pairs_per_box_individual: parseIntOrNull(e.target.value) }))}
                    className="mt-1 h-8" placeholder="Ex: 1"
                  />
                </div>
                <div>
                  <Label htmlFor="ppb-mas" className="text-xs">Master</Label>
                  <Input
                    id="ppb-mas" type="number" min={1} step={1}
                    value={form.pairs_per_box_master ?? ''}
                    onChange={e => setForm(f => ({ ...f, pairs_per_box_master: parseIntOrNull(e.target.value) }))}
                    className="mt-1 h-8" placeholder="Ex: 12"
                  />
                </div>
                <div>
                  <Label htmlFor="ppb-col" className="text-xs">Colmeia</Label>
                  <Input
                    id="ppb-col" type="number" min={1} step={1}
                    value={form.pairs_per_box_colmeia ?? ''}
                    onChange={e => setForm(f => ({ ...f, pairs_per_box_colmeia: parseIntOrNull(e.target.value) }))}
                    className="mt-1 h-8" placeholder="Ex: 24"
                  />
                </div>
                <div>
                  <Label htmlFor="ppb-fit" className="text-xs">Fitilho</Label>
                  <Input
                    id="ppb-fit" type="number" min={1} step={1}
                    value={form.pairs_per_box_fitilho ?? ''}
                    onChange={e => setForm(f => ({ ...f, pairs_per_box_fitilho: parseIntOrNull(e.target.value) }))}
                    className="mt-1 h-8" placeholder="Ex: 2"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit">Criar</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {editGroup && (
        <GroupEditDialog
          open={!!editGroup}
          onOpenChange={(open) => { if (!open) setEditGroup(null); }}
          group={editGroup}
        />
      )}

      <BulkActionsBar
        selectedIds={sel.selectedIds}
        onClear={sel.clear}
        itemLabel={sel.selectedIds.size === 1 ? 'grupo' : 'grupos'}
        actions={[
          {
            label: 'Excluir',
            variant: 'destructive',
            icon: <Trash2 className="h-3.5 w-3.5" />,
            onClick: handleBulkDeleteGroups,
          },
        ]}
      />
    </AppLayout>
  );
}
