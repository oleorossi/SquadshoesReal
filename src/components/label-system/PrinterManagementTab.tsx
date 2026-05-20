import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Printer, WifiHigh as Wifi, MagnifyingGlass as Search, Plus, Gear as Settings2, Trash as Trash2, CheckCircle as CheckCircle2, Warning as AlertTriangle, CircleNotch as Loader2, Plugs as Unplug, Plug, Gauge, Stack as Layers } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { PrinterInfo } from '@/types/label-system';

interface PrinterConfig extends PrinterInfo {
  connection_type: 'USB' | 'Network' | 'Bluetooth';
  address: string;
  port: number;
  dpi: number;
  max_width_mm: number;
  max_height_mm: number;
  auto_calibrate: boolean;
  cost_per_label: number;
}

const INITIAL_PRINTERS: PrinterConfig[] = [
  {
    id: '1', name: 'Elgin L42 Pro', brand: 'Elgin', model: 'L42 Pro',
    status: 'online', paper_level: 72, jobs_in_queue: 2,
    last_heartbeat: new Date().toISOString(),
    connection_type: 'USB', address: 'USB001', port: 9100,
    dpi: 203, max_width_mm: 104, max_height_mm: 200,
    auto_calibrate: true, cost_per_label: 0.03,
  },
  {
    id: '2', name: 'Zebra ZD421', brand: 'Zebra', model: 'ZD421',
    status: 'online', paper_level: 95, jobs_in_queue: 0,
    last_heartbeat: new Date().toISOString(),
    connection_type: 'Network', address: '192.168.1.100', port: 9100,
    dpi: 300, max_width_mm: 108, max_height_mm: 300,
    auto_calibrate: true, cost_per_label: 0.05,
  },
  {
    id: '3', name: 'Brother QL-820', brand: 'Brother', model: 'QL-820NWB',
    status: 'offline', paper_level: 30, jobs_in_queue: 0,
    last_heartbeat: new Date(Date.now() - 3600000).toISOString(),
    connection_type: 'Bluetooth', address: 'BT:AA:BB:CC:DD:EE', port: 0,
    dpi: 300, max_width_mm: 62, max_height_mm: 100,
    auto_calibrate: false, cost_per_label: 0.04,
  },
];

const DISCOVERABLE_PRINTERS: Partial<PrinterConfig>[] = [
  { name: 'Epson TM-L90', brand: 'Epson', model: 'TM-L90', connection_type: 'Network', address: '192.168.1.105', port: 9100, dpi: 203, max_width_mm: 80, max_height_mm: 200 },
  { name: 'Dymo LabelWriter 550', brand: 'Dymo', model: 'LW-550', connection_type: 'USB', address: 'USB003', port: 0, dpi: 300, max_width_mm: 56, max_height_mm: 100 },
];

export function PrinterManagementTab() {
  const [printers, setPrinters] = useState<PrinterConfig[]>(INITIAL_PRINTERS);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<Partial<PrinterConfig>[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<PrinterConfig | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [manualForm, setManualForm] = useState({ name: '', address: '', port: '9100', brand: 'Generic', connection_type: 'Network' });

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscovered([]);
    // Simulate discovery
    await new Promise(r => setTimeout(r, 2000));
    const newOnes = DISCOVERABLE_PRINTERS.filter(d => !printers.some(p => p.address === d.address));
    setDiscovered(newOnes);
    setDiscovering(false);
    toast.success(`${newOnes.length} nova(s) impressora(s) encontrada(s)`);
  };

  const handleAddDiscovered = (d: Partial<PrinterConfig>) => {
    const newPrinter: PrinterConfig = {
      id: crypto.randomUUID(),
      name: d.name || 'Impressora',
      brand: d.brand || 'Generic',
      model: d.model || '',
      status: 'offline',
      paper_level: 100,
      jobs_in_queue: 0,
      last_heartbeat: new Date().toISOString(),
      connection_type: (d.connection_type as PrinterConfig['connection_type']) || 'Network',
      address: d.address || '',
      port: d.port || 9100,
      dpi: d.dpi || 203,
      max_width_mm: d.max_width_mm || 100,
      max_height_mm: d.max_height_mm || 200,
      auto_calibrate: true,
      cost_per_label: 0.04,
    };
    setPrinters(prev => [...prev, newPrinter]);
    setDiscovered(prev => prev.filter(x => x.address !== d.address));
    toast.success(`${newPrinter.name} adicionada`);
  };

  const handleAddManual = () => {
    if (!manualForm.name || !manualForm.address) {
      toast.error('Nome e endereço são obrigatórios');
      return;
    }
    const newPrinter: PrinterConfig = {
      id: crypto.randomUUID(),
      name: manualForm.name,
      brand: manualForm.brand,
      model: '',
      status: 'offline',
      paper_level: 100,
      jobs_in_queue: 0,
      last_heartbeat: new Date().toISOString(),
      connection_type: manualForm.connection_type as PrinterConfig['connection_type'],
      address: manualForm.address,
      port: parseInt(manualForm.port) || 9100,
      dpi: 203,
      max_width_mm: 100,
      max_height_mm: 200,
      auto_calibrate: true,
      cost_per_label: 0.04,
    };
    setPrinters(prev => [...prev, newPrinter]);
    setAddDialogOpen(false);
    setManualForm({ name: '', address: '', port: '9100', brand: 'Generic', connection_type: 'Network' });
    toast.success(`${newPrinter.name} adicionada manualmente`);
  };

  const handleToggleConnection = (id: string) => {
    setPrinters(prev => prev.map(p => {
      if (p.id !== id) return p;
      const newStatus = p.status === 'online' ? 'offline' : 'online';
      toast.success(newStatus === 'online' ? `${p.name} conectada` : `${p.name} desconectada`);
      return { ...p, status: newStatus, last_heartbeat: new Date().toISOString() };
    }));
  };

  const handleRemove = (id: string) => {
    setPrinters(prev => prev.filter(p => p.id !== id));
    if (selectedPrinter?.id === id) setSelectedPrinter(null);
    toast.success('Impressora removida');
  };

  const onlinePrinters = printers.filter(p => p.status === 'online');
  const offlinePrinters = printers.filter(p => p.status !== 'online');

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-foreground">Impressoras Configuradas</h3>
          <p className="text-xs text-muted-foreground">{onlinePrinters.length} online · {offlinePrinters.length} offline</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDiscover} disabled={discovering} className="gap-1.5">
            {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Descobrir
          </Button>
          <Button size="sm" onClick={() => setAddDialogOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Adicionar Manual
          </Button>
        </div>
      </div>

      {/* Discovered printers */}
      {discovered.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wifi className="h-4 w-4 text-primary" /> Impressoras Descobertas
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {discovered.map((d, i) => (
              <div key={i} className="flex items-center justify-between border rounded-md p-3 bg-background">
                <div>
                  <span className="font-medium text-sm">{d.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{d.connection_type} · {d.address}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleAddDiscovered(d)} className="gap-1">
                  <Plus className="h-3 w-3" /> Adicionar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Printers grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {printers.map(p => (
          <Card
            key={p.id}
            className={`cursor-pointer transition-all ${selectedPrinter?.id === p.id ? 'ring-2 ring-primary' : ''} ${p.status !== 'online' ? 'opacity-70' : ''}`}
            onClick={() => setSelectedPrinter(p)}
          >
            <CardHeader className="pb-2 px-4 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Printer className={`h-5 w-5 ${p.status === 'online' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div>
                    <CardTitle className="text-sm">{p.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{p.brand} {p.model}</p>
                  </div>
                </div>
                <Badge variant={p.status === 'online' ? 'default' : 'secondary'} className="text-xs">
                  {p.status === 'online' ? '● Online' : '○ Offline'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Wifi className="h-3 w-3" /> {p.connection_type}
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Gauge className="h-3 w-3" /> {p.dpi} DPI
                </div>
              </div>

              {/* Paper level */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Papel</span>
                  <span className={p.paper_level < 20 ? 'text-destructive font-medium' : ''}>{p.paper_level}%</span>
                </div>
                <Progress value={p.paper_level} className="h-1.5" />
              </div>

              {p.jobs_in_queue > 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Layers className="h-3 w-3" /> {p.jobs_in_queue} job(s) na fila
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-1 pt-1">
                <Button
                  size="sm"
                  variant={p.status === 'online' ? 'outline' : 'default'}
                  className="flex-1 gap-1 text-xs h-7"
                  onClick={(e) => { e.stopPropagation(); handleToggleConnection(p.id); }}
                >
                  {p.status === 'online' ? <><Unplug className="h-3 w-3" /> Desconectar</> : <><Plug className="h-3 w-3" /> Conectar</>}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={(e) => { e.stopPropagation(); handleRemove(p.id); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Selected printer details */}
      {selectedPrinter && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Detalhes: {selectedPrinter.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Conexão</p>
                <p>{selectedPrinter.connection_type} · {selectedPrinter.address}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Resolução</p>
                <p>{selectedPrinter.dpi} DPI</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Largura Máx.</p>
                <p>{selectedPrinter.max_width_mm} mm</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">Custo/Etiqueta</p>
                <p>R$ {selectedPrinter.cost_per_label.toFixed(2)}</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                {selectedPrinter.auto_calibrate ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <AlertTriangle className="h-3 w-3 text-amber-500" />}
                Auto-calibração {selectedPrinter.auto_calibrate ? 'ativa' : 'inativa'}
              </span>
              <span>Último heartbeat: {new Date(selectedPrinter.last_heartbeat).toLocaleTimeString('pt-BR')}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual add dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Impressora Manualmente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={manualForm.name} onChange={e => setManualForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Zebra ZD421 - Linha 2" />
            </div>
            <div>
              <Label>Tipo de Conexão</Label>
              <Select value={manualForm.connection_type} onValueChange={v => setManualForm(f => ({ ...f, connection_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Network">Rede (IP)</SelectItem>
                  <SelectItem value="USB">USB</SelectItem>
                  <SelectItem value="Bluetooth">Bluetooth</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Endereço / IP</Label>
                <Input value={manualForm.address} onChange={e => setManualForm(f => ({ ...f, address: e.target.value }))} placeholder="192.168.1.100" />
              </div>
              <div>
                <Label>Porta</Label>
                <Input value={manualForm.port} onChange={e => setManualForm(f => ({ ...f, port: e.target.value }))} placeholder="9100" />
              </div>
            </div>
            <div>
              <Label>Marca</Label>
              <Select value={manualForm.brand} onValueChange={v => setManualForm(f => ({ ...f, brand: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Zebra">Zebra</SelectItem>
                  <SelectItem value="Elgin">Elgin</SelectItem>
                  <SelectItem value="Brother">Brother</SelectItem>
                  <SelectItem value="Epson">Epson</SelectItem>
                  <SelectItem value="Dymo">Dymo</SelectItem>
                  <SelectItem value="Generic">Genérica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddManual} className="w-full">Adicionar Impressora</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
