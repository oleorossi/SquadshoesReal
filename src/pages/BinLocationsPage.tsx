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
import { EmptyState } from '@/components/ui/empty-state';
import { Plus, MagnifyingGlass as Search, MapPin, Pencil } from '@phosphor-icons/react';
import { useBinLocations, useCreateBinLocation, useUpdateBinLocation, type BinLocation, type BinLocationInput } from '@/hooks/useBinLocations';
import { normalizeForSearch } from '@/lib/searchUtils';

const EMPTY_FORM: BinLocationInput = {
  code: '',
  name: '',
  warehouse: 'Principal',
  zone: '',
  aisle: '',
  rack: '',
  shelf: '',
  bin: '',
  capacity: null,
  active: true,
};

export default function BinLocationsPage() {
  const { data: locations = [], isLoading } = useBinLocations();
  const createMut = useCreateBinLocation();
  const updateMut = useUpdateBinLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BinLocation | null>(null);
  const [form, setForm] = useState<BinLocationInput>(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('all');

  const warehouses = useMemo(() => {
    return [...new Set(locations.map(l => l.warehouse))].sort();
  }, [locations]);

  const filtered = useMemo(() => {
    return locations.filter(l => {
      if (warehouseFilter !== 'all' && l.warehouse !== warehouseFilter) return false;
      if (search.trim()) {
        const q = normalizeForSearch(search.trim());
        return normalizeForSearch(l.code).includes(q)
          || normalizeForSearch(l.name).includes(q)
          || normalizeForSearch([l.zone, l.aisle, l.rack, l.shelf, l.bin].filter(Boolean).join(' ')).includes(q);
      }
      return true;
    });
  }, [locations, warehouseFilter, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (loc: BinLocation) => {
    setEditing(loc);
    setForm({
      code: loc.code,
      name: loc.name,
      warehouse: loc.warehouse,
      zone: loc.zone || '',
      aisle: loc.aisle || '',
      rack: loc.rack || '',
      shelf: loc.shelf || '',
      bin: loc.bin || '',
      capacity: loc.capacity,
      active: loc.active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim() || !form.warehouse.trim()) return;
    const payload: BinLocationInput = {
      ...form,
      zone: form.zone?.trim() || null,
      aisle: form.aisle?.trim() || null,
      rack: form.rack?.trim() || null,
      shelf: form.shelf?.trim() || null,
      bin: form.bin?.trim() || null,
    };
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, patch: payload });
      } else {
        await createMut.mutateAsync(payload);
      }
      setDialogOpen(false);
    } catch {}
  };

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="ESTOQUE · ENDEREÇAMENTO"
          title="Localizações de estoque"
          description="Bin locations (armazém / zona / corredor / prateleira / vão). Vinculadas a produtos via default_bin_location_id e usadas no inventário rotativo + picking semanal."
          actions={
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Nova localização
            </Button>
          }
        />

        <Panel flush>
          <div className="flex flex-col sm:flex-row gap-3 p-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por código, nome, zona, corredor..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Armazém" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos armazéns</SelectItem>
                {warehouses.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Carregando localizações...</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title={locations.length === 0 ? 'Nenhuma localização cadastrada' : 'Nenhuma localização encontrada'}
              description={locations.length === 0 ? 'Crie a primeira localização (ex.: A-12-3) e vincule produtos pra acelerar picking e contagem.' : 'Ajuste os filtros pra ver localizações.'}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead className="w-32">Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Armazém</TableHead>
                  <TableHead>Endereço</TableHead>
                  <TableHead className="text-right">Capacidade</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(loc => {
                  const address = [loc.zone, loc.aisle, loc.rack, loc.shelf, loc.bin].filter(Boolean).join(' · ');
                  return (
                    <TableRow key={loc.id} className={!loc.active ? 'opacity-50' : ''}>
                      <TableCell className="font-mono text-sm">{loc.code}</TableCell>
                      <TableCell className="text-sm font-medium">{loc.name}</TableCell>
                      <TableCell className="text-sm">{loc.warehouse}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{address || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{loc.capacity ?? '—'}</TableCell>
                      <TableCell className="text-center">
                        {loc.active ? (
                          <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-700">ativa</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">inativa</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => openEdit(loc)}>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar localização' : 'Nova localização'}</DialogTitle>
            <DialogDescription>
              Endereço lógico de estoque. Campos hierárquicos (zona, corredor, etc.) são opcionais — use os que fizerem sentido pra organização do seu galpão.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Código *</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="A-12-3" className="h-9 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Armazém *</Label>
                <Input value={form.warehouse} onChange={e => setForm(f => ({ ...f, warehouse: e.target.value }))} placeholder="Principal" className="h-9" />
              </div>
            </div>

            <div>
              <Label className="text-xs">Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Couro preto — corredor A" className="h-9" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Zona</Label>
                <Input value={form.zone || ''} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))} placeholder="Z1" className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Corredor</Label>
                <Input value={form.aisle || ''} onChange={e => setForm(f => ({ ...f, aisle: e.target.value }))} placeholder="A" className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Rack</Label>
                <Input value={form.rack || ''} onChange={e => setForm(f => ({ ...f, rack: e.target.value }))} placeholder="12" className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Prateleira</Label>
                <Input value={form.shelf || ''} onChange={e => setForm(f => ({ ...f, shelf: e.target.value }))} placeholder="3" className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Vão (bin)</Label>
                <Input value={form.bin || ''} onChange={e => setForm(f => ({ ...f, bin: e.target.value }))} placeholder="1" className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Capacidade</Label>
                <Input type="number" inputMode="numeric" value={form.capacity ?? ''} onChange={e => setForm(f => ({ ...f, capacity: e.target.value ? Number(e.target.value) : null }))} placeholder="0" className="h-9" />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label className="text-sm">Localização ativa</Label>
                <p className="text-xs text-muted-foreground">Inativas não aparecem nos seletores de produto.</p>
              </div>
              <Switch checked={form.active ?? true} onCheckedChange={(v) => setForm(f => ({ ...f, active: v }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={!form.code.trim() || !form.name.trim() || !form.warehouse.trim() || createMut.isPending || updateMut.isPending}
            >
              {createMut.isPending || updateMut.isPending ? 'Salvando...' : (editing ? 'Salvar' : 'Criar localização')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
