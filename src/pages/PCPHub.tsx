import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSearchParams, Link } from "react-router-dom";
import { lazy, Suspense, Fragment } from "react";
import { cn } from "@/lib/utils";
import { CircleNotch as Loader2, SquaresFour as LayoutDashboard, ClipboardText as ClipboardList, Factory, ChartBar as BarChart3, Stack as Boxes, ClockCounterClockwise as History, Waves, FlowArrow as Workflow, Clock } from '@phosphor-icons/react';
import { Gauge, FileText as FileBarChart, Scissors, Warning as AlertTriangle } from '@phosphor-icons/react';
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


const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

// Single hub for all production sectors — Setores aggregates Corte, Costura,
// Solagem, Aviamento, Montagem and Acabamento internally.
 const tabs: { value: string; label: string; icon: any; description: string }[] = [
   { value: "ondas", label: "Ondas", icon: Waves, description: "Agrupa as ordens em ondas de produção pra disparar a fábrica em lotes." },
   { value: "planejamento", label: "Planejamento", icon: ClipboardList, description: "Distribui a carga de trabalho prevista entre os setores." },
   { value: "cronograma", label: "Cronograma Reverso", icon: Workflow, description: "Calcula as datas de início de cada setor a partir do prazo de entrega (de trás pra frente)." },
  { value: "lead-time", label: "Lead Time", icon: Clock, description: "Tempo total de atravessamento da fábrica por produto e por setor." },
   { value: "dashboard", label: "Dashboard", icon: LayoutDashboard, description: "Indicadores gerais do PCP num relance." },
   { value: "setores", label: "Setores", icon: Factory, description: "Acompanhamento setor a setor (Corte, Costura, Solagem, Montagem...)." },
  { value: "gargalo-diario", label: "Gargalo Diário", icon: AlertTriangle, description: "Onde está apertando hoje: planejado vs. realizado do dia." },
  { value: "gargalo-semanal", label: "Gargalo Semanal", icon: AlertTriangle, description: "Capacidade vs. demanda por setor ao longo da semana." },
  { value: "capacidade", label: "Capacidade", icon: BarChart3, description: "Capacidade instalada x ocupação de cada setor." },
  { value: "picking", label: "Picking Semanal", icon: Boxes, description: "Separação semanal dos materiais para as ordens da semana." },
  { value: "auditoria", label: "Auditoria", icon: History, description: "Histórico de mudanças no fluxo de produção." },
  { value: "rccp", label: "RCCP", icon: Gauge, description: "Rough-Cut Capacity Planning: checagem grosseira de capacidade vs. plano de produção." },
  { value: "pos-op", label: "Análise Pós-OP", icon: FileBarChart, description: "Análise de desempenho depois que as OPs fecham." },
  { value: "lot-split", label: "Split de Lotes", icon: Scissors, description: "Divide um lote grande em sublotes pra paralelizar os setores." },
];
 const ProductionPlanning = lazy(() => import("./ProductionPlanning"));

// Menu lateral do PCP — agrupa as abas em seções (em vez de 1 lista corrida de 13).
const TAB_BY_VALUE = Object.fromEntries(tabs.map((t) => [t.value, t]));
const TAB_GROUPS: { label: string; items: string[] }[] = [
  { label: "Planejamento",   items: ["ondas", "planejamento", "cronograma", "lead-time", "capacidade", "rccp"] },
  { label: "Chão de Fábrica", items: ["setores", "gargalo-diario", "gargalo-semanal", "picking", "lot-split"] },
  { label: "Análise",        items: ["dashboard", "auditoria", "pos-op"] },
];

// Backward-compat: legacy URLs like ?tab=corte should land on the consolidated Setores tab
const LEGACY_SECTOR_TABS = new Set(['corte', 'costura', 'silk', 'colagem', 'montagem', 'acabamento', 'expedicao']);

export default function PCPHub() {
  const [searchParams, setSearchParams] = useSearchParams();
   const rawTab = searchParams.get("tab") || "ondas";
  const activeTab = LEGACY_SECTOR_TABS.has(rawTab) ? "setores" : rawTab;

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <div className="space-y-5 page-enter editorial-stagger">
      <EditorialPageHeader
        sectionLabel="PCP · CENTRAL"
        title="Planejamento"
        description="Planejamento, controle e produção da fábrica"
      />
      {/* Atalhos pra visualizações de produção que não estão no sidebar (Fluxo/Live/Timeline/etc).
          Stripe discreto pra discoverability — só aparece se houver rotas no grupo. */}
      {getSecondaryRoutesForGroup('Produção').length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 -mt-2 mb-1 text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wider text-xs text-muted-foreground/70">Visualizações</span>
          {getSecondaryRoutesForGroup('Produção').map((r) => (
            <Link
              key={r.path}
              to={r.path}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              <r.icon className="h-3 w-3" />
              <span>{r.name}</span>
            </Link>
          ))}
        </div>
      )}
      <Tabs value={activeTab} onValueChange={handleTabChange} orientation="vertical">
        <div className="flex flex-col md:flex-row md:gap-6">
          {/* Menu lateral (desktop) / faixa rolável (mobile) */}
          <div className="md:w-56 md:shrink-0 -mx-4 px-4 overflow-x-auto pb-2 md:mx-0 md:px-0 md:overflow-visible md:pb-0">
            <TabsList className="inline-flex w-max h-auto gap-1 bg-muted/50 p-1 rounded-lg md:flex md:flex-col md:w-full md:items-stretch md:gap-0.5 md:bg-transparent md:p-0 md:sticky md:top-4">
              {TAB_GROUPS.map((group) => (
                <Fragment key={group.label}>
                  <div className="hidden md:block section-label px-2 pt-3 pb-1 first:pt-1">
                    {group.label}
                  </div>
                  {group.items.map((value) => {
                    const tab = TAB_BY_VALUE[value];
                    if (!tab) return null;
                    return (
                      <Tooltip key={value} delayDuration={350}>
                        <TooltipTrigger asChild>
                          <TabsTrigger
                            value={value}
                            className={cn(
                              "text-xs whitespace-nowrap gap-1.5 px-3 py-1.5 rounded-md",
                              "data-[state=active]:bg-background data-[state=active]:shadow-sm",
                              "md:w-full md:justify-start md:py-2 md:gap-2.5",
                            )}
                          >
                            {tab.icon && <tab.icon className="h-3.5 w-3.5 shrink-0" />}
                            {tab.label}
                            {value === "gargalo-diario" && (
                              <span className="md:ml-auto text-[9px] font-bold uppercase tracking-wide leading-none rounded px-1 py-0.5 bg-primary/15 text-primary">
                                novo
                              </span>
                            )}
                          </TabsTrigger>
                        </TooltipTrigger>
                        {(tab as any).description && (
                          <TooltipContent side="right" sideOffset={8} className="max-w-[230px] text-xs">
                            {(tab as any).description}
                          </TooltipContent>
                        )}
                      </Tooltip>
                    );
                  })}
                </Fragment>
              ))}
            </TabsList>
          </div>

          {/* Conteúdo da aba ativa */}
          <div className="flex-1 min-w-0 mt-4 md:mt-0">
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
              <TabsContent value="auditoria" className="mt-0"><OrderFlowAudit /></TabsContent>
              <TabsContent value="rccp" className="mt-0"><RCCPPlanning /></TabsContent>
              <TabsContent value="pos-op" className="mt-0"><PostOPAnalysis /></TabsContent>
              <TabsContent value="lot-split" className="mt-0"><Suspense fallback={<TabLoader />}><LotSplitPage /></Suspense></TabsContent>
            </Suspense>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
