import { useState, useMemo } from 'react';
import { Plus, Trash as Trash2, PencilSimple as Pencil, Users as Users2, MagnifyingGlass as Search, CircleNotch as Loader2, Funnel as Filter, Envelope as Mail, Phone, MapPin, Percent, CaretDown as ChevronDown, CaretUp as ChevronUp } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useRepresentatives, useCreateRepresentative, useUpdateRepresentative, useDeleteRepresentative, RepresentativeFormData, Representative } from '@/hooks/useRepresentatives';
import { CommissionTiersDialog } from '@/components/settings/CommissionTiersDialog';
import { Stairs } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';

const emptyForm: RepresentativeFormData = {
  name: '', email: '', phone: '', commission_pct: 0, active: true, notes: '',
  cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
};

function RepCard({ rep, onEdit, onDelete, onTiers }: { rep: Representative; onEdit: () => void; onDelete: () => void; onTiers: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const initials = rep.name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <Card className={cn('transition-all duration-200 hover:shadow-md', expanded && 'ring-1 ring-primary/20 shadow-md')}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{rep.name}</span>
              <Badge variant="outline" className={cn('text-xs', rep.active ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-muted text-muted-foreground')}>
                {rep.active ? 'Ativo' : 'Inativo'}
              </Badge>
              <Badge variant="secondary" className="text-xs font-mono gap-0.5">
                <Percent className="h-2.5 w-2.5" />{rep.commission_pct}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              {rep.email && (
                <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{rep.email}</span>
              )}
              {rep.phone && (
                <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{rep.phone}</span>
              )}
              {rep.cidade && rep.estado && (
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{rep.cidade}/{rep.estado}</span>
              )}
            </div>

            {expanded && (
              <div className="mt-3 pt-3 border-t space-y-2 text-xs">
                {rep.endereco && (
                  <div className="text-muted-foreground">
                    <span className="font-medium text-foreground">Endereço: </span>
                    {rep.endereco}{rep.numero ? `, ${rep.numero}` : ''}{rep.complemento ? ` - ${rep.complemento}` : ''}, {rep.bairro} - {rep.cidade}/{rep.estado} - CEP: {rep.cep}
                  </div>
                )}
                {rep.notes && (
                  <div className="text-muted-foreground">
                    <span className="font-medium text-foreground">Obs: </span>{rep.notes}
                  </div>
                )}
                <div className="text-muted-foreground">
                  Cadastrado em: {new Date(rep.created_at).toLocaleDateString('pt-BR')}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onTiers} title="Faixas de comissão escalonada"><Stairs className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RepresentativesPanel() {
  const { data: reps = [] } = useRepresentatives();
  const createRep = useCreateRepresentative();
  const updateRep = useUpdateRepresentative();
  const deleteRep = useDeleteRepresentative();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<RepresentativeFormData>(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [tiersRep, setTiersRep] = useState<Representative | null>(null);
  const [loadingCep, setLoadingCep] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const filtered = useMemo(() => {
    return reps.filter(r => {
      const matchSearch = searchMatchesAllTerms(search, r.name, r.email, r.phone, r.cidade, r.estado);
      const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? r.active : !r.active);
      return matchSearch && matchStatus;
    });
  }, [reps, search, statusFilter]);

  const openNew = () => { setForm(emptyForm); setEditId(null); setDialogOpen(true); };
  const openEdit = (r: Representative) => {
    setForm({
      name: r.name, email: r.email || '', phone: r.phone || '',
      commission_pct: r.commission_pct, active: r.active, notes: r.notes || '',
      cep: r.cep || '', endereco: r.endereco || '', numero: r.numero || '',
      complemento: r.complemento || '', bairro: r.bairro || '',
      cidade: r.cidade || '', estado: r.estado || '',
    });
    setEditId(r.id);
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editId) {
      updateRep.mutate({ ...form, id: editId });
    } else {
      createRep.mutate(form);
    }
    setDialogOpen(false);
  };

  const fetchCepFromDigits = async (cep: string) => {
    setLoadingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data.erro) { toast.error('CEP não encontrado'); return; }
      setForm(f => ({
        ...f,
        endereco: data.logradouro || '',
        bairro: data.bairro || '',
        cidade: data.localidade || '',
        estado: data.uf || '',
        complemento: data.complemento || f.complemento,
      }));
      toast.success('Endereço preenchido!');
    } catch {
      toast.error('Erro ao buscar CEP');
    } finally {
      setLoadingCep(false);
    }
  };

  const handleCepChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    const formatted = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
    setForm(f => ({ ...f, cep: formatted }));
    if (digits.length === 8) {
      setTimeout(() => fetchCepFromDigits(digits), 300);
    }
  };

  const activeCount = reps.filter(r => r.active).length;
  const inactiveCount = reps.filter(r => !r.active).length;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-lg font-bold">{reps.length}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-lg font-bold text-emerald-600">{activeCount}</p>
          <p className="text-xs text-muted-foreground">Ativos</p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-lg font-bold text-muted-foreground">{inactiveCount}</p>
          <p className="text-xs text-muted-foreground">Inativos</p>
        </div>
      </div>

      {/* Search + filters + add */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nome, e-mail, telefone ou cidade..."
          resultCount={filtered.length}
          totalCount={reps.length}
          className="flex-1 min-w-[200px]"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-[130px]">
            <Filter className="h-3.5 w-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={openNew} className="gap-1.5">
          <Plus className="h-4 w-4" />Novo Representante
        </Button>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          search.trim() ? (
            <EmptyState
              size="sm"
              icon={Search}
              title={`Nenhum resultado para "${search}"`}
              action={<Button type="button" variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
            />
          ) : (
            <EmptyState
              icon={Users2}
              title="Nenhum representante encontrado"
              size="sm"
            />
          )
        ) : filtered.map(r => (
          <RepCard key={r.id} rep={r} onEdit={() => openEdit(r)} onDelete={() => deleteRep.mutate(r.id)} onTiers={() => setTiersRep(r)} />
        ))}
      </div>

      <CommissionTiersDialog
        representative={tiersRep ? { id: tiersRep.id, name: tiersRep.name, commission_pct: tiersRep.commission_pct } : null}
        open={!!tiersRep}
        onOpenChange={(v) => { if (!v) setTiersRep(null); }}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? 'Editar' : 'Novo'} Representante</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>E-mail</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1" /></div>
              <div><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="mt-1" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Comissão (%)</Label><Input type="number" step="0.1" min="0" max="100" value={form.commission_pct} onChange={e => setForm(f => ({ ...f, commission_pct: Number(e.target.value) }))} className="mt-1" /></div>
              <div className="flex items-center gap-2 pt-6"><Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} /><Label>Ativo</Label></div>
            </div>

            {/* Endereço */}
            <div className="border-t pt-4 space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground">Endereço</h4>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label>CEP</Label>
                  <Input value={form.cep} onChange={e => handleCepChange(e.target.value)} placeholder="00000-000" className="mt-1" maxLength={9} />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => fetchCepFromDigits(form.cep.replace(/\D/g, ''))} disabled={loadingCep} className="gap-1 mb-0.5">
                  {loadingCep ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Buscar
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2"><Label>Rua/Logradouro</Label><Input value={form.endereco} onChange={e => setForm(f => ({ ...f, endereco: e.target.value }))} className="mt-1" /></div>
                <div><Label>Número</Label><Input value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} className="mt-1" /></div>
              </div>
              <div><Label>Complemento</Label><Input value={form.complemento} onChange={e => setForm(f => ({ ...f, complemento: e.target.value }))} className="mt-1" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><Label>Bairro</Label><Input value={form.bairro} onChange={e => setForm(f => ({ ...f, bairro: e.target.value }))} className="mt-1" /></div>
                <div><Label>Cidade</Label><Input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} className="mt-1" /></div>
                <div><Label>UF</Label><Input value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} className="mt-1" maxLength={2} /></div>
              </div>
            </div>

            <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" rows={3} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit">{editId ? 'Salvar' : 'Cadastrar'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
