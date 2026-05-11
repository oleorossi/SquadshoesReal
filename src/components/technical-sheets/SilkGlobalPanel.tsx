import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Plus, Pencil, Loader2, Search, Image as ImageIcon,
  User, Users as UsersIcon, Save, Upload, X, Footprints,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useClients, useEconomicGroups } from '@/hooks/useClients';
import { useProducts } from '@/hooks/useProducts';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { SignedImage } from '@/components/ui/signed-image';

type SilkScope = 'all' | 'default' | 'client' | 'economic_group';

interface SilkGlobalPanelProps {
  /**
   * Escopo da listagem:
   *   - 'all': mostra tudo (default)
   *   - 'default': só padrão do solado (sem cliente/grupo)
   *   - 'client': só silks customizadas por cliente
   *   - 'economic_group': só silks customizadas por grupo econômico
   * Quando scope ≠ 'all', o dialog de criação pré-bloqueia os campos
   * não relevantes pra que o usuário não erre.
   */
  scope?: SilkScope;
}

export function SilkGlobalPanel({ scope = 'all' }: SilkGlobalPanelProps = {}) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: clients = [] } = useClients();
  const { data: groups = [] } = useEconomicGroups();

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ['sole_silk_registrations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sole_silk_registrations')
        .select('*, clients(nome_fantasia), economic_groups(name)');
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  const { data: products = [] } = useProducts();

  const getBaseName = (name: string) =>
    name.replace(/\s*-\s*(Preto|Caramelo|Branco|Nude|Vermelho|Azul|Rosa|Verde|Cinza|Ouro|Prata)$/i, '').trim();

  const soleProducts = products.filter((p: any) => p.category === 'Solado');

  const availableSoles = React.useMemo(() => {
    const map = new Map();
    soleProducts.forEach((p: any) => {
      const baseName = getBaseName(p.name);
      if (!map.has(baseName)) map.set(baseName, p);
    });
    return Array.from(map.values()).sort((a: any, b: any) =>
      getBaseName(a.name).localeCompare(getBaseName(b.name)),
    );
  }, [soleProducts]);

  const [formData, setFormData] = useState({
    sole_type: '',
    sole_product_id: '',
    client_id: '',
    economic_group_id: '',
    shoe_category: '',
    silk_name: '',
    silk_url: '',
  });
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Selecione um arquivo de imagem.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('A imagem deve ter no máximo 5MB.'); return; }
    setUploading(true);
    try {
      const safeExt = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
      const fileName = `${Math.random().toString(36).substring(2)}.${safeExt}`;
      const filePath = `silks/${fileName}`;
      const { error: uploadError } = await supabase.storage.from('silk-images').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('silk-images').getPublicUrl(filePath);
      setFormData(prev => ({ ...prev, silk_url: publicUrl }));
      toast.success('Imagem carregada com sucesso!');
    } catch (error: any) {
      toast.error('Erro no upload: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const upsertMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (editingId) {
        const { error } = await supabase.from('sole_silk_registrations').update(data).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('sole_silk_registrations').insert(data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sole_silk_registrations'] });
      toast.success(editingId ? 'Cadastro atualizado!' : 'Cadastro criado!');
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: Error) => toast.error('Erro: ' + err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sole_silk_registrations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sole_silk_registrations'] });
      toast.success('Cadastro removido!');
    },
    onError: (err: Error) => toast.error('Erro: ' + err.message),
  });

  const resetForm = () => {
    setFormData({ sole_type: '', sole_product_id: '', client_id: '', economic_group_id: '', shoe_category: '', silk_name: '', silk_url: '' });
    setEditingId(null);
  };

  const handleEdit = (reg: any) => {
    setEditingId(reg.id);
    setFormData({
      sole_type: reg.sole_type || '',
      sole_product_id: reg.sole_product_id || '',
      client_id: reg.client_id || '',
      economic_group_id: reg.economic_group_id || '',
      shoe_category: reg.shoe_category || '',
      silk_name: reg.silk_name || '',
      silk_url: reg.silk_url || '',
    });
    setDialogOpen(true);
  };

  const filtered = registrations
    .filter((r: any) => {
      // Filtro por escopo (sub-aba)
      if (scope === 'default') return !r.client_id && !r.economic_group_id;
      if (scope === 'client') return !!r.client_id;
      if (scope === 'economic_group') return !!r.economic_group_id;
      return true;
    })
    .filter((r: any) =>
      (r.sole_type || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.silk_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.clients?.nome_fantasia || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.economic_groups?.name || '').toLowerCase().includes(searchTerm.toLowerCase()),
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por solado, silk ou cliente..."
            className="pl-9"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <Button onClick={() => { resetForm(); setDialogOpen(true); }} className="gap-2" size="sm">
          <Plus className="h-4 w-4" />
          Novo Cadastro
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-0" />
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Solado</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Aplicação</TableHead>
                  <TableHead>Silk / Arte</TableHead>
                  <TableHead className="w-[100px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                      Nenhum registro encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((reg: any) => {
                    const product = products.find((p: any) => p.id === reg.sole_product_id);
                    const displayName = reg.sole_type || (product ? getBaseName(product.name) : 'N/A');
                    return (
                      <TableRow key={reg.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Footprints className="h-4 w-4 text-stone-400" />
                            {displayName}
                          </div>
                        </TableCell>
                        <TableCell>
                          {reg.shoe_category ? (
                            <Badge variant="outline">{reg.shoe_category}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Todos</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {reg.client_id ? (
                            <Badge variant="outline" className="gap-1">
                              <User className="h-3 w-3" />
                              Cliente: {reg.clients?.nome_fantasia}
                            </Badge>
                          ) : reg.economic_group_id ? (
                            <Badge variant="secondary" className="gap-1">
                              <UsersIcon className="h-3 w-3" />
                              Grupo: {reg.economic_groups?.name}
                            </Badge>
                          ) : (
                            <Badge variant="outline">Padrão Geral</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {reg.silk_url ? (
                              <div className="h-10 w-10 border rounded overflow-hidden bg-card flex-shrink-0">
                                <SignedImage src={reg.silk_url} className="h-full w-full object-contain" />
                              </div>
                            ) : (
                              <div className="h-10 w-10 border rounded bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
                                <ImageIcon className="h-5 w-5" />
                              </div>
                            )}
                            <span className="font-medium">{reg.silk_name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(reg)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <DeleteConfirmButton
                              onConfirm={() => deleteMutation.mutate(reg.id)}
                              title="Excluir cadastro?"
                              description="Esta ação não pode ser desfeita."
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Cadastro' : 'Novo Cadastro de Silk'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto px-1">
            <div className="space-y-2">
              <label className="text-sm font-medium">Solado (Integração com Estoque)</label>
              <Select
                value={formData.sole_product_id}
                onValueChange={val => {
                  const p = products.find((x: any) => x.id === val);
                  if (p) {
                    const baseName = getBaseName((p as any).name);
                    setFormData(prev => ({ ...prev, sole_product_id: val, sole_type: baseName }));
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione o solado" /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {availableSoles.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      Todos os solados já possuem cadastro ou não há solados disponíveis.
                    </div>
                  ) : (
                    availableSoles.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{getBaseName(p.name)}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Categoria (Opcional)</label>
              <Select
                value={formData.shoe_category || 'all'}
                onValueChange={val => setFormData(prev => ({ ...prev, shoe_category: val === 'all' ? '' : val }))}
              >
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos (Adulto + Infantil)</SelectItem>
                  <SelectItem value="Adulto">Adulto</SelectItem>
                  <SelectItem value="Infantil">Infantil</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome da Silk</label>
                <Input
                  placeholder="Ex: Logo Cliente"
                  value={formData.silk_name}
                  onChange={e => setFormData(prev => ({ ...prev, silk_name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Arte / Imagem</label>
                <div className="flex items-center gap-2">
                  {formData.silk_url ? (
                    <div className="relative group">
                      <div className="h-10 w-10 border rounded overflow-hidden bg-card">
                        <SignedImage src={formData.silk_url} className="h-full w-full object-contain" />
                      </div>
                      <button
                        onClick={() => setFormData(prev => ({ ...prev, silk_url: '' }))}
                        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      type="button" variant="outline" size="sm"
                      className="w-full gap-2 border-dashed"
                      onClick={() => document.getElementById('silk-upload-global')?.click()}
                      disabled={uploading}
                    >
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploading ? 'Carregando...' : 'Upload'}
                    </Button>
                  )}
                  <input
                    id="silk-upload-global"
                    type="file" accept="image/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </div>
              </div>
            </div>

            {scope !== 'default' && (
              <div className={scope === 'all' ? 'grid grid-cols-2 gap-4' : ''}>
                {(scope === 'all' || scope === 'client') && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Cliente {scope === 'client' ? <span className="text-destructive">*</span> : '(Opcional)'}
                    </label>
                    <Select
                      value={formData.client_id || 'none'}
                      onValueChange={val => setFormData(prev => ({ ...prev, client_id: val === 'none' ? '' : val, economic_group_id: '' }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                      <SelectContent>
                        {scope === 'all' && <SelectItem value="none">Nenhum (Geral)</SelectItem>}
                        {clients.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.nome_fantasia}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(scope === 'all' || scope === 'economic_group') && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Grupo Econômico {scope === 'economic_group' ? <span className="text-destructive">*</span> : '(Opcional)'}
                    </label>
                    <Select
                      value={formData.economic_group_id || 'none'}
                      onValueChange={val => setFormData(prev => ({ ...prev, economic_group_id: val === 'none' ? '' : val, client_id: '' }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione um grupo" /></SelectTrigger>
                      <SelectContent>
                        {scope === 'all' && <SelectItem value="none">Nenhum (Geral)</SelectItem>}
                        {groups.map((g: any) => (
                          <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            {scope === 'default' && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                <strong>Padrão do solado:</strong> esta silk será usada por padrão quando nenhum cliente
                ou grupo econômico tiver silk própria cadastrada.
              </div>
            )}

            <div className="pt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => upsertMutation.mutate({
                  ...formData,
                  client_id: formData.client_id === 'none' ? '' : formData.client_id,
                  economic_group_id: formData.economic_group_id === 'none' ? '' : formData.economic_group_id,
                  shoe_category: formData.shoe_category || '',
                })}
                disabled={
                  upsertMutation.isPending
                  || !formData.sole_product_id
                  || !formData.silk_name
                  || (scope === 'client' && !formData.client_id)
                  || (scope === 'economic_group' && !formData.economic_group_id)
                }
              >
                {upsertMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <Save className="h-4 w-4 mr-2" />}
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
