import { lazy, Suspense } from 'react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { CurrencyDollar as DollarSign, Wallet, ChartBar, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';

// Refocus 2026-06-01: folha por hora trabalhada. Pré-folha (HE/DSR/INSS/VR) e
// Banco de Horas foram aposentados — sobra a folha do mês + adiantamentos
// (único desconto).
const Payroll = lazy(() => import('@/pages/Payroll'));
const AdvancesPanel = lazy(() => import('./AdvancesPanel'));
const RelatorioAtrasos = lazy(() => import('./RelatorioAtrasos'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

export default function FolhaConsolidada() {
  const [tab, setTab] = usePersistedState<string>('rh-folha-tab', 'folha');
  // Estado legado ('pre-folha'/'banco-horas') cai na folha.
  const safeTab = tab === 'adiantamentos' || tab === 'relatorio' ? tab : 'folha';

  return (
    <div className="space-y-4">
      <Tabs value={safeTab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'folha',         label: 'Folha do Mês',  icon: DollarSign },
          { value: 'adiantamentos', label: 'Adiantamentos', icon: Wallet },
          { value: 'relatorio',     label: 'Relatório',     icon: ChartBar },
        ]} />

        <Suspense fallback={<TabLoader />}>
          <TabsContent value="folha"><Payroll /></TabsContent>
          <TabsContent value="adiantamentos"><AdvancesPanel /></TabsContent>
          <TabsContent value="relatorio"><RelatorioAtrasos /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
