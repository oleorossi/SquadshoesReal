import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChartBar as BarChart3, Warning as AlertTriangle, CheckCircle as CheckCircle2, Info, Gauge, Funnel as Filter } from '@phosphor-icons/react';
import { Button } from "@/components/ui/button";
import { useHolidays } from "@/hooks/useTimesheet";

// Sector keys mapped to v_capacity_driven_lead_times columns
const SECTORS = [
  { key: "cutting", label: "Corte", capacityCol: "cutting_capacity_per_day" },
  { key: "forracao", label: "Forração", capacityCol: "forracao_capacity_per_day" },
  { key: "silk", label: "Silk", capacityCol: "silk_capacity_per_day" },
  { key: "gluing", label: "Colagem", capacityCol: "gluing_capacity_per_day" },
  { key: "assembly", label: "Montagem", capacityCol: "assembly_capacity_per_day" },
  { key: "finishing", label: "Acabamento", capacityCol: "finishing_capacity_per_day" },
] as const;

interface CapacityRow {
  shoe_category: string;
  cutting_capacity_per_day: number;
  forracao_capacity_per_day: number;
  silk_capacity_per_day: number;
  gluing_capacity_per_day: number;
  assembly_capacity_per_day: number;
  finishing_capacity_per_day: number;
}

interface OrderDemand {
  quantity: number;
  planned_delivery: string;
  shoe_category: string | null;
}

// Conta dias úteis em um intervalo (segunda-sexta) descontando feriados.
// Substitui o WORK_DAYS_PER_MONTH=22 fixo, que erra ~5% em meses com feriados
// (fevereiro, abril, maio, novembro, dezembro). Holidays vem da tabela
// `holidays` (seed federal 2024-2030, customizável via UI).
function countBusinessDays(start: Date, end: Date, holidaySet: Set<string>): number {
  const days = eachDayOfInterval({ start, end });
  return days.filter(d => {
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) return false;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return !holidaySet.has(iso);
  }).length;
}

function useRCCPData() {
  // Real capacity per shoe_category from the view
  const capacities = useQuery<CapacityRow[]>({
    queryKey: ["rccp-capacities-v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_capacity_driven_lead_times" as any)
        .select("shoe_category, cutting_capacity_per_day, forracao_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day");
      if (error) throw error;
      return (data ?? []) as unknown as CapacityRow[];
    },
    staleTime: 5 * 60_000,
  });

  // Orders with shoe_category via product_references
  const orders = useQuery<OrderDemand[]>({
    queryKey: ["rccp-orders-v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("quantity, planned_delivery, reference_id")
        .in("status", ["Reservado", "Em Produção"])
        .not("planned_delivery", "is", null);
      if (error) throw error;

      // Fetch shoe_category for each reference
      const refIds = [...new Set((data || []).map(o => o.reference_id).filter(Boolean))];
      let refMap: Record<string, string> = {};
      if (refIds.length > 0) {
        const { data: refs } = await supabase
          .from("product_references")
          .select("id, shoe_category")
          .in("id", refIds);
        if (refs) refMap = Object.fromEntries(refs.map(r => [r.id, r.shoe_category || "generico"]));
      }

      return (data || []).map(o => ({
        quantity: o.quantity,
        planned_delivery: o.planned_delivery!,
        shoe_category: refMap[o.reference_id] || "generico",
      }));
    },
    staleTime: 5 * 60_000,
  });

  return {
    capacities: capacities.data || [],
    orders: orders.data || [],
    isLoading: capacities.isLoading || orders.isLoading,
  };
}

// Compute weighted average capacity across all shoe categories (weighted by demand share)
function getWeightedCapacity(
  capacities: CapacityRow[],
  demandByCat: Record<string, number>,
  sectorCol: string,
): number {
  const totalDemand = Object.values(demandByCat).reduce((s, v) => s + v, 0);
  if (totalDemand === 0 || capacities.length === 0) {
    // Fallback: simple average
    const avg = capacities.reduce((s, c) => s + ((c as any)[sectorCol] || 0), 0) / Math.max(capacities.length, 1);
    return avg;
  }
  let weighted = 0;
  for (const cap of capacities) {
    const catDemand = demandByCat[cap.shoe_category] || 0;
    const share = catDemand / totalDemand;
    weighted += ((cap as any)[sectorCol] || 0) * share;
  }
  return weighted;
}

export default function RCCPPlanning() {
  const { capacities, orders, isLoading } = useRCCPData();
  const { data: holidays = [] } = useHolidays();
  const holidaySet = useMemo(
    () => new Set(holidays.map(h => h.holiday_date)),
    [holidays],
  );
  const [horizonMonths, setHorizonMonths] = useState(6);
  const [visibleSectors, setVisibleSectors] = useState<Set<string>>(new Set(SECTORS.map(s => s.key)));

  const toggleSector = (key: string) => {
    setVisibleSectors(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // Keep at least 1
      } else {
        next.add(key);
      }
      return next;
    });
  };
  const filteredSectors = SECTORS.filter(s => visibleSectors.has(s.key));

  // Build month windows com cálculo de dias úteis reais (descontando feriados)
  const months = useMemo(() => {
    const result = [];
    for (let i = 0; i < horizonMonths; i++) {
      const m = addMonths(startOfMonth(new Date()), i);
      const start = m;
      const end = endOfMonth(m);
      result.push({
        start,
        end,
        label: format(m, "MMM/yy", { locale: ptBR }),
        businessDays: countBusinessDays(start, end, holidaySet),
      });
    }
    return result;
  }, [horizonMonths, holidaySet]);

  // Demand aggregated per month + per category (for weighted capacity)
  const monthlyData = useMemo(() => {
    return months.map(m => {
      const monthOrders = orders.filter(o => {
        const d = new Date(o.planned_delivery);
        return d >= m.start && d <= m.end;
      });
      const totalDemand = monthOrders.reduce((s, o) => s + (o.quantity || 0), 0);

      // Demand by category for weighting
      const demandByCat: Record<string, number> = {};
      monthOrders.forEach(o => {
        const cat = o.shoe_category || "generico";
        demandByCat[cat] = (demandByCat[cat] || 0) + (o.quantity || 0);
      });

      return { ...m, totalDemand, demandByCat };
    });
  }, [months, orders]);

  // Global totals for summary
  const globalSummary = useMemo(() => {
    const totalDemand = monthlyData.reduce((s, m) => s + m.totalDemand, 0);
    const bottlenecks: { sector: string; month: string; pct: number }[] = [];

    for (const sector of SECTORS) {
      for (const m of monthlyData) {
        const cap = getWeightedCapacity(capacities, m.demandByCat, sector.capacityCol) * m.businessDays;
        if (cap > 0 && (m.totalDemand / cap) > 1) {
          bottlenecks.push({ sector: sector.label, month: m.label, pct: (m.totalDemand / cap) * 100 });
        }
      }
    }
    bottlenecks.sort((a, b) => b.pct - a.pct);

    return { totalDemand, bottleneckCount: bottlenecks.length, topBottleneck: bottlenecks[0] || null };
  }, [monthlyData, capacities]);

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Carregando RCCP...</div>;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Gauge className="h-5 w-5" /> RCCP — Planejamento Rough-Cut de Capacidade
            </h2>
            <p className="text-sm text-muted-foreground">
              Capacidade ponderada por tipo de calçado × demanda planejada. Dias úteis variam por mês (descontando sáb/dom + feriados).
            </p>
          </div>
          <Select value={String(horizonMonths)} onValueChange={v => setHorizonMonths(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 meses</SelectItem>
              <SelectItem value="6">6 meses</SelectItem>
              <SelectItem value="9">9 meses</SelectItem>
              <SelectItem value="12">12 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Sector filter chips */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground mr-1">Setores:</span>
          {SECTORS.map(s => (
            <Button
              key={s.key}
              size="sm"
              variant={visibleSectors.has(s.key) ? "default" : "outline"}
              className="h-6 text-xs px-2"
              onClick={() => toggleSector(s.key)}
            >
              {s.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs px-2"
            onClick={() => setVisibleSectors(new Set(SECTORS.map(s => s.key)))}
          >
            Todos
          </Button>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <p className="display text-2xl tabular-nums">{globalSummary.totalDemand.toLocaleString("pt-BR")}</p>
            <p className="text-xs text-muted-foreground">Demanda Total (pares)</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className="display text-2xl tabular-nums">{capacities.length}</p>
            <p className="text-xs text-muted-foreground">Categorias de Calçado</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <p className={`display text-2xl tabular-nums ${globalSummary.bottleneckCount > 0 ? "text-red-600" : "text-green-600"}`}>
              {globalSummary.bottleneckCount}
            </p>
            <p className="text-xs text-muted-foreground">Gargalos Detectados</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            {globalSummary.topBottleneck ? (
              <>
                <p className="text-lg font-bold text-red-600">
                  {globalSummary.topBottleneck.sector} — {globalSummary.topBottleneck.month}
                </p>
                <p className="text-xs text-muted-foreground">
                  Pior gargalo ({globalSummary.topBottleneck.pct.toFixed(0)}%)
                </p>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-6 w-6 mx-auto text-green-600" />
                <p className="text-xs text-muted-foreground mt-1">Sem gargalos</p>
              </>
            )}
          </CardContent></Card>
        </div>

        {/* Per-sector capacity bars */}
        {filteredSectors.map(sector => (
          <Card key={sector.key}>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                {sector.label}
                <Tooltip>
                  <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    <p className="font-medium mb-1">Capacidade por tipo de calçado:</p>
                    {capacities.map(c => (
                      <div key={c.shoe_category} className="flex justify-between gap-3">
                        <span className="capitalize">{c.shoe_category.replace(/_/g, " ")}</span>
                        <span className="font-mono">{(c as any)[sector.capacityCol]}/dia</span>
                      </div>
                    ))}
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-3 px-4">
              <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${Math.min(horizonMonths, 12)}, 1fr)` }}>
                {monthlyData.map(m => {
                  const dailyCap = getWeightedCapacity(capacities, m.demandByCat, sector.capacityCol);
                  const monthlyCap = dailyCap * m.businessDays;
                  const utilization = monthlyCap > 0 ? (m.totalDemand / monthlyCap) * 100 : 0;
                  const isOver = utilization > 100;
                  const isHigh = utilization > 80;

                  return (
                    <Tooltip key={m.label}>
                      <TooltipTrigger asChild>
                        <div className="text-center space-y-1 cursor-default">
                          <p className="text-xs font-medium uppercase">{m.label}</p>
                          <div className="h-20 bg-muted/30 rounded relative overflow-hidden">
                            <div
                              className={`absolute bottom-0 w-full rounded transition-all ${
                                isOver ? "bg-red-500/60" : isHigh ? "bg-amber-500/50" : "bg-green-500/40"
                              }`}
                              style={{ height: `${Math.min(utilization, 100)}%` }}
                            />
                            {isOver && (
                              <div
                                className="absolute top-0 left-0 right-0 flex items-center justify-center"
                                style={{ height: `${Math.min(100 - (100 / utilization) * 100, 100)}%` }}
                              >
                                <AlertTriangle className="h-3 w-3 text-red-500" />
                              </div>
                            )}
                          </div>
                          <p className="text-xs font-mono">{m.totalDemand}</p>
                          <Badge
                            variant="outline"
                            className={`text-xs px-1 ${
                              isOver ? "border-red-500 text-red-600" : isHigh ? "border-amber-500 text-amber-600" : "border-green-500 text-green-600"
                            }`}
                          >
                            {utilization.toFixed(0)}%
                          </Badge>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        <p>Demanda: <strong>{m.totalDemand.toLocaleString("pt-BR")}</strong> pares</p>
                        <p>Capacidade: <strong>{Math.round(monthlyCap).toLocaleString("pt-BR")}</strong> pares/mês</p>
                        <p>Diária ponderada: <strong>{Math.round(dailyCap)}</strong> pares/dia</p>
                        {isOver && <p className="text-red-600 font-medium mt-1">⚠ Excede em {(utilization - 100).toFixed(0)}%</p>}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Capacity detail table by shoe category */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Capacidade Diária por Tipo de Calçado (pares/dia)</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium">Categoria</th>
                  {SECTORS.map(s => (
                    <th key={s.key} className="text-center py-2 px-2 font-medium">{s.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capacities.map(c => (
                  <tr key={c.shoe_category} className="border-b border-border/50">
                    <td className="py-1.5 px-3 capitalize font-medium">{c.shoe_category.replace(/_/g, " ")}</td>
                    {SECTORS.map(s => (
                      <td key={s.key} className="text-center py-1.5 px-2 font-mono">
                        {(c as any)[s.capacityCol]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}