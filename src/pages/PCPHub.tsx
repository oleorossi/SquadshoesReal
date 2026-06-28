import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSearchParams, Link } from "react-router-dom";
import { lazy, Suspense, useState } from "react";
import { cn } from "@/lib/utils";
import { CircleNotch as Loader2, SquaresFour as LayoutDashboard, ClipboardText as ClipboardList, Factory, ChartBar as BarChart3, Stack as Boxes, ClockCounterClockwise as History, Waves, FlowArrow as Workflow, Clock } from '@phosphor-icons/react';
import { Gauge, FileText as FileBarChart, Scissors, Warning as AlertTriangle, Kanban } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { getSecondaryRoutesForGroup } from '@/data/navigation';

const Orders = lazy(() => import("./Orders"));
const ProductionScheduleTimeline = lazy(() => import("@/components/financial/ProductionScheduleTimeline").then(m => ({ default: m.ProductionScheduleTimeline })));
const Setores = lazy(() => import("./Setores"));
const CapacityPlanning = lazy(() => import("./CapacityPlanning"));
const PCPDashboard = lazy(() => import("./PCPDashboard"));
const PickingListPage = lazy(() => import("./PickingListPage"));
const OrderFlowAudit = lazy(() => import("./OrderFlowAudit"));
const ProductionWavesPage = lazy(() => import("./ProductionWavesPage"));
const LeadTime = lazy(() => import("./LeadTime"));
const RCCPPlanning = lazy(() => import("@/components/production/RCCPPlanning"));
const PostOPAnalysis = lazy(() => import("@/components/production/PostOPAnalysis"));
const LotSplitPage = lazy(() => import("./LotSplitPage"));
const SectorDailyView = lazy(() => import("./SectorDailyView"));
const BottlenecksPage = lazy(() => import("./Bottlenecks"));
const ProductionPlanning = lazy(() => import("./ProductionPlanning"));
// Quadro de Produção (fusão 2026-06-28): os 4 visuais do MESMO dado (order_stages)
// viram MODOS de uma só tela, em vez de 4 rotas separadas na stripe.
const ProductionFlow = lazy(() => import("./ProductionFlow"));
const ProductionLive = lazy(() => import("./ProductionLive"));
const ProductionTimeline = lazy(() => import("./ProductionTimeline"));
const SectorAggregatedView = lazy(() => import("./SectorAggregatedView"));

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

// Rotas da stripe antiga que viraram MODOS do Quadro de Produção (não duplicar
// como link externo — continuam acessíveis por URL pra deep-link).
const FUSED_VIEW_PATHS = new Set([
  '/producao/fluxo', '/producao/live', '/producao/timeline', '/producao/visao-agregada',
]);

// "Quadro de Produção" — 1 tela, 4 modos do mesmo dado (order_stages). Substitui
// as 4 rotas separadas (Fluxo/Live/Timeline/Visão Agregada) que poluíam a stripe.
const QUADRO_MODES: { key: string; label: string }[] = [
  { key: 'matriz', label: 'Matriz' },
  { key: 'cartoes', label: 'Cartões' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'lote', label: 'Lote agregado' },
];
function QuadroProducao() {
  const [mode, setMode] = useState('matriz');
  return (
    <div className="space-y-3">
      <div className="inline-flex h-8 items-center gap-1 rounded-lg bg-muted/50 p-1">
        {QUADRO_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            className={cn(
              "h-6 rounded px-3 text-xs font-medium transition-colors",
              mode === m.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <Suspense fallback={<TabLoader />}>
        {mode === 'matriz' && <ProductionFlow embedded />}
        {mode === 'cartoes' && <ProductionLive embedded />}
        {mode === 'timeline' && <ProductionTimeline embedded />}
        {mode === 'lote' && <SectorAggregatedView embedded />}
      </Suspense>
    </div>
  );
}

// Single hub for all production sectors — Setores aggregates Corte, Costura,
// Solagem, Aviamento, Montagem and Acabamento internally.
const tabs: { value: string; label: string; icon: any; description: string }[] = [
  { value: "ondas", label: "Ondas", icon: Waves, description: "Agrupa as ordens em ondas de produção pra disparar a fábrica em lotes." },
  { value: "planejamento", label: "Planejamento", icon: ClipboardList, description: "Distribui a carga de trabalho prevista entre os setores." },
  { value: "cronograma", label: "Cronograma Reverso", icon: Workflow, description: "Calcula as datas de início de cada setor a partir do prazo de entrega (de trás pra frente)." },
  { value: "lead-time", label: "Lead Time", icon: Clock, description: "Tempo total de atravessamento da fábrica por produto e por setor." },
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard, description: "Indicadores gerais do PCP num relance." },
  { value: "quadro", label: "Quadro de Produção", icon: Kanban, description: "Onde está cada OP agora — alterne entre Matriz, Cartões, Timeline e Lote agregado (mesma fonte, 4 visões)." },
  { value: "setores", label: "Setores", icon: Factory, description: "Acompanhamento setor a setor (Corte, Costura, Solagem, Montagem...)." },
  { value: "gargalo-diario", label: "Gargalo Diário", icon: AlertTriangle, description: "Onde está apertando hoje: planejado vs. realizado do dia." },
  { value: "gargalo-semanal", label: "Gargalo Semanal", icon: AlertTriangle, description: "Capacidade vs. demanda por setor ao longo da semana." },
  { value: "capacidade", label: "Capacidade", icon: BarChart3, description: "Capacidade instalada x ocupação de cada setor." },
  { value: "picking", label: "Separação Semanal", icon: Boxes, description: "Separação semanal dos materiais para as ordens da semana." },
  { value: "auditoria", label: "Auditoria de Fluxo", icon: History, description: "Histórico de mudanças no fluxo de produção." },
  { value: "rccp", label: "RCCP", icon: Gauge, description: "Rough-Cut Capacity Planning: checagem grosseira de capacidade vs. plano de produção." },
  { value: "pos-op", label: "Análise Pós-OP", icon: FileBarChart, description: "Análise de desempenho depois que as OPs fecham." },
  { value: "lot-split", label: "Split de Lotes", icon: Scissors, description: "Divide um lote grande em sublotes pra paralelizar os setores." },
];
const TAB_BY_VALUE = Object.fromEntries(tabs.map((t) => [t.value, t]));

// Auditoria 2026-06-28: de 14 abas (sidebar vertical) + 9 rotas (stripe
// "Visualizações" flutuante) = 23 destinos em 2 trilhos empilhados, pra 1 TRILHO
// de 3 SEGMENTOS (padrão MES: Planejar / Produzir / Analisar). Os "Quadros" de
// produção (rotas externas) entram contextualmente no segmento Produzir, não mais
// flutuando acima de tudo. "pos-op" sai do menu (KPIs zerados — sem apontamento de
// tempo; rota segue acessível por URL). RCCP fica em Planejar até ser fundido em
// Capacidade (passo futuro — CapacityPlanning está em edição por outra sessão).
const SEGMENTS: { key: string; label: string; items: string[] }[] = [
  { key: "planejar", label: "Planejar", items: ["ondas", "planejamento", "cronograma", "capacidade", "rccp", "lead-time"] },
  { key: "produzir", label: "Produzir", items: ["setores", "gargalo-diario", "gargalo-semanal", "picking", "lot-split"] },
  { key: "analisar", label: "Analisar", items: ["dashboard", "auditoria"] },
];

// Backward-compat: legacy URLs like ?tab=corte should land on the consolidated Setores tab
const LEGACY_SECTOR_TABS = new Set(['corte', 'costura', 'silk', 'colagem', 'montagem', 'acabamento', 'expedicao']);

export default function PCPHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab") || "ondas";
  const activeTab = LEGACY_SECTOR_TABS.has(rawTab) ? "setores" : rawTab;
  const activeSegment = SEGMENTS.find((s) => s.items.includes(activeTab)) ?? SEGMENTS[0];

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  const prodViews = getSecondaryRoutesForGroup('Produção');

  return (
    <div className="space-y-5 page-enter editorial-stagger">
      <EditorialPageHeader
        sectionLabel="PCP · CENTRAL"
        title="Planejamento"
        description="Planejamento, controle e produção da fábrica"
      />

      {/* Trilho único: 3 segmentos (Planejar / Produzir / Analisar) */}
      <div className="inline-flex h-9 items-center gap-1 rounded-lg bg-muted/50 p-1">
        {SEGMENTS.map((seg) => (
          <button
            key={seg.key}
            type="button"
            onClick={() => handleTabChange(seg.items[0])}
            className={cn(
              "h-7 rounded-md px-4 text-sm font-medium transition-colors",
              activeSegment.key === seg.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {seg.label}
          </button>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        {/* Sub-navegação do segmento ativo */}
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
          {activeSegment.items.map((value) => {
            const tab = TAB_BY_VALUE[value];
            if (!tab) return null;
            const isActive = activeTab === value;
            return (
              <Tooltip key={value} delayDuration={350}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleTabChange(value)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    {tab.icon && <tab.icon className="h-3.5 w-3.5 shrink-0" />}
                    {tab.label}
                    {value === "gargalo-diario" && (
                      <span className="ml-0.5 rounded bg-primary/15 px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-primary">
                        novo
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                {tab.description && (
                  <TooltipContent side="bottom" sideOffset={8} className="max-w-[230px] text-xs">
                    {tab.description}
                  </TooltipContent>
                )}
              </Tooltip>
            );
          })}

          {/* Quadros de produção (Fluxo / Live / Timeline / etc.) — contextuais no
              segmento Produzir, em vez de uma stripe flutuante acima de tudo. */}
          {activeSegment.key === "produzir" && prodViews.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Quadros</span>
              {prodViews.map((r) => (
                <Link
                  key={r.path}
                  to={r.path}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <r.icon className="h-3 w-3" />
                  <span>{r.name}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Conteúdo da aba ativa */}
        <div className="mt-4 min-w-0">
          <Suspense fallback={<TabLoader />}>
            <TabsContent value="dashboard" className="mt-0"><PCPDashboard /></TabsContent>
            <TabsContent value="lead-time" className="mt-0"><LeadTime /></TabsContent>
            <TabsContent value="ondas" className="mt-0"><ProductionWavesPage embedded /></TabsContent>
            <TabsContent value="planejamento" className="mt-0"><ProductionPlanning /></TabsContent>
            <TabsContent value="cronograma" className="mt-0"><ProductionScheduleTimeline /></TabsContent>
            <TabsContent value="setores" className="mt-0"><Setores /></TabsContent>
            <TabsContent value="gargalo-diario" className="mt-0"><SectorDailyView /></TabsContent>
            <TabsContent value="gargalo-semanal" className="mt-0"><BottlenecksPage /></TabsContent>
            <TabsContent value="capacidade" className="mt-0"><CapacityPlanning /></TabsContent>
            <TabsContent value="picking" className="mt-0"><PickingListPage /></TabsContent>
            <TabsContent value="auditoria" className="mt-0"><OrderFlowAudit embedded /></TabsContent>
            <TabsContent value="rccp" className="mt-0"><RCCPPlanning /></TabsContent>
            <TabsContent value="pos-op" className="mt-0"><PostOPAnalysis /></TabsContent>
            <TabsContent value="lot-split" className="mt-0"><LotSplitPage /></TabsContent>
          </Suspense>
        </div>
      </Tabs>
    </div>
  );
}
