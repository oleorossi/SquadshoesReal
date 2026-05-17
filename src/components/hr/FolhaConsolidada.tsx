import { lazy, Suspense } from 'react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { CurrencyDollar as DollarSign, Hourglass, Wallet, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';

const Payroll = lazy(() => import('@/pages/Payroll'));
const BankHours = lazy(() => import('@/pages/BankHours'));
const AdvancesPanel = lazy(() => import('./AdvancesPanel'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

export default function FolhaConsolidada() {
  const [tab, setTab] = usePersistedState<string>('rh-folha-tab', 'folha');

  return (
    <div className="space-y-4">
      {/* Masthead local removido — header global no RHHub. */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'folha',       label: 'Folha do Mês',     icon: DollarSign },
          { value: 'banco-horas', label: 'Banco de Horas',   icon: Hourglass },
          { value: 'adiantamentos', label: 'Adiantamentos',  icon: Wallet },
        ]} />

        <Suspense fallback={<TabLoader />}>
          <TabsContent value="folha"><Payroll /></TabsContent>
          <TabsContent value="banco-horas"><BankHours /></TabsContent>
          <TabsContent value="adiantamentos"><AdvancesPanel /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
