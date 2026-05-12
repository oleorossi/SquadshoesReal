import { useEffect, useMemo, useState } from 'react';
import { Loader2, MapPin, Truck, User, Fuel, Wrench, Coins, AlertTriangle, Wand2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useVehicles, useDrivers, useFuelPrices } from '@/hooks/useFleet';
import { useCreateDeliveryRoute, type CreateRoutePayload } from '@/hooks/useDeliveryRoutes';
import { geocodeOne, nearestNeighborOrder, projectRouteCost, type Coord } from '@/lib/own-delivery/routeMath';
import type { OwnDeliveryOrder } from '@/hooks/useDeliveryRoutes';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orders: OwnDeliveryOrder[];
  onCreated?: () => void;
}

interface StopState {
  order: OwnDeliveryOrder;
  coord: Coord | null;
  geoError?: string;
  distanceFromPreviousKm?: number;
}

const formatBrl = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function RoutePlannerOwn({ open, onOpenChange, orders, onCreated }: Props) {
  const { data: vehicles = [] } = useVehicles();
  const { data: drivers = [] } = useDrivers();
  const { data: fuelPrices = [] } = useFuelPrices();
  const create = useCreateDeliveryRoute();

  const [vehicleId, setVehicleId] = useState<string>('');
  const [driverId, setDriverId] = useState<string>('');
  const [scheduledDate, setScheduledDate] = useState<string>(todayIso());
  const [routeName, setRouteName] = useState<string>('');
  const [originLabel, setOriginLabel] = useState<string>('Galpão Squad Shoes');
  const [originCep, setOriginCep] = useState<string>('');
  const [originCoord, setOriginCoord] = useState<Coord | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [stops, setStops] = useState<StopState[]>([]);
  const [optimized, setOptimized] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId) || null;
  const fuelPrice = fuelPrices.find((p) => p.fuel_type === selectedVehicle?.fuel_type)?.price_per_liter ?? 0;

  // Auto-seleciona motorista padrão quando o veículo muda
  useEffect(() => {
    if (selectedVehicle?.default_driver_id && !driverId) {
      setDriverId(selectedVehicle.default_driver_id);
    }
  }, [selectedVehicle, driverId]);

  // Inicializa stops a partir dos orders quando abre
  useEffect(() => {
    if (open) {
      setStops(orders.map((o) => ({ order: o, coord: null })));
      setOptimized(false);
      setRouteName(`Rota ${new Date(scheduledDate).toLocaleDateString('pt-BR')} · ${orders.length} parada(s)`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orders]);

  const totalKm = useMemo(
    () => stops.reduce((s, x) => s + (x.distanceFromPreviousKm ?? 0), 0),
    [stops],
  );
  const totalPairs = useMemo(
    () => stops.reduce((s, x) => s + (x.order.total_pairs ?? 0), 0),
    [stops],
  );

  const cost = useMemo(() => {
    if (!selectedVehicle) return null;
    return projectRouteCost({
      totalKm,
      fuelConsumptionKmL: selectedVehicle.fuel_consumption_km_l,
      wearCostPerKm: selectedVehicle.wear_cost_per_km,
      fuelPricePerLiter: fuelPrice,
      totalPairs,
    });
  }, [totalKm, selectedVehicle, fuelPrice, totalPairs]);

  const allGeocoded = stops.length > 0 && stops.every((s) => s.coord);
  const canSubmit = !!selectedVehicle && stops.length > 0 && allGeocoded && !!originCoord && optimized;

  const runGeocoding = async () => {
    setGeocoding(true);
    try {
      // Origem
      let origin: Coord | null = originCoord;
      if (!origin && originCep) {
        origin = await geocodeOne({ cep: originCep, cidade: 'São Paulo' });
        setOriginCoord(origin);
      }

      // Paradas: sequencial pra respeitar rate limit do Nominatim
      const next: StopState[] = [];
      for (const s of stops) {
        const c = s.order.client;
        const coord = c
          ? await geocodeOne({
              endereco: c.endereco, bairro: c.bairro, cidade: c.cidade, estado: c.estado, cep: c.cep,
            })
          : null;
        next.push({
          ...s,
          coord,
          geoError: coord ? undefined : 'Endereço não encontrado — verifique cadastro do cliente.',
        });
      }
      setStops(next);
      setOptimized(false);
    } finally {
      setGeocoding(false);
    }
  };

  const optimizeRoute = () => {
    if (!originCoord) return;
    const valid = stops.filter((s) => s.coord);
    if (valid.length === 0) return;
    const coords = valid.map((s) => s.coord!) as Coord[];
    const { order, legs } = nearestNeighborOrder(originCoord, coords);
    const reordered: StopState[] = order.map((idx, i) => ({
      ...valid[idx],
      distanceFromPreviousKm: legs[i],
    }));
    // Mantém os com erro de geocoding no final, sem distância
    const failed = stops.filter((s) => !s.coord);
    setStops([...reordered, ...failed]);
    setOptimized(true);
  };

  const submit = () => {
    if (!canSubmit || !selectedVehicle) return;
    const payloadStops: CreateRoutePayload['stops'] = stops
      .filter((s) => s.coord)
      .map((s, i) => ({
        sale_order_id: s.order.id,
        stop_order: i + 1,
        address_snapshot: {
          label: s.order.client?.razao_social || s.order.client_name || s.order.order_number,
          razao_social: s.order.client?.razao_social,
          endereco: s.order.client?.endereco,
          bairro: s.order.client?.bairro,
          cidade: s.order.client?.cidade,
          estado: s.order.client?.estado,
          cep: s.order.client?.cep,
          branch_code: s.order.client?.branch_code,
          branch_name: s.order.client?.branch_name,
          cnpj: s.order.client?.cnpj,
        },
        latitude: s.coord!.lat,
        longitude: s.coord!.lng,
        distance_from_previous_km: s.distanceFromPreviousKm ?? null,
        eta_minutes_from_start: null,
        status: 'pending',
        delivered_at: null,
        receiver_name: null,
        notes: null,
      }));

    create.mutate(
      {
        route: {
          name: routeName || null as unknown as string,
          scheduled_date: scheduledDate,
          vehicle_id: vehicleId,
          driver_id: driverId || null,
          origin_address: { label: originLabel, latitude: originCoord!.lat, longitude: originCoord!.lng },
          status: 'planned',
        },
        stops: payloadStops,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          onCreated?.();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Planejar rota — frete próprio</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Cabeçalho */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Nome da rota</Label>
              <Input
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                className="h-9 mt-1"
                placeholder="Rota Zona Sul terça"
              />
            </div>
            <div>
              <Label className="text-xs">Data programada</Label>
              <Input
                type="date" value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="h-9 mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs flex items-center gap-1"><Truck className="h-3 w-3" />Veículo</Label>
                <Select value={vehicleId} onValueChange={setVehicleId}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Escolher" /></SelectTrigger>
                  <SelectContent>
                    {vehicles.filter((v) => v.active).map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.plate} — {v.model || v.type || v.fuel_type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1"><User className="h-3 w-3" />Motorista</Label>
                <Select value={driverId || 'none'} onValueChange={(v) => setDriverId(v === 'none' ? '' : v)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {drivers.filter((d) => d.active).map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Origem */}
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
            <Label className="text-xs flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-primary" />Origem da rota</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input
                value={originLabel} onChange={(e) => setOriginLabel(e.target.value)}
                placeholder="Galpão Squad Shoes" className="h-9"
              />
              <Input
                value={originCep} onChange={(e) => setOriginCep(e.target.value)}
                placeholder="CEP de partida" className="h-9 font-mono"
              />
              <div className="text-xs text-muted-foreground self-center">
                {originCoord
                  ? <>📍 {originCoord.lat.toFixed(4)}, {originCoord.lng.toFixed(4)}</>
                  : <>Use o CEP do galpão para o sistema localizar.</>}
              </div>
            </div>
          </div>

          {/* Ações */}
          <div className="flex flex-wrap gap-2 items-center">
            <Button onClick={runGeocoding} disabled={geocoding || stops.length === 0} variant="outline" size="sm">
              {geocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <MapPin className="h-3.5 w-3.5 mr-1" />}
              Localizar endereços
            </Button>
            <Button
              onClick={optimizeRoute}
              disabled={!allGeocoded || !originCoord}
              size="sm"
            >
              <Wand2 className="h-3.5 w-3.5 mr-1" />
              Otimizar ordem
            </Button>
            {!allGeocoded && stops.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {stops.filter((s) => s.coord).length}/{stops.length} localizados
              </Badge>
            )}
            {optimized && <Badge className="text-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Rota otimizada</Badge>}
          </div>

          {/* Paradas */}
          <div className="rounded-md border border-border">
            <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
              <span className="text-xs font-bold">Paradas ({stops.length})</span>
              <span className="text-xs text-muted-foreground">{totalPairs} pares · {totalKm.toFixed(1)} km</span>
            </div>
            <ScrollArea className="h-[260px]">
              <ul className="divide-y">
                {stops.map((s, idx) => (
                  <li key={s.order.id} className="px-3 py-2 flex items-start gap-2">
                    <Badge variant="outline" className="font-mono shrink-0 h-6 min-w-[28px] justify-center">
                      {idx + 1}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold truncate">
                          {s.order.client?.razao_social || s.order.client_name || '—'}
                        </span>
                        {s.order.client?.branch_code && (
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {s.order.client.branch_code}
                            {s.order.client.branch_name ? ` · ${s.order.client.branch_name}` : ''}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">PV #{s.order.order_number}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {[s.order.client?.endereco, s.order.client?.bairro, s.order.client?.cidade, s.order.client?.estado]
                          .filter(Boolean).join(' · ') || 'Sem endereço cadastrado'}
                      </p>
                      {s.geoError && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />{s.geoError}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-mono">{(s.order.total_pairs ?? 0)} prs</div>
                      {s.distanceFromPreviousKm !== undefined && (
                        <div className="text-[10px] text-muted-foreground">
                          +{s.distanceFromPreviousKm.toFixed(1)} km
                        </div>
                      )}
                    </div>
                  </li>
                ))}
                {stops.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Selecione pedidos antes de abrir o planejador.
                  </li>
                )}
              </ul>
            </ScrollArea>
          </div>

          {/* Custos */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <CostBadge icon={<MapPin className="h-3.5 w-3.5" />} label="Distância" value={`${totalKm.toFixed(1)} km`} />
            <CostBadge
              icon={<Fuel className="h-3.5 w-3.5" />}
              label={selectedVehicle ? `Combustível (${selectedVehicle.fuel_type})` : 'Combustível'}
              value={cost ? `${formatBrl(cost.fuelCostBrl)} · ${cost.litersConsumed.toFixed(1)} L` : '—'}
              hint={selectedVehicle ? `${selectedVehicle.fuel_consumption_km_l} km/L · ${formatBrl(fuelPrice)}/L` : undefined}
            />
            <CostBadge
              icon={<Wrench className="h-3.5 w-3.5" />}
              label="Desgaste"
              value={cost ? formatBrl(cost.wearCostBrl) : '—'}
              hint={selectedVehicle ? `${formatBrl(selectedVehicle.wear_cost_per_km)}/km` : undefined}
            />
            <CostBadge
              icon={<Coins className="h-3.5 w-3.5" />}
              label="Total / par"
              value={cost ? `${formatBrl(cost.totalCostBrl)}${cost.costPerPair !== null ? ` · ${formatBrl(cost.costPerPair)}/par` : ''}` : '—'}
              highlight
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={!canSubmit || create.isPending}>
            {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            Salvar rota
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CostBadge({
  icon, label, value, hint, highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-md border p-2 ${highlight ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/20'}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`mt-1 font-mono ${highlight ? 'text-foreground font-bold' : 'text-foreground'} text-sm leading-tight`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
