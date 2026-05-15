import { lazy, Suspense } from 'react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Hourglass, Wallet, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';

const BankHours = lazy(() => import('@/pages/BankHours'));
const AdvancesPanel = lazy(() => import('./AdvancesPanel'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

export default function FolhaConsolidada() {
  // Migra valor antigo 'folha' (tab removida) pro default novo.
  const [tab, setTab] = usePersistedState<string>('rh-folha-tab', 'banco-horas');
  const safeTab = tab === 'folha' ? 'banco-horas' : tab;

  return (
    <div className="editorial-stagger space-y-6">
      <div>
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <span className="section-label text-foreground">RH · Recursos Humanos</span>
          <span className="section-label">Módulo 04</span>
        </div>
        <div className="rule-line mb-4" />
        <div className="grid grid-cols-12 gap-4 items-end">
          <div className="col-span-12 md:col-span-8">
            <p className="section-label mb-2">Banco de Horas & Adiantamentos</p>
            <h1 className="text-display-lg leading-none">
              Horas
              <span className="text-primary"> & </span>
              Adiantamentos
            </h1>
          </div>
          <div className="col-span-12 md:col-span-4 border-l border-border pl-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Banco de horas e adiantamentos por funcionário. Salário base é cadastrado em Funcionários.
            </p>
          </div>
        </div>
        <div className="rule-line-double mt-4" />
      </div>

      <Tabs value={safeTab} onValueChange={setTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'banco-horas', label: 'Banco de Horas',   icon: Hourglass },
          { value: 'adiantamentos', label: 'Adiantamentos',  icon: Wallet },
        ]} />

        <Suspense fallback={<TabLoader />}>
          <TabsContent value="banco-horas"><BankHours /></TabsContent>
          <TabsContent value="adiantamentos"><AdvancesPanel /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
