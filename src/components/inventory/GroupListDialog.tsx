import { useState, useMemo, useRef } from 'react';
import { stripColorFromName } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Search, Package, FolderOpen, Pencil, Trash2, Wand2, Loader2, GripVertical, Palette, FileBox } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useGroups, useAddGroup, useUpdateGroup, useDeleteGroup, ProductGroup } from '@/hooks/useGroups';
import { useProducts, useUpdateProduct } from '@/hooks/useProducts';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import GroupEditDialog from '@/components/groups/GroupEditDialog';

interface GroupListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GroupListDialog({ open, onOpenChange }: GroupListDialogProps) {
  const { data: groups = [] } = useGroups();
  const { data: products = [] } = useProducts();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const addGroup = useAddGroup();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editingGroupFull, setEditingGroupFull] = useState<ProductGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<{ id: string; name: string; itemCount: number } | null>(null);
  const [autoGrouping, setAutoGrouping] = useState(false);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const dragProductId = useRef<string | null>(null);

  const handleDragStart = (e: React.DragEvent, productId: string) => {
    dragProductId.current = productId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', productId);
    // Make the dragged element semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    dragProductId.current = null;
    setDragOverGroupId(null);
  };

  const handleDragOver = (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroupId(groupId);
  };

  const handleDragLeave = () => {
    setDragOverGroupId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetGroupId: string | null) => {
    e.preventDefault();
    setDragOverGroupId(null);
    const productId = dragProductId.current || e.dataTransfer.getData('text/plain');
    if (!productId) return;

    const product = products.find(p => p.id === productId);
    if (!product) return;
    if (product.group_id === targetGroupId) return; // Already in this group

    try {
      const { error } = await supabase
        .from('products')
        .update({ group_id: targetGroupId })
        .eq('id', productId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['products'] });
      const targetName = targetGroupId
        ? groups.find(g => g.id === targetGroupId)?.name || 'grupo'
        : 'Sem grupo';
      toast.success(`"${product.name}" movido para ${targetName}`);
    } catch (err: any) {
      toast.error(`Erro ao mover: ${err.message}`);
    }
  };

  /** Extract base name by removing color suffix (last word) */
  function getBaseName(name: string): string {
    // First check for explicit separators (: or -)
    const colonIdx = name.lastIndexOf(':');
    if (colonIdx > 0) return name.substring(0, colonIdx).trim();
    const dashIdx = name.lastIndexOf(' - ');
    if (dashIdx > 0) return name.substring(0, dashIdx).trim();
    
    // Otherwise, remove the last word (usually the color)
    const words = name.trim().split(/\s+/);
    if (words.length <= 1) return ''; // Single-word names cannot derive a base — skip
    return words.slice(0, -1).join(' ');
  }

  /** Find ALL items with duplicate base names across all groups and regroup them */
  const handleAutoGroup = async () => {
    const allItems = products;
    // Group ALL products by base name (not just ungrouped)
    const byBase = new Map<string, typeof products>();
    for (const p of allItems) {
      const base = getBaseName(p.name).toUpperCase();
      if (!base) continue; // Skip single-word names (likely colors, not materials)
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base)!.push(p);
    }
    // Only consider bases with 2+ items
    const candidates = [...byBase.entries()].filter(([, items]) => items.length >= 2);
    if (candidates.length === 0) {
      toast.info('Nenhum item com nome duplicado encontrado');
      return;
    }

    // Check which items actually need to be moved (different group or no group)
    let totalToMove = 0;
    const movePlan: { baseName: string; items: typeof products; targetGroupId?: string }[] = [];

    for (const [baseName, items] of candidates) {
      // Find or detect the existing group for this base name
      const existing = groups.find(g => g.name.toUpperCase() === baseName);
      const targetGroupId = existing?.id;

      // Items that need regrouping: ungrouped or in a different group
      const needsMove = items.filter(p => !p.group_id || (targetGroupId && p.group_id !== targetGroupId) || !targetGroupId);
      
      if (needsMove.length > 0) {
        movePlan.push({ baseName, items, targetGroupId });
        totalToMove += needsMove.length;
      }
    }

    if (totalToMove === 0) {
      toast.info('Todos os itens já estão corretamente agrupados');
      return;
    }

    setAutoGrouping(true);
    let grouped = 0;
    try {
      for (const { baseName, items, targetGroupId } of movePlan) {
        let groupId: string;
        if (targetGroupId) {
          groupId = targetGroupId;
        } else {
          // Create new group
          const { data, error } = await supabase
            .from('product_groups')
            .insert({ name: baseName, description: 'Agrupado automaticamente' })
            .select()
            .single();
          if (error) throw error;
          groupId = data.id;
        }
        // Move ALL items with this base name to the correct group
        const ids = items.map(p => p.id);
        const { error } = await supabase.from('products').update({ group_id: groupId }).in('id', ids);
        if (error) throw error;
        grouped += items.length;
      }
      qc.invalidateQueries({ queryKey: ['product_groups'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast.success(`${grouped} itens (re)agrupados em ${movePlan.length} grupo(s)`);
    } catch (err: any) {
      toast.error(`Erro ao agrupar: ${err.message}`);
    } finally {
      setAutoGrouping(false);
    }
  };

  const groupsWithProducts = useMemo(() => {
    const q = search.toLowerCase();
    return groups
      .map(g => {
        const items = products.filter(p => p.group_id === g.id);
        const matchGroup = g.name.toLowerCase().includes(q);
        const matchItems = items.filter(p =>
          p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
        );
        if (!matchGroup && matchItems.length === 0 && q) return null;
        return { ...g, items: q && !matchGroup ? matchItems : items };
      })
      .filter(Boolean) as (typeof groups[0] & { items: typeof products })[];
  }, [groups, products, search]);

  const ungrouped = useMemo(() => {
    const q = search.toLowerCase();
    const items = products.filter(p => !p.group_id);
    if (!q) return items;
    return items.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, search]);

  const handleSaveEdit = () => {
    // no longer used - handled by GroupEditDialog
  };

  const handleConfirmDelete = () => {
    if (!deletingGroup) return;
    deleteGroup.mutate(deletingGroup.id);
    setDeletingGroup(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Grupos de Itens
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar grupo ou item..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={handleAutoGroup} disabled={autoGrouping}>
              {autoGrouping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Reagrupar todos</span>
              <span className="sm:hidden">Agrupar</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            O botão "Reagrupar" varre <strong>todos</strong> os itens (inclusive de outros grupos) e move para o grupo correto pelo nome base.
            Você também pode <strong>arrastar</strong> um item e soltá-lo em outro grupo.
          </p>

          <div className="flex-1 min-h-0 -mx-6 px-6 overflow-y-auto">
            {groupsWithProducts.length === 0 && ungrouped.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{search ? 'Nenhum grupo ou item encontrado' : 'Nenhum grupo cadastrado'}</p>
              </div>
            ) : (
              <Accordion type="multiple" className="space-y-1">
                {groupsWithProducts.map(g => (
                  <AccordionItem key={g.id} value={g.id} className={`border rounded-lg px-1 transition-colors ${dragOverGroupId === g.id ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : ''}`}>
                    <div
                      className="flex items-center"
                      onDragOver={(e) => handleDragOver(e, g.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, g.id)}
                    >
                      <AccordionTrigger className="hover:no-underline py-3 flex-1">
                        <div className="flex items-center gap-3">
                          <FolderOpen className="h-4 w-4 text-primary shrink-0" />
                          <span className="font-semibold text-sm">{g.name}</span>
                          <Badge variant="secondary" className="text-xs font-mono">{g.items.length} itens</Badge>
                          {(g as any).auto_component_sheet && (
                            <Badge variant="outline" className="text-[10px] gap-1 h-5 border-primary/40 text-primary bg-primary/5">
                              <FileBox className="h-3 w-3" /> BOM
                            </Badge>
                          )}
                          {(g as any).is_bom_color_source && (
                            <Badge variant="outline" className="text-[10px] gap-1 h-5 border-amber-500/40 text-amber-600 bg-amber-50 dark:bg-amber-500/10">
                              <Palette className="h-3 w-3" /> Cores
                            </Badge>
                          )}
                          {g.description && (
                            <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[200px]">{g.description}</span>
                          )}
                        </div>
                      </AccordionTrigger>
                      <div className="flex items-center gap-0.5 pr-2 shrink-0">
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={`h-7 w-7 ${(g as any).auto_component_sheet ? 'text-primary bg-primary/10' : 'text-muted-foreground'}`}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const newVal = !(g as any).auto_component_sheet;
                                  const { error } = await supabase
                                    .from('product_groups')
                                    .update({ auto_component_sheet: newVal })
                                    .eq('id', g.id);
                                  if (error) {
                                    toast.error('Erro ao atualizar');
                                  } else {
                                    qc.invalidateQueries({ queryKey: ['product_groups'] });
                                    toast.success(newVal ? `"${g.name}" incluído no BOM` : `"${g.name}" removido do BOM`);
                                  }
                                }}
                              >
                                <FileBox className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              {(g as any).auto_component_sheet ? 'Remover da Ficha de Componente (BOM)' : 'Incluir na Ficha de Componente (BOM)'}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={`h-7 w-7 ${(g as any).is_bom_color_source ? 'text-amber-600 bg-amber-500/10' : 'text-muted-foreground'}`}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const newVal = !(g as any).is_bom_color_source;
                                  const { error } = await supabase
                                    .from('product_groups')
                                    .update({ is_bom_color_source: newVal })
                                    .eq('id', g.id);
                                  if (error) {
                                    toast.error('Erro ao atualizar');
                                  } else {
                                    qc.invalidateQueries({ queryKey: ['product_groups'] });
                                    toast.success(newVal ? `"${g.name}" ativado como fonte de cores do BOM` : `"${g.name}" desativado das cores do BOM`);
                                  }
                                }}
                              >
                                <Palette className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              {(g as any).is_bom_color_source ? 'Desativar como fonte de cores' : 'Ativar como fonte de cores do BOM'}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const fullGroup = groups.find(gr => gr.id === g.id);
                                  if (fullGroup) setEditingGroupFull(fullGroup);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">Editar grupo</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingGroup({ id: g.id, name: g.name, itemCount: g.items.length });
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">Excluir grupo</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                    <AccordionContent>
                      <div
                        className={`space-y-1 pb-2 min-h-[32px] ${dragOverGroupId === g.id ? 'bg-primary/5 rounded' : ''}`}
                        onDragOver={(e) => handleDragOver(e, g.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, g.id)}
                      >
                        {g.items.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic pl-7 pb-2">
                            {dragOverGroupId === g.id ? 'Solte aqui para mover para este grupo' : 'Nenhum item neste grupo'}
                          </p>
                        ) : (
                          g.items.map(p => (
                            <div
                              key={p.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, p.id)}
                              onDragEnd={handleDragEnd}
                              className="flex items-center justify-between gap-2 pl-4 pr-2 py-1.5 rounded hover:bg-muted/50 cursor-grab active:cursor-grabbing select-none"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                                <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-sm truncate">{stripColorFromName(p.name, p.color)}</span>
                                {p.color && <Badge variant="secondary" className="text-[10px]">{p.color}</Badge>}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge variant="outline" className="text-xs font-mono">{p.sku}</Badge>
                                <span className="text-xs text-muted-foreground w-16 text-right">{p.quantity} {p.unit}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}

                {ungrouped.length > 0 && (
                  <AccordionItem
                    value="__ungrouped"
                    className={`border rounded-lg px-1 border-dashed ${dragOverGroupId === '__ungrouped' ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : ''}`}
                  >
                    <div
                      onDragOver={(e) => handleDragOver(e, '__ungrouped')}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, null)}
                    >
                      <AccordionTrigger className="hover:no-underline py-3">
                        <div className="flex items-center gap-3">
                          <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-semibold text-sm text-muted-foreground">Sem grupo</span>
                          <Badge variant="outline" className="text-xs font-mono">{ungrouped.length} itens</Badge>
                        </div>
                      </AccordionTrigger>
                    </div>
                    <AccordionContent>
                      <div
                        className={`space-y-1 pb-2 min-h-[32px] ${dragOverGroupId === '__ungrouped' ? 'bg-primary/5 rounded' : ''}`}
                        onDragOver={(e) => handleDragOver(e, '__ungrouped')}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, null)}
                      >
                        {ungrouped.map(p => (
                          <div
                            key={p.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, p.id)}
                            onDragEnd={handleDragEnd}
                            className="flex items-center justify-between gap-2 pl-4 pr-2 py-1.5 rounded hover:bg-muted/50 cursor-grab active:cursor-grabbing select-none"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                              <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm truncate">{stripColorFromName(p.name, p.color)}</span>
                              {p.color && <Badge variant="secondary" className="text-[10px]">{p.color}</Badge>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant="outline" className="text-xs font-mono">{p.sku}</Badge>
                              <span className="text-xs text-muted-foreground w-16 text-right">{p.quantity} {p.unit}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit group full dialog */}
      {editingGroupFull && (
        <GroupEditDialog
          open={!!editingGroupFull}
          onOpenChange={(o) => { if (!o) setEditingGroupFull(null); }}
          group={editingGroupFull}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingGroup} onOpenChange={(o) => { if (!o) setDeletingGroup(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir grupo "{deletingGroup?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingGroup && deletingGroup.itemCount > 0
                ? `Este grupo possui ${deletingGroup.itemCount} item(ns) vinculado(s). Os itens não serão excluídos, apenas ficarão sem grupo.`
                : 'Esta ação não pode ser desfeita.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
