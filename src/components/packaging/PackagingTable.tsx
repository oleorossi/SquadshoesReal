import { useState } from 'react';
import { useIndividualPackaging, useCreateIndividualPackaging, useUpdateIndividualPackaging } from '@/hooks/usePackaging';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, MagnifyingGlass as Search, PencilSimple as Edit, Package } from '@phosphor-icons/react';
import type { IndividualPackaging } from '@/types/packaging';
import PackagingForm from './PackagingForm';
import { Skeleton } from '@/components/ui/skeleton';

const PackagingTable = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedMaterial, setSelectedMaterial] = useState('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingPackaging, setEditingPackaging] = useState<IndividualPackaging | null>(null);

  const { data: packaging = [], isLoading, refetch } = useIndividualPackaging({
    packaging_type: selectedType === 'all' ? undefined : selectedType,
    material: selectedMaterial === 'all' ? undefined : selectedMaterial,
    is_active: true,
  });

  const createPackaging = useCreateIndividualPackaging();
  const updatePackaging = useUpdateIndividualPackaging();

  const filteredPackaging = packaging.filter((pack) =>
    pack.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    pack.product_reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
    pack.internal_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStockStatus = (current: number, minimum: number) => {
    if (current === 0) return { status: 'Sem estoque', variant: 'destructive' as const };
    if (current <= minimum) return { status: 'Estoque baixo', variant: 'secondary' as const };
    return { status: 'Normal', variant: 'default' as const };
  };

  const handleCreate = async (data: Omit<IndividualPackaging, 'id'>) => {
    await createPackaging.mutateAsync(data);
    setIsCreateDialogOpen(false);
    refetch();
  };

  const handleUpdate = async (data: Partial<IndividualPackaging>) => {
    if (!editingPackaging) return;
    await updatePackaging.mutateAsync({ id: editingPackaging.id, updates: data });
    setEditingPackaging(null);
    refetch();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros e Ações */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar embalagem..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-8 w-64"
            />
          </div>
          <Select value={selectedType} onValueChange={setSelectedType}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Todos os tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="individual">Individual</SelectItem>
              <SelectItem value="master">Master</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedMaterial} onValueChange={setSelectedMaterial}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Todos os materiais" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os materiais</SelectItem>
              <SelectItem value="cardboard">Papelão</SelectItem>
              <SelectItem value="plastic">Plástico</SelectItem>
              <SelectItem value="wood">Madeira</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" />
              Nova Embalagem
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nova Embalagem Individual</DialogTitle>
            </DialogHeader>
            <PackagingForm onSubmit={handleCreate} isLoading={createPackaging.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Resumo */}
      <p className="text-sm text-muted-foreground">
        Exibindo {filteredPackaging.length} de {packaging.length} embalagens
      </p>

      {/* Lista de Embalagens */}
      <div className="grid gap-4">
        {filteredPackaging.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Package className="h-12 w-12 text-muted-foreground/40 mb-3" />
              <p className="font-medium text-muted-foreground">Nenhuma embalagem encontrada</p>
              {searchTerm && (
                <p className="text-sm text-muted-foreground mt-1">Tente ajustar os filtros de busca</p>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredPackaging.map((pack) => {
            const stockStatus = getStockStatus(pack.current_stock, pack.minimum_stock);

            return (
              <Card key={pack.id}>
                <CardContent className="p-5">
                  {/* Cabeçalho */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-semibold">{pack.product_name}</p>
                      <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                        <span>Ref: {pack.product_reference}</span>
                        <span>Código: {pack.internal_code}</span>
                        <Badge variant="outline">{pack.packaging_type}</Badge>
                        <Badge variant="outline">{pack.material}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={stockStatus.variant}>{stockStatus.status}</Badge>
                      <Button variant="ghost" size="icon" onClick={() => setEditingPackaging(pack)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Informações principais */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Dimensões (L×W×H)</p>
                      <p className="font-mono font-medium">
                        {pack.dimensions.length}×{pack.dimensions.width}×{pack.dimensions.height} cm
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Volume</p>
                      <p className="font-mono font-medium">{pack.dimensions.volume.toLocaleString()} cm³</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Peso</p>
                      <p className="font-mono font-medium">{pack.dimensions.weight}g</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Custo Unit.</p>
                      <p className="font-mono font-medium">R$ {pack.unit_cost.toFixed(4)}</p>
                    </div>
                  </div>

                  {/* Estoque */}
                  <div className="grid grid-cols-3 gap-4 text-sm mt-3 pt-3 border-t">
                    <div>
                      <p className="text-xs text-muted-foreground">Estoque Atual</p>
                      <p className="font-mono font-medium">{pack.current_stock.toLocaleString()} unidades</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Estoque Mínimo</p>
                      <p className="font-mono font-medium">{pack.minimum_stock.toLocaleString()} unidades</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Fornecedor</p>
                      <p className="font-medium">{pack.supplier_name || 'Não informado'}</p>
                    </div>
                  </div>

                  {/* Observações */}
                  {pack.notes && (
                    <div className="mt-3 pt-3 border-t text-sm">
                      <p className="text-xs text-muted-foreground mb-1">Observações</p>
                      <p>{pack.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Dialog de Edição */}
      <Dialog open={!!editingPackaging} onOpenChange={() => setEditingPackaging(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Embalagem Individual</DialogTitle>
          </DialogHeader>
          {editingPackaging && (
            <PackagingForm
              initialData={editingPackaging}
              onSubmit={handleUpdate}
              isLoading={updatePackaging.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PackagingTable;
