import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParams, Link } from "react-router-dom";
import { lazy, Suspense } from "react";
import { CircleNotch as Loader2, SquaresFour as LayoutDashboard, ClipboardText as ClipboardList, Factory, ChartBar as BarChart3, Stack as Boxes, ClockCounterClockwise as History, Waves, FlowArrow as Workflow, Clock } from '@phosphor-icons/react';
import { Gauge, FileText as FileBarChart, Scissors } from '@phosphor-icons/react';
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
const CosturaPlannerPanel = lazy(() => import("@/components/pcp/CosturaPlannerPanel"));


const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

// Single hub for all production sectors — Setores aggregates Corte, Costura,
// Solagem, Aviamento, Montagem and Acabamento internally.
 const tabs = [
   { value: "ondas", label: "Ondas", icon: Waves },
   { value: "planejamento", label: "Planejamento", icon: ClipboardList },
   { value: "cronograma", label: "Cronograma Reverso", icon: Workflow },
  { value: "lead-time", label: "Lead Time", icon: Clock },
   { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
   { value: "setores", label: "Setores", icon: Factory },
  { value: "capacidade", label: "Capacidade", icon: BarChart3 },
  { value: "picking", label: "Picking Semanal", icon: Boxes },
  { value: "auditoria", label: "Auditoria", icon: History },
  { value: "rccp", label: "RCCP", icon: Gauge },
  { value: "pos-op", label: "Análise Pós-OP", icon: FileBarChart },
  { value: "lot-split", label: "Split de Lotes", icon: Scissors },
  { value: "costura-planner", label: "Costura · Planner", icon: Scissors },
];
 const ProductionPlanning = lazy(() => import("./ProductionPlanning"));

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
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-2">
          <TabsList className="inline-flex w-max h-auto gap-1 bg-muted/50 p-1 rounded-lg">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
                {tab.icon && <tab.icon className="h-3.5 w-3.5" />}
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <Suspense fallback={<TabLoader />}>
          <TabsContent value="dashboard"><PCPDashboard /></TabsContent>
          <TabsContent value="lead-time"><LeadTime /></TabsContent>
           <TabsContent value="ondas"><ProductionWavesPage embedded /></TabsContent>
           <TabsContent value="planejamento"><ProductionPlanning /></TabsContent>
          <TabsContent value="cronograma"><ProductionScheduleTimeline /></TabsContent>
           <TabsContent value="setores"><Setores /></TabsContent>
          <TabsContent value="capacidade"><CapacityPlanning /></TabsContent>
          <TabsContent value="picking"><PickingListPage /></TabsContent>
          <TabsContent value="auditoria"><OrderFlowAudit /></TabsContent>
          <TabsContent value="rccp"><RCCPPlanning /></TabsContent>
          <TabsContent value="pos-op"><PostOPAnalysis /></TabsContent>
          <TabsContent value="lot-split"><Suspense fallback={<TabLoader />}><LotSplitPage /></Suspense></TabsContent>
          <TabsContent value="costura-planner"><CosturaPlannerPanel /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
