import { useMemo, useState } from 'react';
import { CircleNotch as Loader2, Plus, PencilSimple as Pencil, Trash as Trash2, FolderOpen, CaretDown as ChevronDown, CaretUp as ChevronUp, Warning as AlertTriangle, Package, Stack as Layers } from '@phosphor-icons/react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { confirmAndBulkDelete } from '@/lib/bulkConfirm';
import { useGroups, useDeleteGroup, ProductGroup } from '@/hooks/useGroups';
import { useProducts } from '@/hooks/useProducts';
import SupplierPanel from '@/components/groups/SupplierPanel';
import GroupDialog from '@/components/groups/GroupDialog';
import GroupItemsManager from '@/components/groups/GroupItemsManager';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { flattenGroupTree } from '@/lib/groupHierarchy';
import { sectorLabel } from '@/lib/categoryFromGroup';

export default function Groups() {
  const { data: groups = [], isLoading, isError } = useGroups();
  const { data: products = [] } = useProducts();
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
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState<ProductGroup | null>(null);
  const [itemsGroup, setItemsGroup] = useState<ProductGroup | null>(null);

  const openAdd = () => setDialogOpen(true);
  const openEdit = (g: ProductGroup) => { setEditGroup(g); };

  const countProducts = (groupId: string) => products.filter(p => p.group_id === groupId).length;

  // Ordem hierárquica (pai → filhos indentados), em vez de alfabética plana.
  const treeGroups = useMemo(() => flattenGroupTree(groups), [groups]);

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
    <>
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="ESTOQUE · GRUPOS"
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
          eyebrow="ESTOQUE · GRUPOS"
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
                <TableHead>Setor</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-center">Produtos</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {treeGroups.map(g => {
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
                          <TableCell className="font-medium">
                            <span className="flex items-center gap-1.5" style={{ paddingLeft: g.depth * 20 }}>
                              {g.depth > 0 && <span className="text-muted-foreground">└</span>}
                              {g.name}
                              {g.childCount > 0 && (
                                <Badge variant="secondary" className="h-4 text-[10px] gap-1 font-mono">
                                  <Layers className="h-2.5 w-2.5" />{g.childCount}
                                </Badge>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">{sectorLabel(g.sector)}</TableCell>
                          <TableCell className="text-muted-foreground">{g.description || '—'}</TableCell>
                          <TableCell className="text-center">
                            <button type="button" onClick={() => setItemsGroup(g)} title="Gerir itens do grupo">
                              <Badge variant="outline" className="cursor-pointer hover:bg-muted">{countProducts(g.id)}</Badge>
                            </button>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Gerir itens" onClick={() => setItemsGroup(g)}>
                                <Package className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar grupo" onClick={() => openEdit(g)}>
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
                            <td colSpan={6} className="p-0">
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

      <GroupDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {editGroup && (
        <GroupDialog
          open={!!editGroup}
          onOpenChange={(open) => { if (!open) setEditGroup(null); }}
          group={editGroup}
        />
      )}

      <GroupItemsManager
        group={itemsGroup}
        groups={groups}
        open={!!itemsGroup}
        onOpenChange={(open) => { if (!open) setItemsGroup(null); }}
      />

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
    </>
  );
}
