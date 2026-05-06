import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Pencil, Loader2, Image as ImageIcon, User, Users as UsersIcon, Save, Upload, X, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SignedImage } from '@/components/ui/signed-image';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { useClients, useEconomicGroups } from '@/hooks/useClients';
import { toast } from 'sonner';

interface Props {
  soleProductId: string;
  soleName: string;
}

interface SilkForm {
  silk_name: string;
  silk_url: string;
  client_id: string;
  economic_group_id: string;
}

const EMPTY_FORM: SilkForm = { silk_name: '', silk_url: '', client_id: '', economic_group_id: '' };

export function SoleSilkPanel({ soleProductId, soleName }: Props) {
  const qc = useQueryClient();
  const { data: clients = [] } = useClients();
  const { data: groups = [] } = useEconomicGroups();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SilkForm>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ['sole_silk_registrations', soleProductId],
    queryFn: async () => {
      // Fetch by sole_product_id (new registrations) and sole_type (legacy) separately
      // to avoid special-character issues in the OR filter string
      const [{ data: byId }, { data: byType }] = await Promise.all([
        supabase
          .from('sole_silk_registrations')
          .select('*, clients(nome_fantasia), economic_groups(name)')
          .eq('sole_product_id', soleProductId),
        supabase
          .from('sole_silk_registrations')
          .select('*, clients(nome_fantasia), economic_groups(name)')
          .eq('sole_type', soleName)
          .is('sole_product_id', null),
      ]);
      const seen = new Set<string>();
      const merged = [...(byId ?? []), ...(byType ?? [])].filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
      return merged;
    },
    staleTime: 30_000,
  });

  const upsert = useMutation({
    mutationFn: async (data: SilkForm) => {
      const payload = {
        sole_product_id: soleProductId,
        sole_type: soleName,
        silk_name: data.silk_name,
        silk_url: data.silk_url || null,
        client_id: data.client_id || null,
        economic_group_id: data.economic_group_id || null,
      };
      if (editingId) {
        const { error } = await supabase.from('sole_silk_registrations').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('sole_silk_registrations').insert([payload]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sole_silk_registrations', soleProductId] });
      qc.invalidateQueries({ queryKey: ['sole_silk_registrations'] });
      toast.success(editingId ? 'Silk atualizado!' : 'Silk cadastrado!');
      closeDialog();
    },
    onError: (e: any) => toast.error('Erro ao salvar: ' + e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sole_silk_registrations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sole_silk_registrations', soleProductId] });
      qc.invalidateQueries({ queryKey: ['sole_silk_registrations'] });
      toast.success('Silk removido!');
    },
  });

  const openNew = () => { setEditingId(null); setForm(EMPTY_FORM); setDialogOpen(true); };
  const openEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      silk_name: r.silk_name ?? '',
      silk_url: r.silk_url ?? '',
      client_id: r.client_id ?? '',
      economic_group_id: r.economic_group_id ?? '',
    });
    setDialogOpen(true);
  };
  const closeDialog = () => { setDialogOpen(false); setEditingId(null); setForm(EMPTY_FORM); };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Selecione um arquivo de imagem.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('A imagem deve ter no máximo 5MB.'); return; }
    setUploading(true);
    try {
      const safeExt = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
      const path = `silks/${Math.random().toString(36).slice(2)}.${safeExt}`;
      const { error: upErr } = await supabase.storage.from('silk-images').upload(path, file);
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('silk-images').getPublicUrl(path);
      setForm(f => ({ ...f, silk_url: publicUrl }));
      toast.success('Imagem carregada!');
    } catch (err: any) {
      toast.error('Erro no upload: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const scopeLabel = (r: any) => {
    if (r.client_id) return <Badge variant="outline" className="gap-1 text-[10px]"><User className="h-3 w-3" />{r.clients?.nome_fantasia}</Badge>;
    if (r.economic_group_id) return <Badge variant="secondary" className="gap-1 text-[10px]"><UsersIcon className="h-3 w-3" />{r.economic_groups?.name}</Badge>;
    return <Badge variant="outline" className="text-[10px]">Padrão Geral</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            Artes de silk aplicadas neste solado. A prioridade é: cliente específico → grupo econômico → padrão geral.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openNew}>
          <Plus className="h-4 w-4" /> Adicionar Silk
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : registrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center border rounded-lg bg-muted/20">
          <Layers className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">Nenhuma silk cadastrada para este solado</p>
          <p className="text-xs text-muted-foreground">Use o botão acima para cadastrar artes de silk.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Arte / Silk</TableHead>
                <TableHead>Aplicação</TableHead>
                <TableHead className="w-20 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrations.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {r.silk_url ? (
                        <div className="h-10 w-10 border rounded overflow-hidden bg-card flex-shrink-0">
                          <SignedImage src={r.silk_url} className="h-full w-full object-contain" />
                        </div>
                      ) : (
                        <div className="h-10 w-10 border rounded bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
                          <ImageIcon className="h-4 w-4" />
                        </div>
                      )}
                      <span className="font-medium text-sm">{r.silk_name}</span>
                    </div>
                  </TableCell>
                  <TableCell>{scopeLabel(r)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <DeleteConfirmButton
                        onConfirm={() => remove.mutate(r.id)}
                        title="Remover silk?"
                        description="Esta ação não pode ser desfeita."
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Silk' : 'Cadastrar Nova Silk'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Arte + nome */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome da Silk</label>
                <Input
                  placeholder="Ex: Logo Padrão"
                  value={form.silk_name}
                  onChange={e => setForm(f => ({ ...f, silk_name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Arte / Imagem</label>
                <div className="flex items-center gap-2">
                  {form.silk_url ? (
                    <div className="relative group flex-shrink-0">
                      <div className="h-10 w-10 border rounded overflow-hidden bg-card">
                        <SignedImage src={form.silk_url} className="h-full w-full object-contain" />
                      </div>
                      <button
                        onClick={() => setForm(f => ({ ...f, silk_url: '' }))}
                        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 border-dashed"
                      onClick={() => document.getElementById('silk-panel-upload')?.click()}
                      disabled={uploading}
                    >
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploading ? 'Carregando...' : 'Upload'}
                    </Button>
                  )}
                  <input id="silk-panel-upload" type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                </div>
              </div>
            </div>

            {/* Escopo */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Cliente (opcional)</label>
                <Select
                  value={form.client_id || 'none'}
                  onValueChange={v => setForm(f => ({ ...f, client_id: v === 'none' ? '' : v, economic_group_id: '' }))}
                >
                  <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum (Geral)</SelectItem>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.nome_fantasia}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Grupo Econômico (opcional)</label>
                <Select
                  value={form.economic_group_id || 'none'}
                  onValueChange={v => setForm(f => ({ ...f, economic_group_id: v === 'none' ? '' : v, client_id: '' }))}
                >
                  <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum (Geral)</SelectItem>
                    {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button
                onClick={() => upsert.mutate(form)}
                disabled={upsert.isPending || !form.silk_name}
              >
                {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
