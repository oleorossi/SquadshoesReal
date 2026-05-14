import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { HubTabsList } from '@/components/layout/HubTabs';
import { ShoppingCart, ChartBar as BarChart3, Calculator, CalendarBlank as CalendarDays, Warning as AlertTriangle, CalendarBlank as CalendarClock, FlowArrow as Workflow, Info, TrendUp as TrendingUp } from '@phosphor-icons/react';
import { lazy, Suspense } from 'react';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useSearchParams } from 'react-router-dom';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

const PurchasePlanningWizard = lazy(() => import('@/components/financial/PurchasePlanningWizard'));
const CostAnalyticsPanel = lazy(() => import('@/components/financial/CostAnalyticsPanel'));
const SaldoFinalTab = lazy(() => import('@/components/financial/SaldoFinalTab'));
const WeeklyPurchasingContent = lazy(() => import('@/components/financial/WeeklyPurchasingContent'));
const MrpUnifiedContent = lazy(() => import('@/components/financial/MrpUnifiedContent'));
const PurchaseTimelineTab = lazy(() => import('@/components/financial/PurchaseTimeline').then(m => ({ default: m.PurchaseTimeline })));
const ProductionScheduleTimeline = lazy(() => import('@/components/financial/ProductionScheduleTimeline'));
const PurchaseProjectionContent = lazy(() => import('@/components/financial/PurchaseProjectionContent'));

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
      <EditorialPageHeader
        sectionLabel="SUPRIMENTOS · Planejamento de Compras"
        title="Planejamento de Compras"
        description="Análise de demanda, plano semanal, projeções MRP e analytics de custos — tudo em um só lugar"
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <HubTabsList tabs={[
          { value: 'planning',   label: 'Plano de Compras',        icon: ShoppingCart },
          { value: 'projection', label: 'Projeção de Compras',     icon: TrendingUp },
          { value: 'weekly',     label: 'Plano Semanal',           icon: CalendarDays },
          { value: 'timeline',   label: 'Projeção de Suprimentos', icon: CalendarClock },
          { value: 'schedule',   label: 'Cronograma Reverso',      icon: Workflow },
          { value: 'saldo',      label: 'Saldo Final',             icon: Calculator },
          { value: 'mrp',        label: 'MRP & Alertas',           icon: AlertTriangle },
          { value: 'analytics',  label: 'Analytics de Custos',     icon: BarChart3 },
        ]} />

        {/* Callout pra orientar o usuário sobre qual aba usar quando */}
        <Card className="border-dashed bg-muted/20 mt-3 mb-1">
          <CardContent className="py-2.5 px-4 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <strong>Plano de Compras</strong> = wizard guiado a partir dos PVs ativos ·
              <strong> Projeção de Compras</strong> = histórico estatístico (curva ABC + giro + reorder sugerido) ·
              <strong> Plano Semanal</strong> = consolidado por semana ·
              <strong> Projeção de Suprimentos</strong> = data-limite por material ·
              <strong> Cronograma Reverso</strong> = quando começar produção pra entregar no prazo ·
              <strong> Saldo Final</strong> = posição depois de todas as OCs em aberto ·
              <strong> MRP</strong> = sugestões automáticas + alertas ·
              <strong> Analytics</strong> = histórico de variação de preço.
            </p>
          </CardContent>
        </Card>

        <TabsContent value="planning">
          <Suspense fallback={<TabLoader />}>
            <PurchasePlanningWizard />
          </Suspense>
        </TabsContent>

        <TabsContent value="projection">
          <Suspense fallback={<TabLoader />}>
            <PurchaseProjectionContent />
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
