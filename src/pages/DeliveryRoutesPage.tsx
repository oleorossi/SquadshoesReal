import { useMemo, useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Truck, MapPin, CheckCircle, Clock, Path as RouteIcon } from '@phosphor-icons/react';
import {
  useDeliveryRoutes, useVehicles, useDrivers, useRouteStops,
  useCreateDeliveryRoute, useAddRouteStop, useMarkStopDelivered,
  type DeliveryRouteSummary, type RouteStop,
} from '@/hooks/useLogistics';
import { useSaleOrders } from '@/hooks/useSaleOrders';

const STATUS_TONE: Record<string, string> = {
  planned:     'border-amber-500/40 text-amber-700',
  in_progress: 'bg-blue-500/15 text-blue-700 border-blue-500/40',
  completed:   'bg-emerald-500/15 text-emerald-700 border-emerald-500/40',
  cancelled:   'bg-muted text-muted-foreground border-border',
};
const STATUS_LABEL: Record<string, string> = {
  planned: 'Planejada', in_progress: 'Em rota', completed: 'Concluída', cancelled: 'Cancelada',
};

export default function DeliveryRoutesPage() {
  const { data: routes = [], isLoading } = useDeliveryRoutes();
  const { data: vehicles = [] } = useVehicles();
  const { data: drivers = [] } = useDrivers();
  const createRoute = useCreateDeliveryRoute();

  const [createOpen, setCreateOpen] = useState(false);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', scheduledDate: '', vehicleId: '', driverId: '', notes: '' });

  const totals = useMemo(() => ({
    total: routes.length,
    planned: routes.filter(r => r.status === 'planned').length,
    inProgress: routes.filter(r => r.status === 'in_progress').length,
    pendingStops: routes.reduce((s, r) => s + r.pending_stops, 0),
  }), [routes]);

  const handleCreateRoute = async () => {
    if (!form.name.trim()) return;
    try {
      const id = await createRoute.mutateAsync({
        name: form.name.trim(),
        scheduledDate: form.scheduledDate || null,
        vehicleId: form.vehicleId || null,
        driverId: form.driverId || null,
        notes: form.notes.trim() || null,
      });
      setForm({ name: '', scheduledDate: '', vehicleId: '', driverId: '', notes: '' });
      setCreateOpen(false);
      setActiveRouteId(id);
    } catch {}
  };

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="LOGÍSTICA · ROTAS"
          title="Rotas de entrega"
          description="Planeja entregas próprias com veículo, motorista e paradas (PVs). Motorista marca paradas como entregues — quando zera pendentes, rota fecha automaticamente."
          actions={
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Nova rota
            </Button>
          }
        />

        <StatGrid>
          <StatCard icon={RouteIcon} label="Rotas cadastradas" value={totals.total} hint="histórico total" />
          <StatCard icon={Clock} label="Planejadas" value={totals.planned} hint="aguardando saída" tone={totals.planned > 0 ? 'warning' : 'default'} />
          <StatCard icon={Truck} label="Em rota" value={totals.inProgress} hint="motorista em campo" tone={totals.inProgress > 0 ? 'primary' : 'default'} />
          <StatCard icon={MapPin} label="Paradas pendentes" value={totals.pendingStops} hint="ainda não entregues" />
        </StatGrid>

        {isLoading ? (
          <Panel><div className="text-sm text-muted-foreground py-8 text-center">Carregando rotas...</div></Panel>
        ) : routes.length === 0 ? (
          <Panel flush>
            <EmptyState
              icon={RouteIcon}
              title="Nenhuma rota cadastrada"
              description="Cadastre veículos e motoristas primeiro (em iteração futura), depois crie a primeira rota e adicione PVs como paradas."
            />
          </Panel>
        ) : (
          <Panel flush>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>Rota</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Veículo / Motorista</TableHead>
                  <TableHead className="text-right">Paradas</TableHead>
                  <TableHead className="text-right">Entregues</TableHead>
                  <TableHead className="text-right">Pendentes</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">
                      <div>{r.name}</div>
                      {r.total_distance_km != null && <div className="text-xs text-muted-foreground">{r.total_distance_km} km</div>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.scheduled_date ? new Date(r.scheduled_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-mono">{r.vehicle_plate || '—'}</div>
                      <div className="text-muted-foreground">{r.driver_name || '—'}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.total_stops}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">{r.delivered_stops}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">{r.pending_stops}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`text-xs ${STATUS_TONE[r.status] || ''}`}>
                        {STATUS_LABEL[r.status] || r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setActiveRouteId(r.id)}>
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova rota</DialogTitle>
            <DialogDescription>Cria uma rota planejada. Adicione paradas (PVs) depois.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Centro-Sul · 30/05" className="h-9" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Data prevista</Label>
                <Input type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Veículo</Label>
                <Select value={form.vehicleId} onValueChange={v => setForm(f => ({ ...f, vehicleId: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {vehicles.filter(v => v.active).map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.plate} · {v.model || ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Motorista</Label>
              <Select value={form.driverId} onValueChange={v => setForm(f => ({ ...f, driverId: v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {drivers.filter(d => d.active).map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notas</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateRoute} disabled={!form.name.trim() || createRoute.isPending}>
              {createRoute.isPending ? 'Criando...' : 'Criar rota'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {activeRouteId && (
        <RouteDetailDialog routeId={activeRouteId} route={routes.find(r => r.id === activeRouteId)} onClose={() => setActiveRouteId(null)} />
      )}
    </AppLayout>
  );
}

function RouteDetailDialog({
  routeId, route, onClose,
}: { routeId: string; route?: DeliveryRouteSummary; onClose: () => void }) {
  const { data: stops = [] } = useRouteStops(routeId);
  const { data: saleOrders = [] } = useSaleOrders();
  const addStop = useAddRouteStop();
  const markDelivered = useMarkStopDelivered();
  const [stopForm, setStopForm] = useState({ saleOrderId: '', notes: '' });
  const [deliverDialog, setDeliverDialog] = useState<RouteStop | null>(null);
  const [receiverName, setReceiverName] = useState('');

  const handleAddStop = async () => {
    if (!stopForm.saleOrderId) return;
    try {
      await addStop.mutateAsync({
        routeId,
        saleOrderId: stopForm.saleOrderId,
        notes: stopForm.notes.trim() || null,
      });
      setStopForm({ saleOrderId: '', notes: '' });
    } catch {}
  };

  const handleDeliver = async () => {
    if (!deliverDialog) return;
    try {
      await markDelivered.mutateAsync({
        stopId: deliverDialog.id,
        receiverName: receiverName.trim() || undefined,
        routeId,
      });
      setDeliverDialog(null);
      setReceiverName('');
    } catch {}
  };

  return (
    <>
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{route?.name || routeId}</DialogTitle>
            <DialogDescription>
              {route?.vehicle_plate ? `Veículo ${route.vehicle_plate}` : 'Sem veículo'} ·
              {' '}{route?.driver_name || 'Sem motorista'} ·
              {' '}{stops.length} parada(s) ({stops.filter(s => s.status === 'delivered').length} entregues)
            </DialogDescription>
          </DialogHeader>

          <Panel eyebrow="ADICIONAR PARADA" title="Nova parada (PV)" flush>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4">
              <div className="sm:col-span-2">
                <Label className="text-xs">PV / cliente</Label>
                <Select value={stopForm.saleOrderId} onValueChange={v => setStopForm(f => ({ ...f, saleOrderId: v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione PV..." /></SelectTrigger>
                  <SelectContent>
                    {(saleOrders as any[]).slice(0, 200).map((so: any) => (
                      <SelectItem key={so.id} value={so.id}>PV {so.order_number || so.id.slice(0, 8)} · {so.client?.razao_social || so.client_id || '—'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Notas</Label>
                <Input value={stopForm.notes} onChange={e => setStopForm(f => ({ ...f, notes: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div className="px-4 pb-4">
              <Button onClick={handleAddStop} disabled={!stopForm.saleOrderId || addStop.isPending} className="w-full gap-2">
                <Plus className="h-4 w-4" />
                {addStop.isPending ? 'Adicionando...' : 'Adicionar parada'}
              </Button>
            </div>
          </Panel>

          <Panel eyebrow="PARADAS" title={`${stops.length} parada(s) na rota`} flush>
            {stops.length === 0 ? (
              <EmptyState icon={MapPin} title="Sem paradas ainda" size="sm" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                    <TableHead className="w-12 text-center">#</TableHead>
                    <TableHead>PV</TableHead>
                    <TableHead>Recebido por</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stops.map(stop => (
                    <TableRow key={stop.id} className={stop.status === 'delivered' ? 'opacity-60' : ''}>
                      <TableCell className="text-center tabular-nums text-muted-foreground">{stop.stop_order}</TableCell>
                      <TableCell className="text-sm font-mono">{stop.sale_order_id?.slice(0, 8) || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {stop.receiver_name || '—'}
                        {stop.delivered_at && <div>{new Date(stop.delivered_at).toLocaleString('pt-BR')}</div>}
                      </TableCell>
                      <TableCell className="text-center">
                        {stop.status === 'delivered' ? (
                          <Badge variant="outline" className="text-xs gap-1 text-emerald-700 border-emerald-500/40">
                            <CheckCircle className="h-3 w-3" /> Entregue
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs gap-1 text-amber-700 border-amber-500/40">
                            <Clock className="h-3 w-3" /> Pendente
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {stop.status !== 'delivered' && (
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-emerald-700 hover:text-emerald-800" onClick={() => setDeliverDialog(stop)}>
                            <CheckCircle className="h-3.5 w-3.5" /> Marcar entregue
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deliverDialog} onOpenChange={(v) => { if (!v) { setDeliverDialog(null); setReceiverName(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar parada como entregue</DialogTitle>
            <DialogDescription>Registra timestamp e recebedor. Se for a última parada pendente da rota, fecha a rota automaticamente.</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Nome do recebedor</Label>
            <Input value={receiverName} onChange={e => setReceiverName(e.target.value)} placeholder="Quem recebeu" className="h-9" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeliverDialog(null); setReceiverName(''); }}>Cancelar</Button>
            <Button onClick={handleDeliver} disabled={markDelivered.isPending} className="gap-2">
              <CheckCircle className="h-4 w-4" />
              {markDelivered.isPending ? 'Marcando...' : 'Confirmar entrega'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
