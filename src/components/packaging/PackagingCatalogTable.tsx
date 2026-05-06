import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import { usePackagingCatalog, PackagingCatalogItem } from '@/hooks/usePackaging';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export default function PackagingCatalogTable() {
  const { data: catalog = [], isLoading, refetch } = usePackagingCatalog();
  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PackagingCatalogItem | null>(null);
  const [form, setForm] = useState<Omit<PackagingCatalogItem, 'id'>>({
    nome: '',
    tipo: 'individual',
    comprimento_ext: 0,
    largura_ext: 0,
    altura_ext: 0,
    capacidade_pares: 1,
    is_active: true
  });

  const filtered = catalog.filter(item => 
    item.nome.toLowerCase().includes(search.toLowerCase())
  );

  const openNew = () => {
    setEditingItem(null);
    setForm({
      nome: '',
      tipo: 'individual',
      comprimento_ext: 0,
      largura_ext: 0,
      altura_ext: 0,
      capacidade_pares: 1,
      is_active: true
    });
    setIsDialogOpen(true);
  };

  const openEdit = (item: PackagingCatalogItem) => {
    setEditingItem(item);
    setForm({
      nome: item.nome,
      tipo: item.tipo,
      comprimento_ext: item.comprimento_ext,
      largura_ext: item.largura_ext,
      altura_ext: item.altura_ext,
      capacidade_pares: item.capacidade_pares,
      is_active: item.is_active
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.nome) {
      toast.error('Nome é obrigatório');
      return;
    }

    try {
      if (editingItem) {
        const { error } = await supabase
          .from('packaging_catalog')
          .update(form)
          .eq('id', editingItem.id);
        if (error) throw error;
        toast.success('Item atualizado');
      } else {
        const { error } = await supabase
          .from('packaging_catalog')
          .insert(form);
        if (error) throw error;
        toast.success('Item criado');
      }
      setIsDialogOpen(false);
      refetch();
    } catch (error) {
      toast.error('Erro ao salvar item');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja excluir este item?')) return;
    try {
      const { error } = await supabase
        .from('packaging_catalog')
        .delete()
        .eq('id', id);
      if (error) throw error;
      toast.success('Item excluído');
      refetch();
    } catch (error) {
      toast.error('Erro ao excluir item');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Buscar no catálogo..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Item
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Dimensões (cm)</TableHead>
              <TableHead>Capacidade (pares)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">Carregando...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum item encontrado</TableCell>
              </TableRow>
            ) : filtered.map(item => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.nome}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {item.tipo}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm font-mono">
                  {item.comprimento_ext} × {item.largura_ext} × {item.altura_ext}
                </TableCell>
                <TableCell>{item.capacidade_pares}</TableCell>
                <TableCell>
                  <Badge variant={item.is_active ? 'default' : 'secondary'}>
                    {item.is_active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(item)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => handleDelete(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Editar Item' : 'Novo Item do Catálogo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input 
                value={form.nome}
                onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Caixa Master 12P G"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select 
                  value={form.tipo} 
                  onValueChange={(v: any) => setForm(f => ({ ...f, tipo: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="master">Master</SelectItem>
                    <SelectItem value="colmeia">Colmeia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Capacidade (Pares)</Label>
                <Input 
                  type="number"
                  value={form.capacidade_pares}
                  onChange={e => setForm(f => ({ ...f, capacidade_pares: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Comp. (cm)</Label>
                <Input 
                  type="number"
                  value={form.comprimento_ext}
                  onChange={e => setForm(f => ({ ...f, comprimento_ext: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Larg. (cm)</Label>
                <Input 
                  type="number"
                  value={form.largura_ext}
                  onChange={e => setForm(f => ({ ...f, largura_ext: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Alt. (cm)</Label>
                <Input 
                  type="number"
                  value={form.altura_ext}
                  onChange={e => setForm(f => ({ ...f, altura_ext: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input 
                type="checkbox"
                id="active"
                checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-border"
              />
              <Label htmlFor="active">Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
