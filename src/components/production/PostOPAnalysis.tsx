import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, differenceInHours, isWithinInterval, startOfDay, endOfDay, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  FileBarChart, Search, TrendingUp, TrendingDown, Minus,
  Clock, DollarSign, AlertTriangle, CheckCircle2, Factory, Layers,
} from "lucide-react";
import { Download, FileText } from "lucide-react";
import { exportCSV, exportPDF } from "@/lib/exportUtils";

interface FinishedOP {
  id: string;
  order_number: string;
  quantity: number;
  planned_start: string | null;
  planned_delivery: string | null;
  created_at: string;
  last_sector_finished_at: string | null;
  standard_cost_per_pair: number | null;
  actual_cost_per_pair: number | null;
  total_production_cost: number | null;
  material_cost: number | null;
  labor_cost: number | null;
  overhead_cost: number | null;
  color: string | null;
  stages: StageData[];
}

interface StageData {
  stage_name: string;
  standard_time_minutes: number | null;
  actual_time_minutes: number | null;
  quantity_total: number | null;
  quantity_processed: number | null;
  defects: string | null;
}

function useFinishedOPs() {
  return useQuery<FinishedOP[]>({
    queryKey: ["post-op-analysis-v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id, order_number, quantity, planned_start, planned_delivery,
          created_at, last_sector_finished_at, standard_cost_per_pair,
          actual_cost_per_pair, total_production_cost, material_cost,
          labor_cost, overhead_cost, color,
          order_stages(stage_name, standard_time_minutes, actual_time_minutes, quantity_total, quantity_processed, defects)
        `)
        .eq("status", "Finalizado")
        .order("last_sector_finished_at", { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []).map(d => ({
        ...d,
        stages: (d.order_stages || []) as StageData[],
      })) as FinishedOP[];
    },
    staleTime: 5 * 60_000,
  });
}

function varianceBadge(planned: number | null, actual: number | null) {
  if (!planned || !actual) return <span className="text-muted-foreground">—</span>;
  const diff = ((actual - planned) / planned) * 100;
  if (Math.abs(diff) < 2) return <Badge variant="outline" className="gap-1"><Minus className="h-3 w-3" />{diff.toFixed(1)}%</Badge>;
  if (diff > 0) return <Badge className="bg-red-500/10 text-red-600 gap-1"><TrendingUp className="h-3 w-3" />+{diff.toFixed(1)}%</Badge>;
  return <Badge className="bg-green-500/10 text-green-600 gap-1"><TrendingDown className="h-3 w-3" />{diff.toFixed(1)}%</Badge>;
}

function fmtBRL(v: number | null) {
  if (v == null || v === 0) return "—";
  return `R$ ${v.toFixed(2)}`;
}

export default function PostOPAnalysis() {
  const { data: ops = [], isLoading } = useFinishedOPs();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "variance" | "leadtime">("date");
  const [dateFrom, setDateFrom] = useState(() => format(subMonths(new Date(), 6), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(() => format(new Date(), "yyyy-MM-dd"));

  // Date-filtered ops (KPIs + table use this)
  const dateFiltered = useMemo(() => {
    return ops.filter(o => {
      const d = o.last_sector_finished_at ? new Date(o.last_sector_finished_at) : new Date(o.created_at);
      return isWithinInterval(d, { start: startOfDay(new Date(dateFrom)), end: endOfDay(new Date(dateTo)) });
    });
  }, [ops, dateFrom, dateTo]);

  // Aggregate KPIs
  const kpis = useMemo(() => {
    const totalPairs = dateFiltered.reduce((s, o) => s + o.quantity, 0);

    // Cost variance
    const withCost = dateFiltered.filter(o => o.standard_cost_per_pair && o.actual_cost_per_pair);
    const avgVariance = withCost.length > 0
      ? withCost.reduce((s, o) => s + ((o.actual_cost_per_pair! - o.standard_cost_per_pair!) / o.standard_cost_per_pair!) * 100, 0) / withCost.length
      : 0;
    const totalStdCost = withCost.reduce((s, o) => s + (o.standard_cost_per_pair! * o.quantity), 0);
    const totalActCost = withCost.reduce((s, o) => s + (o.actual_cost_per_pair! * o.quantity), 0);

    // On-time delivery
    const withTime = dateFiltered.filter(o => o.planned_delivery && o.last_sector_finished_at);
    const onTimeCount = withTime.filter(o => new Date(o.last_sector_finished_at!) <= new Date(o.planned_delivery!)).length;
    const onTimeRate = withTime.length > 0 ? (onTimeCount / withTime.length) * 100 : 0;

    // Average lead time (days)
    const withLeadTime = dateFiltered.filter(o => o.created_at && o.last_sector_finished_at);
    const avgLeadTimeDays = withLeadTime.length > 0
      ? withLeadTime.reduce((s, o) => s + differenceInHours(new Date(o.last_sector_finished_at!), new Date(o.created_at)) / 24, 0) / withLeadTime.length
      : 0;

    // Defect rate (stages with defects / total stages)
    let totalStages = 0, defectStages = 0;
    dateFiltered.forEach(o => {
      o.stages.forEach(st => {
        totalStages++;
        if (st.defects && st.defects.trim()) defectStages++;
      });
    });
    const defectRate = totalStages > 0 ? (defectStages / totalStages) * 100 : 0;

    // Time efficiency (actual vs standard at stage level)
    let totalStd = 0, totalAct = 0;
    dateFiltered.forEach(o => {
      o.stages.forEach(st => {
        if (st.standard_time_minutes && st.actual_time_minutes) {
          totalStd += st.standard_time_minutes;
          totalAct += st.actual_time_minutes;
        }
      });
    });
    const timeEfficiency = totalStd > 0 ? (totalStd / totalAct) * 100 : 0;

    // Material vs Labor split
    const totalMat = dateFiltered.reduce((s, o) => s + (o.material_cost || 0), 0);
    const totalLab = dateFiltered.reduce((s, o) => s + (o.labor_cost || 0), 0);
    const totalOvh = dateFiltered.reduce((s, o) => s + (o.overhead_cost || 0), 0);

    return {
      totalOPs: ops.length,
      totalPairs,
      avgVariance,
      onTimeRate,
      onTimeCount,
      withTimeCount: withTime.length,
      avgLeadTimeDays,
      defectRate,
      timeEfficiency,
      totalStdCost,
      totalActCost,
      totalMat,
      totalLab,
      totalOvh,
      opsWithCost: withCost.length,
    };
  }, [dateFiltered]);

  const filtered = useMemo(() => {
    let result = dateFiltered;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(o => o.order_number.toLowerCase().includes(q) || o.color?.toLowerCase().includes(q));
    }
    // Sort
    if (sortBy === "variance") {
      result = [...result].sort((a, b) => {
        const va = a.standard_cost_per_pair && a.actual_cost_per_pair
          ? Math.abs((a.actual_cost_per_pair - a.standard_cost_per_pair) / a.standard_cost_per_pair) : 0;
        const vb = b.standard_cost_per_pair && b.actual_cost_per_pair
          ? Math.abs((b.actual_cost_per_pair - b.standard_cost_per_pair) / b.standard_cost_per_pair) : 0;
        return vb - va;
      });
    } else if (sortBy === "leadtime") {
      result = [...result].sort((a, b) => {
        const la = a.last_sector_finished_at ? differenceInHours(new Date(a.last_sector_finished_at), new Date(a.created_at)) : 0;
        const lb = b.last_sector_finished_at ? differenceInHours(new Date(b.last_sector_finished_at), new Date(b.created_at)) : 0;
        return lb - la;
      });
    }
    return result;
  }, [dateFiltered, search, sortBy]);

  // Export helpers
  const exportHeaders = ["OP", "Cor", "Qtd", "Prazo", "Conclusão", "Lead Time (d)", "Custo Padrão", "Custo Real", "Variação %", "Material", "MOD"];
  const exportRows = filtered.map(op => {
    const lt = op.last_sector_finished_at ? Math.round(differenceInHours(new Date(op.last_sector_finished_at), new Date(op.created_at)) / 24) : null;
    const variance = op.standard_cost_per_pair && op.actual_cost_per_pair
      ? (((op.actual_cost_per_pair - op.standard_cost_per_pair) / op.standard_cost_per_pair) * 100).toFixed(1)
      : "";
    return [
      op.order_number, op.color || "", String(op.quantity),
      op.planned_delivery ? format(new Date(op.planned_delivery), "dd/MM/yyyy") : "",
      op.last_sector_finished_at ? format(new Date(op.last_sector_finished_at), "dd/MM/yyyy") : "",
      lt !== null ? String(lt) : "",
      op.standard_cost_per_pair?.toFixed(2) || "", op.actual_cost_per_pair?.toFixed(2) || "",
      variance, op.material_cost?.toFixed(2) || "", op.labor_cost?.toFixed(2) || "",
    ];
  });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">Carregando análise...</div>;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileBarChart className="h-5 w-5" /> Análise Pós-OP — Encerramento e Comparativo
          </h2>
          <p className="text-sm text-muted-foreground">
            {kpis.totalOPs} OPs finalizadas · {kpis.totalPairs.toLocaleString("pt-BR")} pares produzidos
          </p>
        </div>

        {/* ─── KPI Row 1: Core metrics ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-md bg-muted/50"><CheckCircle2 className="h-4 w-4 text-green-600" /></div>
                <div>
                  <p className={`text-xl font-bold ${kpis.onTimeRate >= 90 ? "text-green-600" : kpis.onTimeRate >= 70 ? "text-amber-600" : "text-red-600"}`}>
                    {kpis.onTimeRate.toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">Entrega no Prazo ({kpis.onTimeCount}/{kpis.withTimeCount})</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-md bg-muted/50"><DollarSign className="h-4 w-4 text-blue-600" /></div>
                <div>
                  <p className={`text-xl font-bold ${kpis.avgVariance > 5 ? "text-red-600" : kpis.avgVariance < -2 ? "text-green-600" : "text-foreground"}`}>
                    {kpis.avgVariance > 0 ? "+" : ""}{kpis.avgVariance.toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">Variação Custo ({kpis.opsWithCost} OPs)</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-md bg-muted/50"><Clock className="h-4 w-4 text-violet-600" /></div>
                <div>
                  <p className="text-xl font-bold">{kpis.avgLeadTimeDays.toFixed(1)}d</p>
                  <p className="text-[10px] text-muted-foreground">Lead Time Médio</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-md bg-muted/50"><AlertTriangle className="h-4 w-4 text-amber-600" /></div>
                <div>
                  <p className={`text-xl font-bold ${kpis.defectRate > 5 ? "text-red-600" : "text-foreground"}`}>
                    {kpis.defectRate.toFixed(1)}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">Taxa de Defeitos</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── KPI Row 2: Financial breakdown ─── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-md bg-muted/50"><Factory className="h-4 w-4 text-muted-foreground" /></div>
                <div>
                  <p className="text-xl font-bold">
                    {kpis.timeEfficiency > 0 ? `${kpis.timeEfficiency.toFixed(0)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Eficiência Produtiva</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-md bg-muted/50"><Layers className="h-4 w-4 text-muted-foreground" /></div>
                <div>
                  <p className="text-sm font-medium">{fmtBRL(kpis.totalMat)}</p>
                  <p className="text-[10px] text-muted-foreground">Total Material</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-md bg-muted/50"><Layers className="h-4 w-4 text-muted-foreground" /></div>
                <div>
                  <p className="text-sm font-medium">{fmtBRL(kpis.totalLab)}</p>
                  <p className="text-[10px] text-muted-foreground">Total MOD</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <Tooltip>
                <TooltipTrigger>
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-md bg-muted/50"><DollarSign className="h-4 w-4 text-muted-foreground" /></div>
                    <div className="text-left">
                      <p className={`text-sm font-medium ${kpis.totalActCost > kpis.totalStdCost ? "text-red-600" : "text-green-600"}`}>
                        {fmtBRL(kpis.totalActCost - kpis.totalStdCost)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Desvio Absoluto</p>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  <p>Custo Padrão Total: {fmtBRL(kpis.totalStdCost)}</p>
                  <p>Custo Real Total: {fmtBRL(kpis.totalActCost)}</p>
                </TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>
        </div>

        {/* ─── Filters ─── */}
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 w-36 text-xs" />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 w-36 text-xs" />
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Label className="text-xs invisible">Busca</Label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar OP ou cor..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Mais recentes</SelectItem>
              <SelectItem value="variance">Maior variação de custo</SelectItem>
              <SelectItem value="leadtime">Maior lead time</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-1 ml-auto">
            <Button size="sm" variant="outline" onClick={() => exportCSV(exportHeaders, exportRows, `analise_pos_op_${dateFrom}_${dateTo}.csv`)}>
              <Download className="h-3.5 w-3.5 mr-1" />CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportPDF("Análise Pós-OP", exportHeaders, exportRows, "analise_pos_op.pdf")}>
              <FileText className="h-3.5 w-3.5 mr-1" />PDF
            </Button>
          </div>
        </div>

        {/* ─── Detail table ─── */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>OP</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Conclusão</TableHead>
                  <TableHead className="text-right">Lead Time</TableHead>
                  <TableHead className="text-right">Custo Padrão</TableHead>
                  <TableHead className="text-right">Custo Real</TableHead>
                  <TableHead className="text-center">Variação</TableHead>
                  <TableHead className="text-right">Material</TableHead>
                  <TableHead className="text-right">MOD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(op => {
                  const leadTimeHours = op.created_at && op.last_sector_finished_at
                    ? differenceInHours(new Date(op.last_sector_finished_at), new Date(op.created_at))
                    : null;
                  const leadTimeDays = leadTimeHours !== null ? Math.round(leadTimeHours / 24) : null;
                  const onTime = op.planned_delivery && op.last_sector_finished_at
                    ? new Date(op.last_sector_finished_at) <= new Date(op.planned_delivery)
                    : null;
                  const hasDefects = op.stages.some(s => s.defects && s.defects.trim());

                  return (
                    <TableRow key={op.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {op.order_number}
                        {op.color && <span className="text-xs text-muted-foreground ml-1">({op.color})</span>}
                        {hasDefects && (
                          <Tooltip>
                            <TooltipTrigger><AlertTriangle className="h-3 w-3 text-amber-500 ml-1 inline" /></TooltipTrigger>
                            <TooltipContent className="text-xs">
                              {op.stages.filter(s => s.defects?.trim()).map(s => (
                                <div key={s.stage_name}><strong>{s.stage_name}:</strong> {s.defects}</div>
                              ))}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{op.quantity}</TableCell>
                      <TableCell>{op.planned_delivery ? format(new Date(op.planned_delivery), "dd/MM/yy", { locale: ptBR }) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {op.last_sector_finished_at ? format(new Date(op.last_sector_finished_at), "dd/MM/yy", { locale: ptBR }) : "—"}
                        {onTime !== null && (
                          <Badge className={`ml-1 text-[9px] ${onTime ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                            {onTime ? "OK" : "Atraso"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{leadTimeDays !== null ? `${leadTimeDays}d` : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{fmtBRL(op.standard_cost_per_pair)}</TableCell>
                      <TableCell className="text-right font-mono">{fmtBRL(op.actual_cost_per_pair)}</TableCell>
                      <TableCell className="text-center">{varianceBadge(op.standard_cost_per_pair, op.actual_cost_per_pair)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtBRL(op.material_cost)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtBRL(op.labor_cost)}</TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Nenhuma OP finalizada encontrada</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}