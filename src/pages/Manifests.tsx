import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText as FileCheck2, Plus, ArrowLeft, CircleNotch as Loader2, CaretRight as ChevronRight, Trash as Trash2, Truck, Package, MapPin, Lock, ArrowCounterClockwise as RotateCcw } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { useSaleOrderWeight } from '@/hooks/useSaleOrderWeight';
import { IncompleteWeightWarning } from '@/components/weight/IncompleteWeightWarning';
import { toast } from 'sonner';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

type ManifestStatus = 'em_montagem' | 'liberado' | 'em_transito' | 'entregue' | 'cancelado';

const STATUS_COLOR: Record<string, string> = {
  em_montagem: 'bg-blue-100 text-blue-700 border-blue-300',
  liberado: 'bg-amber-100 text-amber-700 border-amber-300',
  em_transito: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  entregue: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  cancelado: 'bg-muted text-muted-foreground border-border',
};

export default function Manifests() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (selectedId) {
    return <ManifestDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-4">
      <ManifestsList onOpen={setSelectedId} onCreate={() => setCreating(true)} />
      <NewManifestDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => { setCreating(false); setSelectedId(id); }}
      />
    </div>
  );
}

function ManifestsList({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['shipping_manifests'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('shipping_manifests')
        .select('*, transporters(name)')
        .order('emission_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <>
      <EditorialPageHeader
        sectionLabel="FISCAL · Manifestos"
        title="Romaneios de Carga"
        description="Controle interno de viagens — agrupa volumes por veículo/motorista, com destinos múltiplos."
        actions={
          <Button onClick={onCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> Novo Romaneio
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : items.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={FileCheck2}
            title="Nenhum romaneio"
            description="Crie um romaneio para agrupar volumes por veículo e motorista."
            action={<Button variant="outline" size="sm" onClick={onCreate}>Criar primeiro</Button>}
          />
        </Panel>
      ) : (
        <div className="space-y-2">
          {items.map((r: any) => (
            <Card key={r.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onOpen(r.id)}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-xs">{r.manifest_number}</span>
                    <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_COLOR[r.status]}`}>
                      {r.status.replace('_', ' ')}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(r.emission_date), 'dd/MM/yy')}
                      {r.vehicle_plate && ` · 🚛 ${r.vehicle_plate}`}
                      {(r.transporters?.name || r.transporter_name) && ` · ${r.transporters?.name || r.transporter_name}`}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {r.total_volumes} volumes · {r.total_pairs} pares · {Number(r.total_weight_kg || 0).toFixed(1)} kg · {r.destinations_count} destino(s)
                    {r.driver_name && ` · 👤 ${r.driver_name}`}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function ManifestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();

  const { data: manifest } = useQuery({
    queryKey: ['shipping_manifest', id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('shipping_manifests')
        .select('*, transporters(name, cnpj)')
        .eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: volumes = [] } = useQuery({
    queryKey: ['shipping_volumes', id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('shipping_volumes')
        .select('*, sale_orders(order_number, client_name)')
        .eq('manifest_id', id)
        .order('volume_number');
      if (error) throw error;
      return data || [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async (newStatus: ManifestStatus) => {
      const { error } = await (supabase as any)
        .from('shipping_manifests')
        .update({ status: newStatus })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipping_manifest', id] });
      qc.invalidateQueries({ queryKey: ['shipping_manifests'] });
      toast.success('Status atualizado.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delVolume = useMutation({
    mutationFn: async (vid: string) => {
      const { error } = await (supabase as any).from('shipping_volumes').delete().eq('id', vid);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipping_volumes', id] });
      // Recomputar totais
      computeTotals.mutate();
      toast.success('Volume removido.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const computeTotals = useMutation({
    mutationFn: async () => {
      const { data: vols } = await (supabase as any).from('shipping_volumes').select('*').eq('manifest_id', id);
      const total_volumes = vols?.length ?? 0;
      const total_pairs = (vols ?? []).reduce((s: number, v: any) => s + Number(v.total_pairs ?? 0), 0);
      const total_weight_kg = (vols ?? []).reduce((s: number, v: any) => s + Number(v.weight_kg ?? 0), 0);
      const dests = new Set<string>();
      for (const v of vols ?? []) {
        if (v.destination_city || v.destination_uf) {
          dests.add(`${v.destination_city ?? ''}/${v.destination_uf ?? ''}`);
        } else if (v.sale_orders) {
          dests.add(v.sale_order_id);
        }
      }
      await (supabase as any).from('shipping_manifests').update({
        total_volumes, total_pairs, total_weight_kg,
        destinations_count: dests.size,
      }).eq('id', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipping_manifest', id] }),
  });

  if (!manifest) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  const editable = !['cancelado', 'entregue'].includes(manifest.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-primary" /> {manifest.manifest_number}
              <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_COLOR[manifest.status]}`}>
                {manifest.status.replace('_', ' ')}
              </Badge>
            </h1>
            <p className="text-xs text-muted-foreground">
              {format(new Date(manifest.emission_date), 'dd/MM/yyyy')}
              {manifest.vehicle_plate && ` · 🚛 ${manifest.vehicle_plate}`}
              {manifest.driver_name && ` · 👤 ${manifest.driver_name}`}
              {manifest.transporters?.name && ` · ${manifest.transporters.name}`}
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {manifest.status === 'em_montagem' && (
            <Button size="sm" className="gap-1.5" onClick={() => updateStatus.mutate('liberado')}>
              <Lock className="h-3.5 w-3.5" /> Liberar
            </Button>
          )}
          {manifest.status === 'liberado' && (
            <Button size="sm" className="gap-1.5" onClick={() => updateStatus.mutate('em_transito')}>
              <Truck className="h-3.5 w-3.5" /> Em trânsito
            </Button>
          )}
          {manifest.status === 'em_transito' && (
            <Button size="sm" className="gap-1.5" onClick={() => updateStatus.mutate('entregue')}>
              <Package className="h-3.5 w-3.5" /> Entregue
            </Button>
          )}
          {editable && (
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={() => {
              if (!confirm('Cancelar este romaneio?')) return;
              updateStatus.mutate('cancelado');
            }}>
              <Trash2 className="h-3.5 w-3.5" /> Cancelar
            </Button>
          )}
        </div>
      </div>

      <StatGrid>
        <StatCard label="Volumes" value={manifest.total_volumes} />
        <StatCard label="Pares" value={manifest.total_pairs} />
        <StatCard label="Peso" value={Number(manifest.total_weight_kg).toFixed(1)} unit="kg" />
        <StatCard label="Destinos" value={manifest.destinations_count} />
      </StatGrid>

      <VolumesTab manifestId={id} volumes={volumes} editable={editable} onVolumeChange={() => computeTotals.mutate()} onDelete={(vid) => delVolume.mutate(vid)} />

      {manifest.notes && (
        <Panel title="Observações">
          <p className="text-xs whitespace-pre-wrap text-muted-foreground">{manifest.notes}</p>
        </Panel>
      )}
    </div>
  );
}

function VolumesTab({
  manifestId, volumes, editable, onVolumeChange, onDelete,
}: {
  manifestId: string;
  volumes: any[];
  editable: boolean;
  onVolumeChange: () => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      <Panel
        eyebrow="FISCAL · ROMANEIO"
        title={`Volumes (${volumes.length})`}
        actions={editable && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Adicionar volume
          </Button>
        )}
        flush
      >
      {volumes.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nenhum volume"
          description="Adicione os volumes que vão na viagem."
          size="sm"
        />
      ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Pedido</th>
                  <th className="text-left p-2">Destino</th>
                  <th className="text-left p-2">Tipo</th>
                  <th className="text-right p-2">Pares</th>
                  <th className="text-right p-2">Peso</th>
                  <th className="text-left p-2">EAN</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {volumes.map((v: any) => (
                  <tr key={v.id} className="border-b border-border/40">
                    <td className="p-2 font-mono">{v.volume_number}</td>
                    <td className="p-2">
                      {v.sale_orders?.order_number ? (
                        <>
                          <span className="font-medium">{v.sale_orders.order_number}</span>
                          <p className="text-[10px] text-muted-foreground">{v.sale_orders.client_name}</p>
                        </>
                      ) : '—'}
                    </td>
                    <td className="p-2">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        {v.destination_city ?? '—'}/{v.destination_uf ?? '—'}
                      </span>
                    </td>
                    <td className="p-2"><Badge variant="outline" className="text-[10px] capitalize">{v.volume_type?.replace('_', ' ')}</Badge></td>
                    <td className="p-2 text-right font-mono">{v.total_pairs}</td>
                    <td className="p-2 text-right font-mono">{Number(v.weight_kg).toFixed(1)} kg</td>
                    <td className="p-2 font-mono text-[10px]">{v.ean || '—'}</td>
                    <td className="p-2 text-right">
                      {editable && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => onDelete(v.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      )}
      </Panel>

      <AddVolumeDialog
        manifestId={manifestId}
        nextNumber={(Math.max(0, ...volumes.map((v: any) => v.volume_number)) + 1)}
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={onVolumeChange}
      />
    </div>
  );
}

function AddVolumeDialog({
  manifestId, nextNumber, open, onClose, onSaved,
}: {
  manifestId: string;
  nextNumber: number;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [saleOrderId, setSaleOrderId] = useState('');
  const [volumeType, setVolumeType] = useState('caixa_individual');
  const [totalPairs, setTotalPairs] = useState(0);
  const [weight, setWeight] = useState(0);
  const [city, setCity] = useState('');
  const [uf, setUf] = useState('');
  const [ean, setEan] = useState('');
  /** Marca se peso/pares foram preenchidos pela RPC; se user editar, vira false. */
  const [autoFilled, setAutoFilled] = useState(false);

  const { data: weightData } = useSaleOrderWeight(saleOrderId || null);

  const applyWeightFromPv = () => {
    if (!weightData) return;
    setTotalPairs(weightData.totalPairs);
    setWeight(weightData.grossWeightKg);
    setAutoFilled(true);
  };

  const { data: saleOrders = [] } = useQuery({
    queryKey: ['sale_orders_for_manifest'],
    queryFn: async () => {
      // PVs aptos a manifesto: 'Pronto'/'Faturado' (fluxo formal com NF) OU
      // 'Em Produção' com nfe_required=false (fluxo informal, vai pra
      // 'Finalizado s/ NF' quando register_order_shipment for chamado).
      const { data } = await (supabase as any)
        .from('sale_orders')
        .select('id, order_number, client_name, delivery_city, delivery_state, status, nfe_required')
        .or('status.in.(Pronto,pronto,Faturado,faturado),and(status.eq.Em Produção,nfe_required.eq.false)')
        .order('created_at', { ascending: false })
        .limit(200);
      return data || [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const so = saleOrders.find((s: any) => s.id === saleOrderId);
      const { error } = await (supabase as any).from('shipping_volumes').insert({
        manifest_id: manifestId,
        sale_order_id: saleOrderId || null,
        volume_number: nextNumber,
        volume_type: volumeType,
        total_pairs: totalPairs,
        weight_kg: weight,
        destination_city: city || so?.delivery_city || '',
        destination_uf: uf || so?.delivery_state || '',
        ean,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipping_volumes', manifestId] });
      onSaved();
      toast.success('Volume adicionado.');
      setSaleOrderId(''); setTotalPairs(0); setWeight(0); setCity(''); setUf(''); setEan('');
      setAutoFilled(false);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar volume (#{nextNumber})</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Pedido de venda (opcional)</Label>
            <Select value={saleOrderId} onValueChange={(v) => {
              setSaleOrderId(v);
              setAutoFilled(false);
              const so = saleOrders.find((s: any) => s.id === v);
              if (so) {
                if (!city && so.delivery_city) setCity(so.delivery_city);
                if (!uf && so.delivery_state) setUf(so.delivery_state);
              }
            }}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>
                {saleOrders.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.order_number} — {s.client_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {weightData && (
              <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 flex items-center gap-2 text-xs">
                <Package className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="flex-1">
                  PV calculado: <strong>{weightData.totalPairs} pares</strong> ·{' '}
                  <strong>{weightData.grossWeightKg.toFixed(3)} kg</strong>
                  {weightData.boxWeightKg > 0 && (
                    <span className="text-muted-foreground"> (caixinha: {weightData.boxWeightKg.toFixed(3)} kg)</span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={applyWeightFromPv}
                  disabled={autoFilled && totalPairs === weightData.totalPairs && weight === weightData.grossWeightKg}
                >
                  <RotateCcw className="h-3 w-3" />
                  {autoFilled ? 'Aplicado' : 'Aplicar'}
                </Button>
              </div>
            )}
            {weightData && !weightData.isComplete && (
              <div className="mt-2">
                <IncompleteWeightWarning items={weightData.incompleteItems} scope="neste PV" />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Tipo</Label>
              <Select value={volumeType} onValueChange={setVolumeType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="caixa_individual">Caixa individual</SelectItem>
                  <SelectItem value="caixa_masterbox">Master box</SelectItem>
                  <SelectItem value="palete">Palete</SelectItem>
                  <SelectItem value="fracionado">Fracionado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>EAN</Label>
              <Input value={ean} onChange={e => setEan(e.target.value)} className="font-mono" />
            </div>
            <div>
              <Label>Pares{autoFilled && <span className="ml-1 text-[9px] text-primary uppercase font-bold">auto</span>}</Label>
              <Input type="number" min={0} value={totalPairs} onChange={e => { setTotalPairs(+e.target.value); setAutoFilled(false); }} />
            </div>
            <div>
              <Label>Peso (kg){autoFilled && <span className="ml-1 text-[9px] text-primary uppercase font-bold">auto</span>}</Label>
              <Input type="number" step="0.001" min={0} value={weight} onChange={e => { setWeight(+e.target.value); setAutoFilled(false); }} />
            </div>
            <div>
              <Label>Cidade destino</Label>
              <Input value={city} onChange={e => setCity(e.target.value)} />
            </div>
            <div>
              <Label>UF</Label>
              <Input value={uf} onChange={e => setUf(e.target.value.toUpperCase())} maxLength={2} className="uppercase" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => add.mutate()} disabled={add.isPending}>
            {add.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewManifestDialog({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [plate, setPlate] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [transporterId, setTransporterId] = useState('');
  const [origin, setOrigin] = useState('');
  const [notes, setNotes] = useState('');

  const { data: transporters = [] } = useQuery({
    queryKey: ['transporters_active'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('transporters').select('id, name').eq('active', true).order('name');
      return data || [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const t = transporters.find((x: any) => x.id === transporterId);
      const { data, error } = await (supabase as any)
        .from('shipping_manifests')
        .insert({
          vehicle_plate: plate.trim().toUpperCase(),
          driver_name: driverName.trim(),
          driver_phone: driverPhone.trim(),
          transporter_id: transporterId || null,
          transporter_name: t?.name ?? '',
          origin: origin.trim(),
          notes: notes.trim(),
          status: 'em_montagem',
        })
        .select('id').single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success('Romaneio criado.');
      setPlate(''); setDriverName(''); setDriverPhone(''); setTransporterId(''); setOrigin(''); setNotes('');
      onCreated(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileCheck2 className="h-4 w-4" /> Novo Romaneio</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div>
            <Label>Placa</Label>
            <Input value={plate} onChange={e => setPlate(e.target.value)} className="uppercase" placeholder="RIO1A23" />
          </div>
          <div>
            <Label>Origem (cidade)</Label>
            <Input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="Belford Roxo" />
          </div>
          <div>
            <Label>Motorista</Label>
            <Input value={driverName} onChange={e => setDriverName(e.target.value)} />
          </div>
          <div>
            <Label>Telefone motorista</Label>
            <Input value={driverPhone} onChange={e => setDriverPhone(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Transportadora (opcional)</Label>
            <Select value={transporterId} onValueChange={setTransporterId}>
              <SelectTrigger><SelectValue placeholder="Selecionar..." /></SelectTrigger>
              <SelectContent>
                {transporters.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
