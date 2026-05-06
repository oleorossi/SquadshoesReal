import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Loader2, Printer, Search, Tag, Download, Package, Layers,
  FileText, Clock, CheckCircle2, AlertTriangle, Users, Filter
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface BatchResult {
  batchId: string;
  totalLabels: number;
  estimatedTime: number;
  status: 'idle' | 'generating' | 'done' | 'error';
  progress: number;
}

export function LabelGenerationTab() {
  const [search, setSearch] = useState('');
  const [economicGroupSearch, setEconomicGroupSearch] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [templateType, setTemplateType] = useState('thermal');
  const [copies, setCopies] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [perFichaMode, setPerFichaMode] = useState(false);
  const [fichasCount, setFichasCount] = useState(1);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [selectAll, setSelectAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['label-orders', search, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('id, order_number, reference, color, sizes, quantity, status, sale_order_id, client_name')
        .in('status', statusFilter === 'all'
          ? ['Corte', 'Forração', 'Silk', 'Colagem', 'Montagem', 'Acabamento', 'Expedição']
          : [statusFilter])
        .order('created_at', { ascending: false })
        .limit(100);
      if (search.trim()) {
        query = query.or(`order_number.ilike.%${search}%,reference.ilike.%${search}%,client_name.ilike.%${search}%`);
      }
      const { data } = await query;
      return data || [];
    },
  });

  // Economic group search
  const { data: economicGroups = [] } = useQuery({
    queryKey: ['economic-groups-labels', economicGroupSearch],
    queryFn: async () => {
      if (!economicGroupSearch.trim()) return [];
      const { data } = await supabase
        .from('economic_groups')
        .select('id, name')
        .ilike('name', `%${economicGroupSearch}%`)
        .limit(10);
      return data || [];
    },
    enabled: economicGroupSearch.trim().length >= 2,
  });

  const filteredOrders = orders;

  const toggleOrder = (id: string) => {
    setSelectedOrders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedOrders(filteredOrders.map((o: any) => o.id));
    } else {
      setSelectedOrders([]);
    }
  };

  // Calculate total labels
  const totalLabels = useMemo(() => {
    if (perFichaMode) {
      // In per-ficha mode: each selected order's size grid * fichasCount * copies
      return selectedOrders.length * fichasCount * copies;
    }
    return selectedOrders.length * copies;
  }, [selectedOrders, copies, perFichaMode, fichasCount]);

  const estimatedTime = useMemo(() => {
    const labelsPerSecond = 8;
    return Math.ceil(totalLabels / labelsPerSecond);
  }, [totalLabels]);

  const handleGenerate = async () => {
    if (selectedOrders.length === 0) {
      toast.error('Selecione ao menos uma OP');
      return;
    }

    setGenerating(true);
    const batchId = crypto.randomUUID().slice(0, 8);
    setBatchResult({ batchId, totalLabels, estimatedTime, status: 'generating', progress: 0 });

    // Simulate batch processing with progress
    const steps = Math.min(totalLabels, 20);
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, 150));
      setBatchResult(prev => prev ? { ...prev, progress: Math.round((i / steps) * 100) } : null);
    }

    setBatchResult(prev => prev ? { ...prev, status: 'done', progress: 100 } : null);
    toast.success(`Lote ${batchId}: ${totalLabels} etiqueta(s) gerada(s)`, {
      description: perFichaMode
        ? `Modo por ficha: ${fichasCount} fichas × ${selectedOrders.length} OPs`
        : `${selectedOrders.length} OP(s) × ${copies} cópia(s)`,
    });
    setGenerating(false);
  };

  const handleDownloadBatch = () => {
    toast.info('Preparando pacote de download...');
  };

  const handleClearBatch = () => {
    setBatchResult(null);
    setSelectedOrders([]);
    setSelectAll(false);
  };

  return (
    <div className="space-y-4">
      {/* Search & Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">Buscar OP / Referência / Cliente</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Nº OP, referência ou cliente..."
              className="pl-9"
            />
          </div>
        </div>
        <div className="min-w-[180px]">
          <Label className="text-xs">Grupo Econômico</Label>
          <div className="relative">
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={economicGroupSearch}
              onChange={e => setEconomicGroupSearch(e.target.value)}
              placeholder="Buscar grupo..."
              className="pl-9"
            />
          </div>
          {economicGroups.length > 0 && economicGroupSearch.trim().length >= 2 && (
            <div className="absolute z-10 mt-1 bg-background border rounded-md shadow-md max-h-32 overflow-auto">
              {economicGroups.map((g: any) => (
                <button
                  key={g.id}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50"
                  onClick={() => {
                    setSearch(g.name);
                    setEconomicGroupSearch('');
                  }}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="w-40">
          <Label className="text-xs">Setor</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 text-xs">
              <Filter className="h-3.5 w-3.5 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos setores</SelectItem>
              <SelectItem value="Corte">Corte</SelectItem>
              <SelectItem value="Montagem">Montagem</SelectItem>
              <SelectItem value="Acabamento">Acabamento</SelectItem>
              <SelectItem value="Silk">Silk</SelectItem>
              <SelectItem value="Colagem">Colagem</SelectItem>
              <SelectItem value="Expedição">Expedição</SelectItem>
              <SelectItem value="Colagem">Colagem</SelectItem>
              <SelectItem value="Expedição">Expedição</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Config Row */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Label className="text-xs">Tipo de Etiqueta</Label>
          <Select value={templateType} onValueChange={setTemplateType}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="thermal">Térmica (100×30)</SelectItem>
              <SelectItem value="individual_box">Caixa Individual</SelectItem>
              <SelectItem value="master_box">Caixa Master</SelectItem>
              <SelectItem value="hangtag">Hangtag</SelectItem>
              <SelectItem value="shipping">Expedição</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-24">
          <Label className="text-xs">Cópias</Label>
          <Input type="number" min={1} max={100} value={copies} onChange={e => setCopies(Number(e.target.value))} className="h-9 text-xs" />
        </div>

        <Separator orientation="vertical" className="h-9 hidden sm:block" />

        {/* Per-Ficha Mode */}
        <div className="flex items-center gap-3 border rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <Switch checked={perFichaMode} onCheckedChange={setPerFichaMode} id="per-ficha" />
            <Label htmlFor="per-ficha" className="text-xs font-medium cursor-pointer">
              Modo por Ficha
            </Label>
          </div>
          {perFichaMode && (
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Fichas:</Label>
              <Input
                type="number" min={1} max={999}
                value={fichasCount}
                onChange={e => setFichasCount(Math.max(1, Number(e.target.value)))}
                className="h-7 w-16 text-xs"
              />
            </div>
          )}
        </div>
      </div>

      {/* Selection summary */}
      {selectedOrders.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-sm font-semibold">
                {selectedOrders.length} OP(s) selecionada(s)
              </span>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />{totalLabels} etiqueta(s)
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />~{estimatedTime}s
                </span>
                {perFichaMode && (
                  <Badge variant="outline" className="text-[10px]">
                    <Layers className="h-2.5 w-2.5 mr-1" />
                    {fichasCount} fichas/OP
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleClearBatch} className="text-xs">
                Limpar
              </Button>
              <Button onClick={handleGenerate} disabled={generating} className="gap-2">
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                {generating ? 'Gerando...' : 'Gerar Lote'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Batch Result */}
      {batchResult && (
        <Card className={cn(
          'transition-all',
          batchResult.status === 'done' && 'border-success/30 bg-success/5',
          batchResult.status === 'generating' && 'border-primary/30 bg-primary/5',
          batchResult.status === 'error' && 'border-destructive/30 bg-destructive/5',
        )}>
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {batchResult.status === 'done' && <CheckCircle2 className="h-5 w-5 text-success" />}
                {batchResult.status === 'generating' && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                {batchResult.status === 'error' && <AlertTriangle className="h-5 w-5 text-destructive" />}
                <div>
                  <p className="text-sm font-semibold">Lote #{batchResult.batchId}</p>
                  <p className="text-xs text-muted-foreground">
                    {batchResult.totalLabels} etiquetas · ~{batchResult.estimatedTime}s estimado
                  </p>
                </div>
              </div>
              {batchResult.status === 'done' && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleDownloadBatch}>
                    <Download className="h-3.5 w-3.5" />Download
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => {
                    toast.info('Enviando para impressora...');
                  }}>
                    <Printer className="h-3.5 w-3.5" />Imprimir
                  </Button>
                </div>
              )}
            </div>
            <Progress value={batchResult.progress} className="h-2" />
            {batchResult.status === 'done' && (
              <div className="flex items-center gap-3 text-xs">
                <Badge variant="outline" className="text-[10px] gap-1">
                  <FileText className="h-2.5 w-2.5" />Individuais
                </Badge>
                <Badge variant="outline" className="text-[10px] gap-1">
                  <Package className="h-2.5 w-2.5" />Master
                </Badge>
                <Button variant="link" size="sm" className="text-xs ml-auto p-0 h-auto" onClick={handleClearBatch}>
                  Novo lote
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Orders list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredOrders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Tag className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Nenhuma OP encontrada
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Select all header */}
          <div className="flex items-center gap-3 px-3 py-1.5">
            <Checkbox
              checked={selectAll}
              onCheckedChange={(c) => handleSelectAll(!!c)}
              id="select-all-labels"
            />
            <Label htmlFor="select-all-labels" className="text-xs text-muted-foreground font-medium cursor-pointer">
              Selecionar todas ({filteredOrders.length})
            </Label>
          </div>

          <div className="grid gap-2">
            {filteredOrders.map((o: any) => {
              const selected = selectedOrders.includes(o.id);
              const sizes = o.sizes || {};
              const sizeKeys = Object.keys(sizes);
              return (
                <Card
                  key={o.id}
                  className={cn(
                    'cursor-pointer transition-colors',
                    selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'
                  )}
                  onClick={() => toggleOrder(o.id)}
                >
                  <CardContent className="py-3 flex items-center gap-4">
                    <div className={cn(
                      'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30'
                    )}>
                      {selected && <span className="text-xs">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm">{o.order_number}</span>
                        <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                        {o.client_name && (
                          <span className="text-xs text-muted-foreground">· {o.client_name}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {o.reference} · {o.color || '—'} · {o.quantity} pares
                        {sizeKeys.length > 0 && (
                          <span className="ml-1">
                            · Grade: {sizeKeys.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    {perFichaMode && selected && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {sizeKeys.length > 0
                          ? `${Object.values(sizes).reduce((a: number, b: any) => a + (Number(b) || 0), 0)} × ${fichasCount}`
                          : `${o.quantity || 0} × ${fichasCount}`
                        } etiq.
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
