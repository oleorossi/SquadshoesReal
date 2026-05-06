import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  LayoutDashboard, Users, Clock, DollarSign, AlertTriangle, TrendingUp, Calendar,
} from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';

const RHDashboard      = lazy(() => import('./RHDashboard'));
const Employees        = lazy(() => import('./Employees'));
const Timesheet        = lazy(() => import('./Timesheet'));
const Payroll          = lazy(() => import('./Payroll'));
const BankHours        = lazy(() => import('./BankHours'));
const AbsenceReport    = lazy(() => import('./AbsenceReport'));
const HeadcountReport  = lazy(() => import('./HeadcountReport'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

const TABS = ['painel', 'funcionarios', 'ponto', 'folha', 'banco-horas', 'absenteismo', 'headcount'] as const;

const tabs = [
  { value: 'painel',        label: 'Painel',        icon: LayoutDashboard },
  { value: 'funcionarios',  label: 'Funcionários',  icon: Users },
  { value: 'ponto',         label: 'Ponto',         icon: Calendar },
  { value: 'folha',         label: 'Folha',         icon: DollarSign },
  { value: 'banco-horas',   label: 'Banco de Horas', icon: Clock },
  { value: 'absenteismo',   label: 'Absenteísmo',   icon: AlertTriangle },
  { value: 'headcount',     label: 'Headcount',     icon: TrendingUp },
];

export default function RHHub() {
  const [activeTab, setActiveTab] = usePersistedState<string>('rh-active-tab', 'painel');
  const [searchParams] = useSearchParams();

  const fromUrl = searchParams.get('tab');
  if (fromUrl && (TABS as readonly string[]).includes(fromUrl) && fromUrl !== activeTab) {
    setActiveTab(fromUrl);
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-2">
          <TabsList className="inline-flex w-max h-auto gap-1 bg-muted/50 p-1 rounded-lg">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <Suspense fallback={<TabLoader />}>
          <TabsContent value="painel"><RHDashboard /></TabsContent>
          <TabsContent value="funcionarios"><Employees /></TabsContent>
          <TabsContent value="ponto"><Timesheet /></TabsContent>
          <TabsContent value="folha"><Payroll /></TabsContent>
          <TabsContent value="banco-horas"><BankHours /></TabsContent>
          <TabsContent value="absenteismo"><AbsenceReport /></TabsContent>
          <TabsContent value="headcount"><HeadcountReport /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
