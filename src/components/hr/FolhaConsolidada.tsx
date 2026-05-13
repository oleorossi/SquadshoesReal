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
    <div className="editorial-stagger space-y-6">
      {/* Editorial masthead */}
      <div>
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <span className="section-label text-foreground">RH · Recursos Humanos</span>
          <span className="section-label">Módulo 04</span>
        </div>
        <div className="rule-line mb-4" />
        <div className="grid grid-cols-12 gap-4 items-end">
          <div className="col-span-12 md:col-span-8">
            <p className="section-label mb-2">Consolidação Mensal</p>
            <h1 className="text-display-lg leading-none">
              Folha
              <span className="text-primary"> & </span>
              Adiantamentos
            </h1>
          </div>
          <div className="col-span-12 md:col-span-4 border-l border-border pl-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Cálculo da folha, banco de horas e adiantamentos consolidados em um único hub.
            </p>
          </div>
        </div>
        <div className="rule-line-double mt-4" />
      </div>

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
