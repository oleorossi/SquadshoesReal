import { lazy, Suspense } from 'react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { TrendUp as TrendingUp, Warning as AlertTriangle, CurrencyDollar as DollarSign, Alarm as AlarmClock, Pulse as Activity, Target, Repeat, CircleNotch as Loader2, Clock } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';

const HeadcountReport = lazy(() => import('@/pages/HeadcountReport'));
const AbsenceReport = lazy(() => import('@/pages/AbsenceReport'));
const CustoTotalReport = lazy(() => import('./reports/CustoTotalReport'));
const HorasExtrasReport = lazy(() => import('./reports/HorasExtrasReport'));
const PrevistasVsTrabalhadasReport = lazy(() => import('./reports/PrevistasVsTrabalhadasReport'));
const ProdutividadeReport = lazy(() => import('./reports/ProdutividadeReport'));
const TurnoverReport = lazy(() => import('./reports/TurnoverReport'));
// Relatórios consolidados de ponto migraram do Timesheet pra cá (mai/2026).
const ReportsPanel = lazy(() => import('@/components/timeControl/ReportsPanel'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

export default function RelatoriosRH() {
  const [tab, setTab] = usePersistedState<string>('rh-relatorios-tab', 'custo');

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Custo real, horas extras, produtividade, absenteísmo e evolução do quadro.
      </p>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'custo',         label: 'Custo Total',           icon: DollarSign },
          { value: 'horas-extras',  label: 'Horas Extras',          icon: AlarmClock },
          { value: 'previstas',     label: 'Previstas × Trabalhadas', icon: Target },
          { value: 'produtividade', label: 'Produtividade',         icon: Activity },
          { value: 'absenteismo',   label: 'Absenteísmo',           icon: AlertTriangle },
          { value: 'headcount',     label: 'Evolução do Quadro',    icon: TrendingUp },
          { value: 'turnover',      label: 'Turnover',              icon: Repeat },
          { value: 'ponto',         label: 'Ponto (período)',       icon: Clock },
        ]} />

        <Suspense fallback={<TabLoader />}>
          <TabsContent value="custo"><CustoTotalReport /></TabsContent>
          <TabsContent value="horas-extras"><HorasExtrasReport /></TabsContent>
          <TabsContent value="previstas"><PrevistasVsTrabalhadasReport /></TabsContent>
          <TabsContent value="produtividade"><ProdutividadeReport /></TabsContent>
          <TabsContent value="absenteismo"><AbsenceReport /></TabsContent>
          <TabsContent value="headcount"><HeadcountReport /></TabsContent>
          <TabsContent value="turnover"><TurnoverReport /></TabsContent>
          <TabsContent value="ponto"><ReportsPanel /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
