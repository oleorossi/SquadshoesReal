import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShoppingCart, BarChart3, Calculator, CalendarDays, AlertTriangle, CalendarClock, Workflow } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

const PurchasePlanningWizard = lazy(() => import('@/components/financial/PurchasePlanningWizard'));
const CostAnalyticsPanel = lazy(() => import('@/components/financial/CostAnalyticsPanel'));
const SaldoFinalTab = lazy(() => import('@/components/financial/SaldoFinalTab'));
const WeeklyPurchasingContent = lazy(() => import('@/components/financial/WeeklyPurchasingContent'));
const MrpUnifiedContent = lazy(() => import('@/components/financial/MrpUnifiedContent'));
const PurchaseTimelineTab = lazy(() => import('@/components/financial/PurchaseTimeline').then(m => ({ default: m.PurchaseTimeline })));
const ProductionScheduleTimeline = lazy(() => import('@/components/financial/ProductionScheduleTimeline'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

export default function PurchasePlanning() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'planning';

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <div className="space-y-5 page-enter">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Planejamento de Compras</h1>
        <p className="text-muted-foreground">Análise de demanda, plano semanal, projeções MRP e analytics de custos — tudo em um só lugar</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList className="inline-flex w-max h-auto flex-wrap gap-1">
            <TabsTrigger value="planning" className="gap-1.5 text-xs">
              <ShoppingCart className="h-3.5 w-3.5" /> Plano de Compras
            </TabsTrigger>
            <TabsTrigger value="weekly" className="gap-1.5 text-xs">
              <CalendarDays className="h-3.5 w-3.5" /> Plano Semanal
            </TabsTrigger>
            <TabsTrigger value="timeline" className="gap-1.5 text-xs">
              <CalendarClock className="h-3.5 w-3.5" /> Projeção de Suprimentos
            </TabsTrigger>
            <TabsTrigger value="schedule" className="gap-1.5 text-xs">
              <Workflow className="h-3.5 w-3.5" /> Cronograma Reverso
            </TabsTrigger>
            <TabsTrigger value="saldo" className="gap-1.5 text-xs">
              <Calculator className="h-3.5 w-3.5" /> Saldo Final
            </TabsTrigger>
            <TabsTrigger value="mrp" className="gap-1.5 text-xs">
              <AlertTriangle className="h-3.5 w-3.5" /> MRP & Alertas
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1.5 text-xs">
              <BarChart3 className="h-3.5 w-3.5" /> Analytics de Custos
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="planning">
          <Suspense fallback={<TabLoader />}>
            <PurchasePlanningWizard />
          </Suspense>
        </TabsContent>

        <TabsContent value="weekly">
          <Suspense fallback={<TabLoader />}>
            <WeeklyPurchasingContent />
          </Suspense>
        </TabsContent>

        <TabsContent value="schedule">
          <Suspense fallback={<TabLoader />}>
            <ProductionScheduleTimeline />
          </Suspense>
        </TabsContent>

        <TabsContent value="saldo">
          <Suspense fallback={<TabLoader />}>
            <SaldoFinalTab />
          </Suspense>
        </TabsContent>

        <TabsContent value="mrp">
          <Suspense fallback={<TabLoader />}>
            <MrpUnifiedContent />
          </Suspense>
        </TabsContent>

        <TabsContent value="analytics">
          <Suspense fallback={<TabLoader />}>
            <CostAnalyticsPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="timeline">
          <Suspense fallback={<TabLoader />}>
            <PurchaseTimelineTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
