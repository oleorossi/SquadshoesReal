import { lazy, Suspense } from 'react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { TrendUp as TrendingUp, Warning as AlertTriangle, Pulse as Activity, Target, Repeat, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';

const HeadcountReport = lazy(() => import('@/pages/HeadcountReport'));
const AbsenceReport = lazy(() => import('@/pages/AbsenceReport'));
// Removidos: CustoTotalReport e HorasExtrasReport dependiam de payroll_runs/
// benefits_config, removidos junto com a Folha de Pagamento (decisão do usuário:
// sistema não faz cálculo de encargos trabalhistas).
const PrevistasVsTrabalhadasReport = lazy(() => import('./reports/PrevistasVsTrabalhadasReport'));
const ProdutividadeReport = lazy(() => import('./reports/ProdutividadeReport'));
const TurnoverReport = lazy(() => import('./reports/TurnoverReport'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

export default function RelatoriosRH() {
  // Migra tabs antigas removidas pro default novo.
  const [tab, setTab] = usePersistedState<string>('rh-relatorios-tab', 'previstas');
  const safeTab = (tab === 'custo' || tab === 'horas-extras') ? 'previstas' : tab;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Relatórios RH</h2>
        <p className="text-sm text-muted-foreground">
          Produtividade, absenteísmo e evolução do quadro.
        </p>
      </div>

      <Tabs value={safeTab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'previstas',     label: 'Previstas × Trabalhadas', icon: Target },
          { value: 'produtividade', label: 'Produtividade',         icon: Activity },
          { value: 'absenteismo',   label: 'Absenteísmo',           icon: AlertTriangle },
          { value: 'headcount',     label: 'Evolução do Quadro',    icon: TrendingUp },
          { value: 'turnover',      label: 'Turnover',              icon: Repeat },
        ]} />

        <Suspense fallback={<TabLoader />}>
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
