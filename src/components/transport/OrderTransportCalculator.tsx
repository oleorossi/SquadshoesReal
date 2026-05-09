import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Truck, Package, Box, Settings2, ChevronDown, Lightbulb, TrendingUp, Leaf, Weight, Ruler, Building2, MapPin } from 'lucide-react';
import { useBaus, useBoxTypes, useTransportCompanies, useTransportCompanyRates } from '@/hooks/useTransport';
import { calculatePacking } from '@/lib/packingCalculator';
import { PRODUCT_VOLUMES } from '@/lib/logistics/CubageEngine';
import { recommendBestVehicle, type Vehicle } from '@/lib/logistics/FleetOptimizer';
import type { Bau, PackingItem, PackingSummary } from '@/types/transport';
import { cn } from '@/lib/utils';
import { isStateCapital } from '@/lib/brazilStateCapitals';

interface OrderTransportProps {
  orderQuantity: number;
  orderWeight?: number;
  productCategory?: string;
  orderNumber?: string;
  /** Optional: pre-selected box dimensions from technical sheet */
  individualBoxDims?: { L: number; W: number; H: number; name?: string };
  masterBoxDims?: { L: number; W: number; H: number; name?: string; pairsPerMaster?: number };
  destinationCity?: string;
  destinationState?: string;
}

function bauToVehicle(b: Bau): Vehicle {
  const m3 = (b.comprimento_cm * b.largura_cm * b.altura_cm) / 1_000_000;
  const type: Vehicle['type'] = m3 <= 4 ? 'FIORINO' : m3 <= 14 ? 'SPRINTER' : 'CAMINHAO-34';
  return { id: b.id, name: b.nome, capacityM3: m3, type };
}

const FALLBACK_FLEET: Vehicle[] = [
  { id: 'fiorino', name: 'Fiorino', capacityM3: 2.5, type: 'FIORINO' },
  { id: 'sprinter', name: 'Sprinter', capacityM3: 10, type: 'SPRINTER' },
  { id: 'caminhao', name: 'Caminhão 3/4', capacityM3: 22, type: 'CAMINHAO-34' },
];

export function OrderTransportCalculator({
  orderQuantity,
  orderWeight,
  productCategory = 'ADULTO_SALTO',
  orderNumber,
  individualBoxDims,
  masterBoxDims,
  destinationCity,
  destinationState,
}: OrderTransportProps) {
  const { data: baus = [] } = useBaus();
  const { data: boxTypes = [] } = useBoxTypes();
  const { data: companies = [] } = useTransportCompanies();

  const [selectedBauId, setSelectedBauId] = useState('');
  const [stackingLevels, setStackingLevels] = useState(5);
  const [useOnlyIndividual, setUseOnlyIndividual] = useState(false);
  const [loadingEfficiency, setLoadingEfficiency] = useState(88);
  const [safetyMargin, setSafetyMargin] = useState(5);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const selectedBau = baus.find(b => b.id === selectedBauId);

  // Estimate volume from product category
  const unitVolume = (PRODUCT_VOLUMES as Record<string, number>)[productCategory] || PRODUCT_VOLUMES.ADULTO_SALTO;
  const estimatedVolume = orderQuantity * unitVolume;
  const estimatedWeight = orderWeight ?? (orderQuantity * 0.45); // ~0.45kg per pair average if not provided

  // If we have box dimensions, calculate packing
  const packingResult = useMemo(() => {
    if (!selectedBau) return null;

    const items: PackingItem[] = [];

    if (!useOnlyIndividual && masterBoxDims) {
      items.push({
        id: 'master',
        type: 'box',
        nome: masterBoxDims.name || 'Caixa Master',
        L: masterBoxDims.L,
        W: masterBoxDims.W,
        H: masterBoxDims.H,
        maxStack: stackingLevels,
        quantity: Math.ceil(orderQuantity / (masterBoxDims.pairsPerMaster || 12)),
      });
    } else if (individualBoxDims) {
      items.push({
        id: 'individual',
        type: 'box',
        nome: individualBoxDims.name || 'Caixa Individual',
        L: individualBoxDims.L,
        W: individualBoxDims.W,
        H: individualBoxDims.H,
        maxStack: stackingLevels,
        quantity: orderQuantity,
      });
    } else {
      // Use first available box type from database
      const defaultBox = boxTypes[0];
      if (defaultBox) {
        items.push({
          id: 'default',
          type: 'box',
          nome: defaultBox.nome,
          L: defaultBox.comprimento_cm,
          W: defaultBox.largura_cm,
          H: defaultBox.altura_cm,
          maxStack: defaultBox.empilhamento_maximo || stackingLevels,
          quantity: orderQuantity,
        });
      }
    }

     if (items.length === 0) return null;
     return calculatePacking(selectedBau, items, loadingEfficiency / 100);
   }, [selectedBau, boxTypes, individualBoxDims, masterBoxDims, stackingLevels, useOnlyIndividual, orderQuantity, loadingEfficiency]);

  // Vehicle recommendation
  const vehicleRecommendation = useMemo(() => {
    const volume = packingResult ? packingResult.total_volume_m3 : estimatedVolume;
    const adjustedVolume = volume * (1 + safetyMargin / 100);
    const fleet = baus.length > 0 ? baus.map(bauToVehicle) : FALLBACK_FLEET;
    return recommendBestVehicle(adjustedVolume, fleet);
  }, [packingResult, estimatedVolume, safetyMargin, baus]);

  // Optimization suggestions
  const suggestions = useMemo(() => {
    const tips: { title: string; description: string; savings?: string }[] = [];

    if (packingResult && packingResult.ocupacao_total_pct < 60) {
      tips.push({
        title: 'Baixa ocupação do baú',
        description: 'Considere combinar com outro pedido para otimizar o frete.',
        savings: `Até ${(100 - packingResult.ocupacao_total_pct).toFixed(0)}% do espaço disponível`,
      });
    }

    if (!useOnlyIndividual && !masterBoxDims && individualBoxDims) {
      tips.push({
        title: 'Use caixas master',
        description: 'Agrupar caixas individuais em master reduz espaço morto e facilita manuseio.',
        savings: 'Redução estimada de 15-25% no volume',
      });
    }

    if (vehicleRecommendation.status === 'SUCESSO' && vehicleRecommendation.efficiency === 'BAIXA') {
      tips.push({
        title: 'Veículo superdimensionado',
        description: 'O veículo recomendado tem capacidade muito superior ao necessário.',
      });
    }

    return tips;
  }, [packingResult, useOnlyIndividual, masterBoxDims, individualBoxDims, vehicleRecommendation]);

  // Packaging metrics
  const metrics = useMemo(() => {
    const volumeEfficiency = packingResult
      ? Math.min(packingResult.ocupacao_total_pct, 100)
      : 0;
    const costEfficiency = volumeEfficiency; // proxy until real cost model is implemented
    const envScore = volumeEfficiency * 0.8 + (useOnlyIndividual ? 0 : 20); // master boxes = more efficient

    return {
      spaceUtilization: volumeEfficiency,
      costEfficiency: Math.min(costEfficiency, 100),
      environmentalScore: Math.min(envScore / 10, 10),
      handlingScore: useOnlyIndividual ? 6 : 8.5,
    };
  }, [packingResult, useOnlyIndividual]);

  return (
    <div className="space-y-6">
      {/* Config Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Truck className="h-5 w-5 text-primary" />
            Configurações de Transporte
          </CardTitle>
          <CardDescription>
            {orderNumber ? `Pedido ${orderNumber} · ` : ''}{orderQuantity} pares · Categoria: {productCategory.replace(/_/g, ' ')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Bau selection */}
          <div className="space-y-2">
            <Label>Baú do Veículo</Label>
            <Select value={selectedBauId} onValueChange={setSelectedBauId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o baú" />
              </SelectTrigger>
              <SelectContent>
                {baus.map(b => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.nome} ({(b.comprimento_cm / 100).toFixed(2)}m × {(b.largura_cm / 100).toFixed(2)}m × {(b.altura_cm / 100).toFixed(2)}m)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stacking */}
          <div className="space-y-2">
            <Label>Níveis de Empilhamento</Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[stackingLevels]}
                onValueChange={([v]) => setStackingLevels(v)}
                max={10}
                min={1}
                step={1}
                className="flex-1"
              />
              <Badge variant="secondary" className="min-w-[60px] text-center">
                {stackingLevels} {stackingLevels === 1 ? 'nível' : 'níveis'}
              </Badge>
            </div>
          </div>

          {/* Packing mode */}
          <div className="flex items-center justify-between">
            <Label>Apenas caixas individuais</Label>
            <Switch checked={useOnlyIndividual} onCheckedChange={setUseOnlyIndividual} />
          </div>

          {/* Advanced */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4" /> Configurações Avançadas
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label>Eficiência de Carregamento ({loadingEfficiency}%)</Label>
                <Slider
                  value={[loadingEfficiency]}
                  onValueChange={([v]) => setLoadingEfficiency(v)}
                  min={50}
                  max={100}
                  step={1}
                />
                <p className="text-xs text-muted-foreground">Percentual de aproveitamento do espaço do veículo</p>
              </div>
              <div className="space-y-2">
                <Label>Margem de Segurança ({safetyMargin}%)</Label>
                <Slider
                  value={[safetyMargin]}
                  onValueChange={([v]) => setSafetyMargin(v)}
                  min={0}
                  max={20}
                  step={1}
                />
                <p className="text-xs text-muted-foreground">Margem adicional para movimentação da carga</p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* Results */}
      {selectedBau && (
        <TransportResults
          estimatedVolume={estimatedVolume}
          estimatedWeight={estimatedWeight}
          orderQuantity={orderQuantity}
          packingResult={packingResult}
          vehicleRecommendation={vehicleRecommendation}
          suggestions={suggestions}
          metrics={metrics}
          bau={selectedBau}
          destinationCity={destinationCity}
          destinationState={destinationState}
          companies={companies}
        />
      )}
    </div>
  );
}

interface TransportResultsProps {
  estimatedVolume: number;
  estimatedWeight: number;
  orderQuantity: number;
  packingResult: PackingSummary | null;
  vehicleRecommendation: ReturnType<typeof recommendBestVehicle>;
  suggestions: { title: string; description: string; savings?: string }[];
  metrics: { spaceUtilization: number; costEfficiency: number; environmentalScore: number; handlingScore: number };
  bau: Bau;
  destinationCity?: string;
  destinationState?: string;
  companies: any[];
}

function TransportResults({
  estimatedVolume,
  estimatedWeight,
  orderQuantity,
  packingResult,
  vehicleRecommendation,
  suggestions,
  metrics,
  bau,
  destinationCity,
  destinationState,
  companies,
}: TransportResultsProps) {
  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          icon={<Ruler className="h-4 w-4 text-primary" />}
          label="Volume Total"
          value={`${(packingResult?.total_volume_m3 ?? estimatedVolume).toFixed(2)} m³`}
        />
        <MetricCard
          icon={<Weight className="h-4 w-4 text-primary" />}
          label="Peso Estimado"
          value={`${estimatedWeight.toFixed(0)} kg`}
        />
        <MetricCard
          icon={<Box className="h-4 w-4 text-primary" />}
          label="Total de Caixas"
          value={packingResult
            ? String(packingResult.results.reduce((s, r) => s + r.total, 0))
            : String(orderQuantity)}
        />
        <MetricCard
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          label="Ocupação do Baú"
          value={`${packingResult?.ocupacao_total_pct ?? 0}%`}
          highlight={packingResult ? packingResult.ocupacao_total_pct > 80 : false}
        />
      </div>

      {/* Tabs for detailed info */}
      <Tabs defaultValue="packing" className="space-y-3">
        <TabsList className="w-full">
          <TabsTrigger value="packing" className="flex-1 gap-1">
            <Package className="h-3.5 w-3.5" /> Embalagens
          </TabsTrigger>
          <TabsTrigger value="vehicle" className="flex-1 gap-1">
            <Truck className="h-3.5 w-3.5" /> Veículos
          </TabsTrigger>
          <TabsTrigger value="metrics" className="flex-1 gap-1">
            <TrendingUp className="h-3.5 w-3.5" /> Métricas
          </TabsTrigger>
          <TabsTrigger value="carriers" className="flex-1 gap-1">
            <Building2 className="h-3.5 w-3.5" /> Transportadoras
          </TabsTrigger>
        </TabsList>

        <TabsContent value="carriers">
          <CarrierComparison
            companies={companies}
            destinationState={destinationState}
            destinationCity={destinationCity}
            totalWeight={estimatedWeight}
            totalVolume={packingResult?.total_volume_m3 ?? estimatedVolume}
          />
        </TabsContent>

        {/* Packing Breakdown */}
        <TabsContent value="packing">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Breakdown de Embalagens</CardTitle>
            </CardHeader>
            <CardContent>
              {packingResult ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-center">Arranjo</TableHead>
                      <TableHead className="text-center">Qtd</TableHead>
                      <TableHead className="text-right">Volume</TableHead>
                      <TableHead className="text-right">Ocupação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packingResult.results.map(r => (
                      <TableRow key={r.id} className={!r.fits ? 'bg-destructive/10' : ''}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant={r.type === 'box' ? 'default' : 'secondary'} className="text-xs">
                              {r.type === 'box' ? 'CX' : 'IT'}
                            </Badge>
                            <span className="text-sm">{r.nome}</span>
                          </div>
                          {r.warning && <p className="text-xs text-destructive mt-1">{r.warning}</p>}
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm">
                          {r.fits ? `${r.nL}×${r.nW}×${r.nH}` : '—'}
                        </TableCell>
                        <TableCell className="text-center font-bold">{r.total}</TableCell>
                        <TableCell className="text-right text-sm">{r.volume_m3} m³</TableCell>
                        <TableCell className="text-right text-sm">{r.ocupacao_pct}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Sem dados de caixa disponíveis. Cadastre tipos de caixa na aba de Logística.
                </p>
              )}

              {/* Bau summary */}
              {packingResult && (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">Volume do Baú</p>
                    <p className="text-base font-bold">{packingResult.bau_volume_m3} m³</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-xs text-muted-foreground">Volume Ocupado</p>
                    <p className="text-base font-bold">{packingResult.total_volume_m3} m³</p>
                  </div>
                  <div className="p-3 rounded-lg bg-primary/10">
                    <p className="text-xs text-muted-foreground">Residual</p>
                    <p className="text-base font-bold">{packingResult.residual_volume_m3} m³</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Vehicle recommendations */}
        <TabsContent value="vehicle">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Veículos Recomendados</CardTitle>
              <CardDescription>Baseado no volume calculado com margem de segurança</CardDescription>
            </CardHeader>
            <CardContent>
              {vehicleRecommendation.status === 'SUCESSO' && vehicleRecommendation.bestMatch ? (
                <div className="space-y-3">
                  <div className="p-4 rounded-lg border-2 border-primary bg-primary/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Truck className="h-6 w-6 text-primary" />
                        <div>
                          <p className="font-semibold">{vehicleRecommendation.bestMatch.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Capacidade: {vehicleRecommendation.bestMatch.capacityM3} m³
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary">
                          {vehicleRecommendation.occupancy?.toFixed(1)}%
                        </p>
                        <Badge variant={vehicleRecommendation.efficiency === 'ALTA' ? 'default' : 'secondary'}>
                          Eficiência {vehicleRecommendation.efficiency}
                        </Badge>
                      </div>
                    </div>
                    {/* Occupancy bar */}
                    <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${Math.min(vehicleRecommendation.occupancy || 0, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Other options */}
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Outras opções</p>
                  {(baus.length > 0 ? baus.map(bauToVehicle) : FALLBACK_FLEET).filter(v => v.id !== vehicleRecommendation.bestMatch?.id).map(v => {
                    const vol = packingResult?.total_volume_m3 ?? estimatedVolume;
                    const occ = (vol / v.capacityM3) * 100;
                    const fits = occ <= 100;
                    return (
                      <div key={v.id} className={`p-3 rounded-lg border ${fits ? '' : 'opacity-50'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{v.name}</span>
                            <span className="text-xs text-muted-foreground">{v.capacityM3} m³</span>
                          </div>
                          <span className="text-sm font-mono">
                            {fits ? `${occ.toFixed(1)}%` : 'Não comporta'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-destructive font-semibold">Volume excede todos os veículos da frota</p>
                  <p className="text-sm text-muted-foreground mt-1">Considere dividir o pedido em cargas parciais.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Metrics Dashboard */}
        <TabsContent value="metrics">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Métricas de Eficiência</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MetricBar label="Utilização de Espaço" value={metrics.spaceUtilization} icon={<Ruler className="h-4 w-4" />} color="bg-primary" />
                <MetricBar label="Eficiência de Custo" value={metrics.costEfficiency} icon={<TrendingUp className="h-4 w-4" />} color="bg-chart-2" />
                <MetricBar label="Impacto Ambiental" value={metrics.environmentalScore * 10} icon={<Leaf className="h-4 w-4" />} color="bg-chart-4" />
                <MetricBar label="Eficiência de Manuseio" value={metrics.handlingScore * 10} icon={<Package className="h-4 w-4" />} color="bg-chart-5" />
              </div>

              {/* Score geral */}
              <div className="p-4 rounded-lg bg-muted text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Score Geral</p>
                <p className="display text-3xl tabular-nums text-primary">
                  {(
                    metrics.spaceUtilization * 0.3 +
                    metrics.costEfficiency * 0.25 +
                    metrics.environmentalScore * 10 * 0.25 +
                    metrics.handlingScore * 10 * 0.2
                  ).toFixed(0)}
                  <span className="text-lg text-muted-foreground">/100</span>
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Optimization Suggestions */}
      {suggestions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-warning" />
              Sugestões de Otimização
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {suggestions.map((s, i) => (
                <div key={i} className="flex gap-3 p-3 rounded-lg border bg-warning/5 border-warning/20">
                  <Lightbulb className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                    {s.savings && (
                      <Badge variant="outline" className="mt-1 text-xs">
                        {s.savings}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============= HELPER COMPONENTS =============

function MetricCard({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("p-3 rounded-lg border", highlight ? "border-primary bg-primary/5" : "bg-muted/50")}>
      <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
      <p className="text-lg font-bold font-mono">{value}</p>
    </div>
  );
}

function MetricBar({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</span>
        <span className="text-sm font-bold">{value.toFixed(0)}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function CarrierComparison({ companies, destinationState, destinationCity, totalWeight, totalVolume }: {
  companies: any[];
  destinationState?: string;
  destinationCity?: string;
  totalWeight: number;
  totalVolume: number;
}) {
  if (!destinationState) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-20" />
          <p>Selecione um destino para comparar fretes</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {companies.map(company => (
        <CarrierRateCard
          key={company.id}
          company={company}
          state={destinationState}
          city={destinationCity}
          weight={totalWeight}
          volume={totalVolume}
        />
      ))}
      {companies.length === 0 && (
        <p className="text-center text-muted-foreground py-8">Nenhuma transportadora cadastrada</p>
      )}
    </div>
  );
}

function CarrierRateCard({ company, state, city, weight, volume }: {
  company: any;
  state: string;
  city?: string;
  weight: number;
  volume: number;
}) {
  const { data: rates = [] } = useTransportCompanyRates(company.id);
  const rate = rates.find(r => r.estado === state);

  const cost = useMemo(() => {
    if (!rate) return null;
    // Pick the right tariff: capitals charge valor_capital, interior cities
    // charge valor_interior. Falling back to valor_capital when valor_interior
    // isn't configured keeps existing behaviour for half-set carriers.
    const isCapital = isStateCapital(city, state);
    const baseValue = isCapital
      ? rate.valor_capital
      : (rate.valor_interior ?? rate.valor_capital);
    let total = 0;

    if (rate.tipo_valor === 'POR_KG') {
      total = weight * baseValue;
    } else if (rate.tipo_valor === 'POR_M3') {
      total = volume * baseValue;
    } else {
      total = baseValue;
    }

    return Math.max(total, rate.minimo || 0);
  }, [rate, weight, volume, city, state]);

  return (
    <Card className={cn("overflow-hidden transition-all hover:shadow-md", cost && "border-primary/20")}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-sm">{company.nome}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {city ? `${city}/${state}` : state}
              </p>
            </div>
          </div>
          <div className="text-right">
            {cost !== null ? (
              <>
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">Est. Frete</p>
                <p className="text-xl font-black text-primary">R$ {cost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
              </>
            ) : (
              <Badge variant="outline" className="text-[10px]">Sem tarifa para {state}</Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
