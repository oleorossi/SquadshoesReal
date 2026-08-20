import { useState } from 'react';
import { Plus, PencilSimple as Pencil, Trash as Trash2, Package, CaretDown as ChevronDown, CaretUp as ChevronUp, Truck, FileText } from '@phosphor-icons/react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  useGroupSuppliers, useDeleteGroupSupplier, useAddGroupSupplier, useUpdateGroupSupplier,
  useGroupSupplierMaterials, useAddGroupSupplierMaterial, useUpdateGroupSupplierMaterial, useDeleteGroupSupplierMaterial,
  type GroupSupplier, type GroupSupplierMaterial,
} from '@/hooks/useGroupSuppliers';
import SupplierFormDialog from './SupplierFormDialog';
import MaterialFormDialog from './MaterialFormDialog';

function MaterialsTable({ supplier }: { supplier: GroupSupplier }) {
  const { data: materials = [] } = useGroupSupplierMaterials(supplier.id);
  const addMaterial = useAddGroupSupplierMaterial();
  const updateMaterial = useUpdateGroupSupplierMaterial();
  const deleteMaterial = useDeleteGroupSupplierMaterial();

  const [matDialogOpen, setMatDialogOpen] = useState(false);
  const [editingMat, setEditingMat] = useState<GroupSupplierMaterial | null>(null);

  const openAddMat = () => { setEditingMat(null); setMatDialogOpen(true); };
  const openEditMat = (m: GroupSupplierMaterial) => { setEditingMat(m); setMatDialogOpen(true); };

  const handleMatSubmit = (data: Partial<GroupSupplierMaterial>) => {
    if (addMaterial.isPending || updateMaterial.isPending) return; // evita gravação dupla por duplo clique
    if (editingMat) {
      updateMaterial.mutate({ id: editingMat.id, data });
    } else {
      addMaterial.mutate({ ...data, supplier_id: supplier.id, group_id: supplier.group_id, material_name: data.material_name || '' });
    }
  };

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-primary" />
          Materiais ({materials.length})
        </p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openAddMat}>
          <Plus className="h-3 w-3" /> Material
        </Button>
      </div>

      {materials.length > 0 && (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-xs">Material</TableHead>
                <TableHead className="text-xs">Cor</TableHead>
                <TableHead className="text-xs">Largura</TableHead>
                <TableHead className="text-xs">Espessura</TableHead>
                <TableHead className="text-xs">Unidade</TableHead>
                <TableHead className="text-xs text-right">Preço Unit.</TableHead>
                <TableHead className="text-xs">NF</TableHead>
                <TableHead className="text-xs text-right">Valor NF</TableHead>
                <TableHead className="text-xs text-center">Status</TableHead>
                <TableHead className="text-xs text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map(m => (
                <TableRow key={m.id} className="group/mat">
                  <TableCell className="text-xs font-medium">
                    <div>{m.material_name}</div>
                    {m.material_code && <div className="text-muted-foreground font-mono">{m.material_code}</div>}
                  </TableCell>
                  <TableCell className="text-xs">{m.color || '—'}</TableCell>
                  <TableCell className="text-xs">{m.width || '—'}</TableCell>
                  <TableCell className="text-xs">{m.thickness || '—'}</TableCell>
                  <TableCell className="text-xs">{m.unit}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{fmt(m.unit_price)}</TableCell>
                  <TableCell className="text-xs">
                    {m.invoice_number ? (
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3 text-muted-foreground" />
                        {m.invoice_number}
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono">{m.invoice_value ? fmt(m.invoice_value) : '—'}</TableCell>
                  <TableCell className="text-xs text-center">
                    <Badge variant="outline" className={m.active ? 'bg-success/15 text-success border-success/30' : 'bg-muted text-muted-foreground'}>
                      {m.active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-0.5 opacity-0 group-hover/mat:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditMat(m)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <DeleteConfirmButton onConfirm={() => deleteMaterial.mutate(m.id)} title="Remover material?" size="h-6 w-6" iconSize="h-3 w-3" />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <MaterialFormDialog open={matDialogOpen} onOpenChange={setMatDialogOpen} editing={editingMat} onSubmit={handleMatSubmit} />
    </div>
  );
}

export default function SupplierPanel({ groupId }: { groupId: string }) {
  const { data: suppliers = [] } = useGroupSuppliers(groupId);
  const addSupplier = useAddGroupSupplier();
  const updateSupplier = useUpdateGroupSupplier();
  const deleteSupplier = useDeleteGroupSupplier();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<GroupSupplier | null>(null);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  const openAdd = () => { setEditingSupplier(null); setDialogOpen(true); };
  const openEdit = (s: GroupSupplier) => { setEditingSupplier(s); setDialogOpen(true); };

  const handleSubmit = (data: Partial<GroupSupplier>) => {
    if (editingSupplier) {
      updateSupplier.mutate({ id: editingSupplier.id, data });
    } else {
      addSupplier.mutate({ ...data, group_id: groupId, supplier_name: data.supplier_name || '' });
    }
  };

  return (
    <div className="space-y-3 p-4 bg-muted/20 border-t">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Truck className="h-4 w-4 text-primary" />
          Fornecedores ({suppliers.length})
        </p>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openAdd}>
          <Plus className="h-3 w-3" /> Fornecedor
        </Button>
      </div>

      {suppliers.length === 0 && (
        <p className="text-xs text-muted-foreground py-3 text-center">Nenhum fornecedor cadastrado neste grupo.</p>
      )}

      <div className="space-y-2">
        {suppliers.map(s => {
          const isExpanded = expandedSupplier === s.id;
          return (
            <Collapsible key={s.id} open={isExpanded} onOpenChange={() => setExpandedSupplier(isExpanded ? null : s.id)}>
              <div className="rounded-lg border bg-card">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </CollapsibleTrigger>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{s.supplier_name}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {s.supplier_cnpj && <span>{s.supplier_cnpj}</span>}
                        {s.supplier_phone && <span>{s.supplier_phone}</span>}
                        {s.payment_terms && <Badge variant="outline" className="text-xs h-4">{s.payment_terms}</Badge>}
                        {s.lead_time_days > 0 && <span>{s.lead_time_days} dias</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <DeleteConfirmButton onConfirm={() => deleteSupplier.mutate(s.id)} title="Excluir fornecedor?" />
                  </div>
                </div>
                <CollapsibleContent>
                  <div className="border-t px-3 py-3">
                    {/* Supplier details summary */}
                    {(s.supplier_email || s.supplier_address || s.supplier_contact || s.notes) && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-xs">
                        {s.supplier_contact && (
                          <div><span className="text-muted-foreground">Contato:</span> {s.supplier_contact}</div>
                        )}
                        {s.supplier_email && (
                          <div><span className="text-muted-foreground">E-mail:</span> {s.supplier_email}</div>
                        )}
                        {s.supplier_address && (
                          <div className="col-span-2"><span className="text-muted-foreground">Endereço:</span> {s.supplier_address}</div>
                        )}
                        {s.notes && (
                          <div className="col-span-2 sm:col-span-4"><span className="text-muted-foreground">Obs:</span> {s.notes}</div>
                        )}
                      </div>
                    )}
                    <MaterialsTable supplier={s} />
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>

      <SupplierFormDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editingSupplier} onSubmit={handleSubmit} />
    </div>
  );
}
