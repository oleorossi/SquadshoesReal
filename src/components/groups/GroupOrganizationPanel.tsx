import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDebounce } from 'use-debounce';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Sparkle, ArrowsLeftRight, Trash as Trash2, FolderOpen } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { confirmAndBulkDelete } from '@/lib/bulkConfirm';
import { useGroups, useDeleteGroup, ProductGroup } from '@/hooks/useGroups';
import { useProducts, useAddProduct, ProductSchema } from '@/hooks/useProducts';
import { useAddComponentSheet } from '@/hooks/useComponentSheets';
import { useGroupStockRollups } from '@/hooks/useGroupOrganization';
import { useCan } from '@/hooks/useAccessControl';
import { sectorLabel } from '@/lib/categoryFromGroup';
import type { ProductFormData } from '@/types/inventory';
import GroupDialog from '@/components/groups/GroupDialog';
import GroupCreateDialog from '@/components/groups/GroupCreateDialog';
import GroupItemsManager from '@/components/groups/GroupItemsManager';
import GroupStockTree, { type ProductLite } from '@/components/groups/GroupStockTree';
import MoveGroupsDialog from '@/components/groups/MoveGroupsDialog';
import FamilySuggestionsDialog from '@/components/groups/FamilySuggestionsDialog';
import { ProductFormDialog } from '@/components/inventory/ProductFormDialog';

type CreateCtx = { key: number; sector?: string; parentId?: string | null; lock?: boolean; title?: string };

interface Props {
  /** Path para gate de permissão (useCan): '/grupos' ou '/estoque'. */
  permPath: string;
  /** Ações extras específicas do host (ex.: Importar XML, escanear) na barra. */
  extraActions?: ReactNode;
}

/**
 * Painel único de organização do estoque: árvore Setor → Família → Grupo com
 * métricas, edição de grupo/família/subgrupo, mover em massa, sugestões de
 * família e CRUD de itens (criar via ProductFormDialog; editar abre o editor
 * canônico /estoque/:id). Reusado pela página /grupos e pela aba Materiais do
 * Estoque. Ver specs/grupos-estoque.md.
 */
export default function GroupOrganizationPanel({ permPath, extraActions }: Props) {
  const navigate = useNavigate();
  const { data: groups = [], isLoading } = useGroups();
  const { data: products = [] } = useProducts();
  const { data: rollups = new Map() } = useGroupStockRollups();
  const deleteGroup = useDeleteGroup();
  const addProduct = useAddProduct();
  const addComponentSheet = useAddComponentSheet();
  const perm = useCan(permPath);

  const [editGroup, setEditGroup] = useState<ProductGroup | null>(null);
  const [itemsGroup, setItemsGroup] = useState<ProductGroup | null>(null);
  const [createCtx, setCreateCtx] = useState<CreateCtx | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [selectedLeafIds, setSelectedLeafIds] = useState<Set<string>>(new Set());
  // ?q= REATIVO: o ⌘K navega pra /grupos?q=<nome> e a tela pode já estar aberta
  // (AppLayout keia só por pathname — sem remontagem).
  const [searchParams] = useSearchParams();
  const urlQ = searchParams.get('q') || '';
  const [search, setSearch] = useState(urlQ);
  useEffect(() => { if (urlQ) setSearch(urlQ); }, [urlQ]);
  const [debouncedSearch] = useDebounce(search, 300);
  const [addOpen, setAddOpen] = useState(false);
  const [addGroupId, setAddGroupId] = useState<string | undefined>(undefined);
  const keyRef = useRef(0);

  const toggleLeaf = (id: string) => setSelectedLeafIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const clearSelection = () => setSelectedLeafIds(new Set());
  const openCreate = (ctx: Omit<CreateCtx, 'key'>) => setCreateCtx({ key: ++keyRef.current, ...ctx });

  const groupsById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);

  // Criar material (reusa a mesma lógica do MaterialsTab: valida + auto ficha).
  const handleAdd = async (data: ProductFormData, createSheet?: boolean) => {
    const toastId = toast.loading('Adicionando material...');
    try {
      const validated = ProductSchema.parse(data);
      const result = await addProduct.mutateAsync(validated as any);
      const groupAutoSheet = data.group_id && groupsById.get(data.group_id)?.auto_component_sheet;
      if ((createSheet || groupAutoSheet) && result?.id) {
        try {
          await addComponentSheet.mutateAsync({
            product_id: result.id,
            dimensions_length: data.dimensions_length || 0,
            dimensions_width: data.dimensions_width || 0,
            dimensions_thickness: data.dimensions_thickness || 0,
            dimensions_unit: data.dimensions_unit || 'mm',
            yield_per_size: {}, waste_pct: 8, notes: '',
          });
        } catch {
          toast.error('Material criado, mas erro ao criar ficha técnica automática');
        }
      }
      toast.dismiss(toastId);
    } catch (error) {
      toast.dismiss(toastId);
      if (error instanceof z.ZodError) error.errors.forEach(e => toast.error(e.message));
      else toast.error('Erro ao adicionar material');
    }
  };

  const openAddGlobal = () => { setAddGroupId(undefined); setAddOpen(true); };
  const openAddToGroup = (g: ProductGroup) => { setAddGroupId(g.id); setAddOpen(true); };
  const openEditItem = (item: ProductLite) => navigate(`/estoque/${item.id}`);

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedLeafIds);
    const sampleLines = groups.filter(g => selectedLeafIds.has(g.id)).slice(0, 5).map(g => `• ${g.name}`);
    await confirmAndBulkDelete({
      ids, entityLabel: 'grupo', sampleLines,
      deleteOne: (id) => deleteGroup.mutateAsync(id),
      onAfter: clearSelection,
    });
  };

  return (
    <div className="space-y-4">
      {/* Barra: busca + ações */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar grupo, material ou SKU…"
          className="flex-1 min-w-[200px]"
          inputClassName="h-9"
        />
        {extraActions}
        {perm.canCreate && (
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setSuggestOpen(true)}>
            <Sparkle className="h-4 w-4" />
            <span className="hidden sm:inline">Sugestões de família</span>
          </Button>
        )}
        {perm.canCreate && (
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => openCreate({ title: 'Novo Grupo de Material' })}>
            <FolderOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Novo grupo</span>
          </Button>
        )}
        {perm.canCreate && (
          <Button size="sm" className="h-9 gap-1.5" onClick={openAddGlobal}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo material</span>
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Nenhum grupo cadastrado"
          description="Crie o primeiro grupo para organizar o estoque por setor e família."
          action={perm.canCreate ? <Button onClick={() => openCreate({ title: 'Novo Grupo de Material' })} className="gap-2"><Plus className="h-4 w-4" />Novo grupo</Button> : undefined}
        />
      ) : (
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
          <GroupStockTree
            groups={groups}
            products={products as unknown as ProductLite[]}
            rollups={rollups}
            perm={perm}
            filter={debouncedSearch}
            onClearFilter={() => setSearch('')}
            selectedLeafIds={selectedLeafIds}
            onToggleLeaf={toggleLeaf}
            onEdit={setEditGroup}
            onManageItems={setItemsGroup}
            onDelete={(g) => deleteGroup.mutate(g.id)}
            onNewFamily={(sector) => openCreate({ sector, parentId: null, lock: true, title: `Nova família em ${sectorLabel(sector)}` })}
            onNewSubgroup={(family) => openCreate({ sector: family.sector ?? undefined, parentId: family.id, lock: true, title: `Novo subgrupo em ${family.name}` })}
            onEditItem={openEditItem}
            onAddItem={openAddToGroup}
          />
        </div>
      )}

      {/* Diálogos */}
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
        <GroupDialog open={!!editGroup} onOpenChange={(o) => { if (!o) setEditGroup(null); }} group={editGroup} />
      )}

      <GroupItemsManager
        group={itemsGroup}
        groups={groups}
        open={!!itemsGroup}
        onOpenChange={(o) => { if (!o) setItemsGroup(null); }}
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

      <ProductFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={handleAdd}
        product={null}
        onEditProduct={(p) => navigate(`/estoque/${p.id}`)}
        defaultGroupId={addGroupId}
      />

      {selectedLeafIds.size > 0 && (
        <BulkActionsBar
          selectedIds={selectedLeafIds}
          onClear={clearSelection}
          itemLabel={selectedLeafIds.size === 1 ? 'grupo' : 'grupos'}
          actions={[
            { label: 'Mover para família', variant: 'default', icon: <ArrowsLeftRight className="h-3.5 w-3.5" />, onClick: () => setMoveOpen(true) },
            ...(perm.canDelete ? [{ label: 'Excluir', variant: 'destructive' as const, icon: <Trash2 className="h-3.5 w-3.5" />, onClick: handleBulkDelete }] : []),
          ]}
        />
      )}
    </div>
  );
}
