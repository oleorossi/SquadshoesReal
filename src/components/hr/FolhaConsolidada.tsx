import { lazy, Suspense } from 'react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Wallet, ChartBar, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';

// Reorganização 2026-06-28: a "Folha do Mês" foi FUNDIDA no "Relatório" — a mesma
// tela já fazia filtro de período + calcular + KPIs + tabela + holerite/espelho por
// funcionário. A aba antiga "Relatório" (relatório de atrasos / calendário) saiu por
// falta de uso. Sobram: Relatório (consolidado, = Payroll) + Adiantamentos.
const Payroll = lazy(() => import('@/pages/Payroll'));
const AdvancesPanel = lazy(() => import('./AdvancesPanel'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

export default function FolhaConsolidada() {
  const [tab, setTab] = usePersistedState<string>('rh-folha-tab', 'relatorio');
  // Estados legados ('folha'/'pre-folha'/'banco-horas') caem no Relatório consolidado.
  const safeTab = tab === 'adiantamentos' ? tab : 'relatorio';

  return (
    <div className="space-y-4">
      <Tabs value={safeTab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'relatorio',     label: 'Relatório',     icon: ChartBar },
          { value: 'adiantamentos', label: 'Adiantamentos', icon: Wallet },
        ]} />

        <Suspense fallback={<TabLoader />}>
          <TabsContent value="relatorio"><Payroll /></TabsContent>
          <TabsContent value="adiantamentos"><AdvancesPanel /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
