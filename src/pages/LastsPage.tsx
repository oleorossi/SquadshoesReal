import { useMemo, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/textarea';
import { Plus, MagnifyingGlass as Search, Footprints, Pencil, ShieldCheck, ArchiveBox } from '@phosphor-icons/react';
import { useLasts, useCreateLast, useUpdateLast, type LastInput, type LastWithUsage } from '@/hooks/useLasts';
import { useClients } from '@/hooks/useClients';
import { normalizeForSearch } from '@/lib/searchUtils';

const STATUS_TONE: Record<string, string> = {
  dev:     'bg-amber-500/15 text-amber-700 border-amber-500/40',
  active:  'bg-emerald-500/15 text-emerald-700 border-emerald-500/40',
  retired: 'bg-muted text-muted-foreground border-border',
};
const STATUS_LABEL: Record<string, string> = {
  dev: 'Em desenvolvimento',
  active: 'Em uso',
  retired: 'Aposentada',
};

const EMPTY_FORM: LastInput = {
  code: '',
  name: '',
  description: '',
  size_range_min: null,
  size_range_max: null,
  toe_shape: '',
  heel_type: '',
  heel_height_mm: null,
  material: '',
  unit_cost: null,
  owner_client_id: null,
  status: 'dev',
  notes: '',
  active: true,
};

export default function LastsPage() {
  const { data: lasts = [], isLoading } = useLasts();
  const { data: clients = [] } = useClients();
  const createMut = useCreateLast();
  const updateMut = useUpdateLast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LastWithUsage | null>(null);
  const [form, setForm] = useState<LastInput>(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = useMemo(() => {
    return lasts.filter(l => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (search.trim()) {
        const q = normalizeForSearch(search.trim());
        return normalizeForSearch(l.code).includes(q)
          || normalizeForSearch(l.name).includes(q)
          || normalizeForSearch(l.owner_name || '').includes(q);
      }
      return true;
    });
  }, [lasts, search, statusFilter]);

  const totals = useMemo(() => ({
    total: lasts.length,
    active: lasts.filter(l => l.status === 'active').length,
    dev: lasts.filter(l => l.status === 'dev').length,
    inUse: lasts.filter(l => l.sheets_using > 0).length,
  }), [lasts]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (last: LastWithUsage) => {
    setEditing(last);
    setForm({
      code: last.code,
      name: last.name,
      description: last.description,
      size_range_min: last.size_range_min,
      size_range_max: last.size_range_max,
      toe_shape: last.toe_shape,
      heel_type: last.heel_type,
      heel_height_mm: last.heel_height_mm,
      material: last.material,
      unit_cost: last.unit_cost,
      owner_client_id: last.owner_client_id,
      status: last.status,
      notes: last.notes,
      active: last.active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    const payload: LastInput = {
      ...form,
      description: form.description?.toString().trim() || null,
      toe_shape: form.toe_shape?.toString().trim() || null,
      heel_type: form.heel_type?.toString().trim() || null,
      material: form.material?.toString().trim() || null,
      notes: form.notes?.toString().trim() || null,
    };
    try {
      if (editing) await updateMut.mutateAsync({ id: editing.id, patch: payload });
      else await createMut.mutateAsync(payload);
      setDialogOpen(false);
    } catch {}
  };

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="ENGENHARIA · FORMAS"
          title="Formas (lasts)"
          description="Catálogo de formas com custo, propriedade (própria vs cliente), faixa de numeração, ciclo de vida. Vinculadas a fichas técnicas via technical_sheets.last_id."
          actions={
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Nova forma
            </Button>
          }
        />

        <StatGrid>
          <StatCard icon={Footprints} label="Formas catalogadas" value={totals.total} hint="total" />
          <StatCard icon={ShieldCheck} label="Em uso" value={totals.active} hint="status ativo" tone={totals.active > 0 ? 'success' : 'default'} />
          <StatCard icon={Pencil} label="Em desenvolvimento" value={totals.dev} hint="ainda em projeto" tone="warning" />
          <StatCard icon={ArchiveBox} label="Vinculadas a ficha" value={totals.inUse} hint="com FK em technical_sheets" />
        </StatGrid>

        <Panel flush>
          <div className="flex flex-col sm:flex-row gap-3 p-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por código, nome ou cliente..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="dev">Em desenvolvimento</SelectItem>
                <SelectItem value="active">Em uso</SelectItem>
                <SelectItem value="retired">Aposentadas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Carregando formas...</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Footprints}
              title={lasts.length === 0 ? 'Nenhuma forma cadastrada' : 'Nenhuma forma encontrada'}
              description={lasts.length === 0 ? 'Cadastre o catálogo de formas (próprias e de clientes) com custo, faixa de numeração e ciclo de vida.' : 'Ajuste os filtros.'}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead className="w-32">Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Bico / Salto</TableHead>
                  <TableHead>Faixa num.</TableHead>
                  <TableHead>Proprietário</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Em ficha</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(last => {
                  const range = last.size_range_min != null && last.size_range_max != null
                    ? `${last.size_range_min}–${last.size_range_max}`
                    : '—';
                  return (
                    <TableRow key={last.id} className={!last.active ? 'opacity-50' : ''}>
                      <TableCell className="font-mono text-xs">{last.code}</TableCell>
                      <TableCell className="text-sm font-medium">{last.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[last.toe_shape, last.heel_type].filter(Boolean).join(' · ') || '—'}
                        {last.heel_height_mm ? <div className="text-xs">{last.heel_height_mm}mm</div> : null}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">{range}</TableCell>
                      <TableCell className="text-sm">{last.owner_name || <span className="text-muted-foreground">Próprio</span>}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {last.unit_cost != null ? last.unit_cost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{last.sheets_using}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`text-xs ${STATUS_TONE[last.status] || ''}`}>
                          {STATUS_LABEL[last.status] || last.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => openEdit(last)}>
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar forma' : 'Nova forma'}</DialogTitle>
            <DialogDescription>
              Catálogo de formas. Vincule a uma ficha técnica via FK em technical_sheets.last_id no editor da ficha (próxima iteração).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Código *</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="F-001" className="h-9 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dev">Em desenvolvimento</SelectItem>
                    <SelectItem value="active">Em uso</SelectItem>
                    <SelectItem value="retired">Aposentada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Bico fino feminino 35-40" className="h-9" />
            </div>

            <div>
              <Label className="text-xs">Descrição</Label>
              <Textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Numeração mín.</Label>
                <Input type="number" value={form.size_range_min ?? ''} onChange={e => setForm(f => ({ ...f, size_range_min: e.target.value ? Number(e.target.value) : null }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Numeração máx.</Label>
                <Input type="number" value={form.size_range_max ?? ''} onChange={e => setForm(f => ({ ...f, size_range_max: e.target.value ? Number(e.target.value) : null }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Altura salto (mm)</Label>
                <Input type="number" inputMode="decimal" step="0.5" value={form.heel_height_mm ?? ''} onChange={e => setForm(f => ({ ...f, heel_height_mm: e.target.value ? Number(e.target.value) : null }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Custo (R$)</Label>
                <Input type="number" inputMode="decimal" step="0.01" value={form.unit_cost ?? ''} onChange={e => setForm(f => ({ ...f, unit_cost: e.target.value ? Number(e.target.value) : null }))} className="h-9" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Bico</Label>
                <Input value={form.toe_shape || ''} onChange={e => setForm(f => ({ ...f, toe_shape: e.target.value }))} placeholder="Fino / Redondo / Quadrado" className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Tipo de salto</Label>
                <Input value={form.heel_type || ''} onChange={e => setForm(f => ({ ...f, heel_type: e.target.value }))} placeholder="Rasteiro / Médio / Alto" className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Material</Label>
                <Input value={form.material || ''} onChange={e => setForm(f => ({ ...f, material: e.target.value }))} placeholder="Madeira / Plástico / Alumínio" className="h-9" />
              </div>
            </div>

            <div>
              <Label className="text-xs">Proprietário (cliente)</Label>
              <Select value={form.owner_client_id || ''} onValueChange={v => setForm(f => ({ ...f, owner_client_id: v || null }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Forma própria da fábrica..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Forma própria</SelectItem>
                  {(clients as any[]).slice(0, 200).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.razao_social}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Vazio = forma da fábrica. Senão = forma do cliente (private label).</p>
            </div>

            <div>
              <Label className="text-xs">Notas</Label>
              <Textarea value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Observações sobre desenvolvimento, restrições, fornecedor..." />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label className="text-sm">Forma ativa</Label>
                <p className="text-xs text-muted-foreground">Inativas não aparecem nos seletores de ficha técnica.</p>
              </div>
              <Switch checked={form.active ?? true} onCheckedChange={(v) => setForm(f => ({ ...f, active: v }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={!form.code.trim() || !form.name.trim() || createMut.isPending || updateMut.isPending}
            >
              {createMut.isPending || updateMut.isPending ? 'Salvando...' : (editing ? 'Salvar' : 'Criar forma')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
