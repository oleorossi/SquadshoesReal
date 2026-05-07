import { lazy, Suspense } from 'react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import {
  TrendingUp, AlertTriangle, DollarSign, AlarmClock,
  Activity, Target, Repeat, Loader2,
} from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';

const HeadcountReport = lazy(() => import('@/pages/HeadcountReport'));
const AbsenceReport = lazy(() => import('@/pages/AbsenceReport'));
const CustoTotalReport = lazy(() => import('./reports/CustoTotalReport'));
const HorasExtrasReport = lazy(() => import('./reports/HorasExtrasReport'));
const PrevistasVsTrabalhadasReport = lazy(() => import('./reports/PrevistasVsTrabalhadasReport'));
const ProdutividadeReport = lazy(() => import('./reports/ProdutividadeReport'));
const TurnoverReport = lazy(() => import('./reports/TurnoverReport'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

export default function RelatoriosRH() {
  const [tab, setTab] = usePersistedState<string>('rh-relatorios-tab', 'custo');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Relatórios RH</h2>
        <p className="text-sm text-muted-foreground">
          Custo real, horas extras, produtividade, absenteísmo e evolução do quadro.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'custo',         label: 'Custo Total',           icon: DollarSign },
          { value: 'horas-extras',  label: 'Horas Extras',          icon: AlarmClock },
          { value: 'previstas',     label: 'Previstas × Trabalhadas', icon: Target },
          { value: 'produtividade', label: 'Produtividade',         icon: Activity },
          { value: 'absenteismo',   label: 'Absenteísmo',           icon: AlertTriangle },
          { value: 'headcount',     label: 'Evolução do Quadro',    icon: TrendingUp },
          { value: 'turnover',      label: 'Turnover',              icon: Repeat },
        ]} />

        <Suspense fallback={<TabLoader />}>
          <TabsContent value="custo"><CustoTotalReport /></TabsContent>
          <TabsContent value="horas-extras"><HorasExtrasReport /></TabsContent>
          <TabsContent value="previstas"><PrevistasVsTrabalhadasReport /></TabsContent>
          <TabsContent value="produtividade"><ProdutividadeReport /></TabsContent>
          <TabsContent value="absenteismo"><AbsenceReport /></TabsContent>
          <TabsContent value="headcount"><HeadcountReport /></TabsContent>
          <TabsContent value="turnover"><TurnoverReport /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
