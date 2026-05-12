import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Fuel, Truck, User } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  useDrivers, useCreateDriver, useUpdateDriver, useDeleteDriver,
  useVehicles, useCreateVehicle, useUpdateVehicle, useDeleteVehicle,
  useFuelPrices, useUpdateFuelPrice,
  type Driver, type Vehicle, type DriverFormData, type VehicleFormData, type FuelType,
} from '@/hooks/useFleet';

const emptyVehicle = (): VehicleFormData => ({
  plate: '', model: null, type: null,
  capacity_kg: null, capacity_m3: null,
  fuel_type: 'diesel', fuel_consumption_km_l: 8,
  wear_cost_per_km: 0.35, default_driver_id: null, active: true,
});

const emptyDriver = (): DriverFormData => ({
  name: '', cnh: null, phone: null, active: true, notes: null,
});

const formatBrl = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 3 }).format(n);

export default function FleetTab() {
  return (
    <div className="space-y-4">
      <FuelPriceCard />
      <Tabs defaultValue="vehicles">
        <TabsList>
          <TabsTrigger value="vehicles" className="gap-1.5"><Truck className="h-3.5 w-3.5" />Veículos</TabsTrigger>
          <TabsTrigger value="drivers" className="gap-1.5"><User className="h-3.5 w-3.5" />Motoristas</TabsTrigger>
        </TabsList>
        <TabsContent value="vehicles" className="mt-4">
          <VehiclesPanel />
        </TabsContent>
        <TabsContent value="drivers" className="mt-4">
          <DriversPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Fuel prices
// ────────────────────────────────────────────────────────────────────
function FuelPriceCard() {
  const { data: prices = [] } = useFuelPrices();
  const update = useUpdateFuelPrice();
  return (
    <Card className="border-border/60">
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Fuel className="h-4 w-4 text-primary" />
          Preço corrente do combustível
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-0">
        {(['gasolina', 'diesel', 'etanol'] as const).map((type) => {
          const row = prices.find((p) => p.fuel_type === type);
          return (
            <FuelPriceRow
              key={type}
              type={type}
              currentPrice={row?.price_per_liter ?? 0}
              updatedAt={row?.updated_at ?? null}
              onSave={(price) => update.mutate({ fuel_type: type, price_per_liter: price })}
              saving={update.isPending}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

function FuelPriceRow({
  type, currentPrice, updatedAt, onSave, saving,
}: {
  type: 'gasolina' | 'diesel' | 'etanol';
  currentPrice: number;
  updatedAt: string | null;
  onSave: (price: number) => void;
  saving: boolean;
}) {
  const [val, setVal] = useState<string>('');
  // Reset val quando o preço de referência muda (ex: refetch pós-save) pra
  // evitar mostrar valor velho na input
  useEffect(() => { setVal(''); }, [currentPrice]);
  const display = val !== '' ? val : currentPrice.toFixed(3);
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <Label className="text-xs uppercase font-bold tracking-wider text-muted-foreground">{type}</Label>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-muted-foreground">R$</span>
        <Input
          type="text"
          inputMode="decimal"
          value={display}
          onChange={(e) => setVal(e.target.value)}
          className="h-8 font-mono"
        />
        <Button
          size="sm"
          onClick={() => {
            const parsed = Number(display.replace(',', '.'));
            if (!Number.isFinite(parsed) || parsed <= 0) return;
            onSave(parsed);
            setVal('');
          }}
          disabled={saving}
        >
          OK
        </Button>
      </div>
      {updatedAt && (
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Atualizado em {new Date(updatedAt).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Vehicles
// ────────────────────────────────────────────────────────────────────
function VehiclesPanel() {
  const { data: vehicles = [], isLoading } = useVehicles();
  const { data: drivers = [] } = useDrivers();
  const create = useCreateVehicle();
  const update = useUpdateVehicle();
  const del = useDeleteVehicle();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<VehicleFormData>(emptyVehicle());

  const driverName = (id: string | null) => (id ? drivers.find((d) => d.id === id)?.name ?? '—' : '—');

  const openNew = () => { setEditing(null); setForm(emptyVehicle()); setOpen(true); };
  const openEdit = (v: Vehicle) => {
    setEditing(v);
    setForm({
      plate: v.plate, model: v.model, type: v.type,
      capacity_kg: v.capacity_kg, capacity_m3: v.capacity_m3,
      fuel_type: v.fuel_type, fuel_consumption_km_l: v.fuel_consumption_km_l,
      wear_cost_per_km: v.wear_cost_per_km, default_driver_id: v.default_driver_id, active: v.active,
    });
    setOpen(true);
  };

  const canSubmitVehicle = form.plate.trim().length > 0 && form.fuel_consumption_km_l > 0;
  const submit = () => {
    if (!canSubmitVehicle) return;
    if (editing) update.mutate({ id: editing.id, data: form }, { onSuccess: () => setOpen(false) });
    else create.mutate(form, { onSuccess: () => setOpen(false) });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{vehicles.length} veículo(s) cadastrado(s)</p>
        <Button size="sm" onClick={openNew}><Plus className="h-3.5 w-3.5 mr-1" />Novo veículo</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && vehicles.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-2 text-center py-8">
            Nenhum veículo cadastrado. Adicione um pra começar a planejar rotas próprias.
          </p>
        )}
        {vehicles.map((v) => (
          <Card key={v.id} className={`border-border/60 ${!v.active ? 'opacity-60' : ''}`}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold font-mono text-sm">{v.plate}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{v.fuel_type}</Badge>
                    {!v.active && <Badge variant="secondary" className="text-[10px]">Inativo</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {v.model || '—'} · {v.type || 'sem tipo'}
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-2 text-xs">
                    <span className="text-muted-foreground">Consumo:</span>
                    <span className="font-mono">{v.fuel_consumption_km_l} km/L</span>
                    <span className="text-muted-foreground">Desgaste:</span>
                    <span className="font-mono">{formatBrl(v.wear_cost_per_km)}/km</span>
                    <span className="text-muted-foreground">Capacidade:</span>
                    <span className="font-mono">{v.capacity_kg ?? '—'} kg / {v.capacity_m3 ?? '—'} m³</span>
                    <span className="text-muted-foreground">Motorista padrão:</span>
                    <span>{driverName(v.default_driver_id)}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(v)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                    onClick={() => { if (confirm(`Excluir veículo ${v.plate}?`)) del.mutate(v.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Editar veículo' : 'Novo veículo'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Placa *</Label>
                <Input
                  value={form.plate}
                  onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }))}
                  className="h-9 mt-1 font-mono uppercase"
                  placeholder="ABC-1D23"
                />
              </div>
              <div>
                <Label className="text-xs">Modelo</Label>
                <Input
                  value={form.model ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value || null }))}
                  className="h-9 mt-1"
                  placeholder="ex: Fiorino, Sprinter"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tipo</Label>
                <Input
                  value={form.type ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value || null }))}
                  className="h-9 mt-1"
                  placeholder="fiorino / van / caminhão"
                />
              </div>
              <div>
                <Label className="text-xs">Combustível</Label>
                <Select value={form.fuel_type} onValueChange={(v) => setForm((f) => ({ ...f, fuel_type: v as FuelType }))}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gasolina">Gasolina</SelectItem>
                    <SelectItem value="diesel">Diesel</SelectItem>
                    <SelectItem value="etanol">Etanol</SelectItem>
                    <SelectItem value="flex">Flex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Consumo (km/L) *</Label>
                <Input
                  type="number" min={0.1} step={0.1} className="h-9 mt-1 font-mono"
                  value={form.fuel_consumption_km_l}
                  onChange={(e) => setForm((f) => ({ ...f, fuel_consumption_km_l: Number(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <Label className="text-xs">Desgaste (R$/km)</Label>
                <Input
                  type="number" min={0} step={0.01} className="h-9 mt-1 font-mono"
                  value={form.wear_cost_per_km}
                  onChange={(e) => setForm((f) => ({ ...f, wear_cost_per_km: Number(e.target.value) || 0 }))}
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">Pneus, manutenção e depreciação amortizadas.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Capacidade (kg)</Label>
                <Input
                  type="number" min={0} step={1} className="h-9 mt-1 font-mono"
                  value={form.capacity_kg ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, capacity_kg: e.target.value ? Number(e.target.value) : null }))}
                />
              </div>
              <div>
                <Label className="text-xs">Capacidade (m³)</Label>
                <Input
                  type="number" min={0} step={0.1} className="h-9 mt-1 font-mono"
                  value={form.capacity_m3 ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, capacity_m3: e.target.value ? Number(e.target.value) : null }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Motorista padrão</Label>
              <Select
                value={form.default_driver_id ?? 'none'}
                onValueChange={(v) => setForm((f) => ({ ...f, default_driver_id: v === 'none' ? null : v }))}
              >
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {drivers.filter((d) => d.active).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
              <Label className="text-xs cursor-pointer">Veículo ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending || !canSubmitVehicle}>
              {editing ? 'Salvar' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Drivers
// ────────────────────────────────────────────────────────────────────
function DriversPanel() {
  const { data: drivers = [], isLoading } = useDrivers();
  const create = useCreateDriver();
  const update = useUpdateDriver();
  const del = useDeleteDriver();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [form, setForm] = useState<DriverFormData>(emptyDriver());

  const openNew = () => { setEditing(null); setForm(emptyDriver()); setOpen(true); };
  const openEdit = (d: Driver) => {
    setEditing(d);
    setForm({ name: d.name, cnh: d.cnh, phone: d.phone, active: d.active, notes: d.notes });
    setOpen(true);
  };
  const submit = () => {
    if (!form.name.trim()) return;
    if (editing) update.mutate({ id: editing.id, data: form }, { onSuccess: () => setOpen(false) });
    else create.mutate(form, { onSuccess: () => setOpen(false) });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{drivers.length} motorista(s) cadastrado(s)</p>
        <Button size="sm" onClick={openNew}><Plus className="h-3.5 w-3.5 mr-1" />Novo motorista</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && drivers.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-2 text-center py-8">
            Nenhum motorista cadastrado.
          </p>
        )}
        {drivers.map((d) => (
          <Card key={d.id} className={`border-border/60 ${!d.active ? 'opacity-60' : ''}`}>
            <CardContent className="p-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">{d.name}</span>
                  {!d.active && <Badge variant="secondary" className="text-[10px]">Inativo</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  CNH: {d.cnh || '—'} · {d.phone || 'sem telefone'}
                </p>
                {d.notes && <p className="text-xs text-muted-foreground mt-1">{d.notes}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(d)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                  onClick={() => { if (confirm(`Excluir motorista ${d.name}?`)) del.mutate(d.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Editar motorista' : 'Novo motorista'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">CNH</Label>
                <Input
                  value={form.cnh ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, cnh: e.target.value || null }))}
                  className="h-9 mt-1 font-mono"
                />
              </div>
              <div>
                <Label className="text-xs">Telefone</Label>
                <Input
                  value={form.phone ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value || null }))}
                  className="h-9 mt-1 font-mono"
                  placeholder="(00) 00000-0000"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Input
                value={form.notes ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
                className="h-9 mt-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
              <Label className="text-xs cursor-pointer">Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending || !form.name.trim()}>
              {editing ? 'Salvar' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
