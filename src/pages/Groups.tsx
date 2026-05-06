import AppLayout from "@/components/layout/AppLayout";
import { useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, FolderOpen, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useGroups, useAddGroup, useUpdateGroup, useDeleteGroup, ProductGroup } from '@/hooks/useGroups';
import { useProducts } from '@/hooks/useProducts';
import { Switch } from '@/components/ui/switch';
import SupplierPanel from '@/components/groups/SupplierPanel';
import GroupEditDialog from '@/components/groups/GroupEditDialog';

export default function Groups() {
  const { data: groups = [], isLoading, isError } = useGroups();
  const { data: products = [] } = useProducts();
  const addGroup = useAddGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductGroup | null>(null);
  const [form, setForm] = useState({ name: '', description: '', auto_component_sheet: false });
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState<ProductGroup | null>(null);

  const openAdd = () => { setEditing(null); setForm({ name: '', description: '', auto_component_sheet: false }); setDialogOpen(true); };
  const openEdit = (g: ProductGroup) => { setEditGroup(g); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addGroup.mutate(form);
    setDialogOpen(false);
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
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Grupos de Produtos</h2>
            <p className="text-sm text-muted-foreground">Organize produtos em grupos com fornecedores, materiais e informações técnicas</p>
          </div>
          <Button onClick={openAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo Grupo</span>
          </Button>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">Nome</TableHead>
                <TableHead className="font-semibold">Descrição</TableHead>
                <TableHead className="font-semibold text-center">Produtos</TableHead>
                <TableHead className="font-semibold text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                    <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    Nenhum grupo cadastrado
                  </TableCell>
                </TableRow>
              ) : (
                groups.map(g => {
                  const isExpanded = expandedGroup === g.id;
                  return (
                    <Collapsible key={g.id} asChild open={isExpanded} onOpenChange={() => setExpandedGroup(isExpanded ? null : g.id)}>
                      <>
                        <TableRow className="group">
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
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditing(null); setForm({ name: '', description: '', auto_component_sheet: false }); } }}>
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
    </AppLayout>
  );
}
