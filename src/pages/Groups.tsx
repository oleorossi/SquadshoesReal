import { useRef, useState } from 'react';
import { CircleNotch as Loader2, Plus, Warning as AlertTriangle, FolderOpen, Sparkle, ArrowsLeftRight, Trash as Trash2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { confirmAndBulkDelete } from '@/lib/bulkConfirm';
import { useGroups, useDeleteGroup, ProductGroup } from '@/hooks/useGroups';
import { useProducts } from '@/hooks/useProducts';
import { useGroupStockRollups } from '@/hooks/useGroupOrganization';
import GroupDialog from '@/components/groups/GroupDialog';
import GroupCreateDialog from '@/components/groups/GroupCreateDialog';
import GroupItemsManager from '@/components/groups/GroupItemsManager';
import GroupStockTree, { type ProductLite } from '@/components/groups/GroupStockTree';
import MoveGroupsDialog from '@/components/groups/MoveGroupsDialog';
import FamilySuggestionsDialog from '@/components/groups/FamilySuggestionsDialog';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { sectorLabel } from '@/lib/categoryFromGroup';
import { useCan } from '@/hooks/useAccessControl';

type CreateCtx = { key: number; sector?: string; parentId?: string | null; lock?: boolean; title?: string };

export default function Groups() {
  const { data: groups = [], isLoading, isError } = useGroups();
  const { data: products = [] } = useProducts();
  const { data: rollups = new Map() } = useGroupStockRollups();
  const deleteGroup = useDeleteGroup();
  const perm = useCan('/grupos');

  const [editGroup, setEditGroup] = useState<ProductGroup | null>(null);
  const [itemsGroup, setItemsGroup] = useState<ProductGroup | null>(null);
  const [createCtx, setCreateCtx] = useState<CreateCtx | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [selectedLeafIds, setSelectedLeafIds] = useState<Set<string>>(new Set());
  const keyRef = useRef(0);

  const toggleLeaf = (id: string) => setSelectedLeafIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const clearSelection = () => setSelectedLeafIds(new Set());

  const openCreate = (ctx: Omit<CreateCtx, 'key'>) => setCreateCtx({ key: ++keyRef.current, ...ctx });

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedLeafIds);
    const sampleLines = groups.filter(g => selectedLeafIds.has(g.id)).slice(0, 5).map(g => `• ${g.name}`);
    await confirmAndBulkDelete({
      ids,
      entityLabel: 'grupo',
      sampleLines,
      deleteOne: (id) => deleteGroup.mutateAsync(id),
      onAfter: clearSelection,
    });
  };

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
          title="Grupos de Estoque"
          description="Organize o estoque em Setor → Família → Grupo, com saldo, valor e reservas por nível"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {perm.canCreate && (
                <Button variant="outline" onClick={() => setSuggestOpen(true)} className="gap-2">
                  <Sparkle className="h-4 w-4" />
                  <span className="hidden sm:inline">Sugestões de família</span>
                </Button>
              )}
              {perm.canCreate && (
                <Button onClick={() => openCreate({ title: 'Novo Grupo de Material' })} className="gap-2">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Novo Grupo</span>
                </Button>
              )}
            </div>
          }
        />

        {groups.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={FolderOpen}
              title="Nenhum grupo cadastrado"
              description="Crie o primeiro grupo de produtos para organizar o estoque por setor e família."
              action={perm.canCreate ? <Button onClick={() => openCreate({ title: 'Novo Grupo de Material' })} className="gap-2"><Plus className="h-4 w-4" />Novo Grupo</Button> : undefined}
            />
          </Panel>
        ) : (
          <Panel
            eyebrow="ESTOQUE · GRUPOS"
            title="Árvore de Estoque"
            subtitle={`${groups.length} ${groups.length === 1 ? 'grupo' : 'grupos'}`}
            flush
          >
            <GroupStockTree
              groups={groups}
              products={products as unknown as ProductLite[]}
              rollups={rollups}
              perm={perm}
              selectedLeafIds={selectedLeafIds}
              onToggleLeaf={toggleLeaf}
              onEdit={setEditGroup}
              onManageItems={setItemsGroup}
              onDelete={(g) => deleteGroup.mutate(g.id)}
              onNewFamily={(sector) => openCreate({ sector, parentId: null, lock: true, title: `Nova família em ${sectorLabel(sector)}` })}
              onNewSubgroup={(family) => openCreate({ sector: family.sector ?? undefined, parentId: family.id, lock: true, title: `Novo subgrupo em ${family.name}` })}
            />
          </Panel>
        )}
      </div>

      {/* Criar grupo / família / subgrupo (mount fresco por contexto) */}
      {createCtx && (
        <GroupCreateDialog
          key={createCtx.key}
          open
          onOpenChange={(o) => { if (!o) setCreateCtx(null); }}
          initialSector={createCtx.sector}
          initialParentId={createCtx.parentId}
          lockHierarchy={createCtx.lock}
          titleText={createCtx.title}
        />
      )}

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

      <MoveGroupsDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        groups={groups}
        rollups={rollups}
        selectedIds={selectedLeafIds}
        onDone={clearSelection}
      />

      <FamilySuggestionsDialog open={suggestOpen} onOpenChange={setSuggestOpen} />

      {selectedLeafIds.size > 0 && (
        <BulkActionsBar
          selectedIds={selectedLeafIds}
          onClear={clearSelection}
          itemLabel={selectedLeafIds.size === 1 ? 'grupo' : 'grupos'}
          actions={[
            {
              label: 'Mover para família',
              variant: 'default',
              icon: <ArrowsLeftRight className="h-3.5 w-3.5" />,
              onClick: () => setMoveOpen(true),
            },
            ...(perm.canDelete ? [{
              label: 'Excluir',
              variant: 'destructive' as const,
              icon: <Trash2 className="h-3.5 w-3.5" />,
              onClick: handleBulkDelete,
            }] : []),
          ]}
        />
      )}
    </>
  );
}
