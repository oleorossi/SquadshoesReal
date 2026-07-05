import { lazy, Suspense, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SquaresFour as LayoutDashboard, Users, Alarm as AlarmClock, CurrencyDollar as DollarSign, CircleNotch as Loader2, LinkSimple, Receipt, FileText } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { usePersistedState } from '@/hooks/usePersistedState';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { usePendingTotal } from '@/hooks/useTimePendings';
import { cn } from '@/lib/utils';

const Employees            = lazy(() => import('./Employees'));
const Timesheet            = lazy(() => import('./Timesheet'));
const FolhaConsolidada     = lazy(() => import('@/components/hr/FolhaConsolidada'));
const PunchReconciliation  = lazy(() => import('./PunchReconciliationPage'));
const PayrollPaymentsHistory = lazy(() => import('@/components/hr/PayrollPaymentsHistory'));
// A aba Relatórios reusa a página Folha em modo somente-relatórios (reportsOnly):
// mesmo seletor de período + o gerador de documentos (inclui o Espelho de ponto).
const PayrollReports       = lazy(() => import('./Payroll'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

// Refocus 2026-06-01: RH é pagamento por hora trabalhada. Abas 'painel'
// (KPIs de banco de horas) e 'fechamento' (HE/jornada esperada) foram
// aposentadas — caem na 'folha' via LEGACY_TAB_MAP + guard.
const TABS = ['funcionarios', 'ponto', 'reconciliacao', 'folha', 'relatorios', 'pagamentos'] as const;
type Tab = typeof TABS[number];

const tabs: { value: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { value: 'funcionarios',  label: 'Funcionários',   icon: Users },
  { value: 'ponto',         label: 'Ponto',          icon: AlarmClock },
  { value: 'reconciliacao', label: 'Reconciliação',  icon: LinkSimple },
  { value: 'folha',         label: 'Folha',          icon: DollarSign },
  { value: 'relatorios',    label: 'Relatórios',     icon: FileText },
  { value: 'pagamentos',    label: 'Pagamentos',     icon: Receipt },
];

const TAB_HEADERS: Record<Tab, { section: string; title: string; description: string }> = {
  funcionarios:  { section: 'RH · COLABORADORES', title: 'Funcionários',    description: 'Gestão de equipe' },
  ponto:         { section: 'RH · PONTO',         title: 'Controle de Ponto', description: 'Importação e lançamento de batidas' },
  reconciliacao: { section: 'RH · PONTO',         title: 'Reconciliação de prestadores', description: 'Vincular cada ID do relógio ao prestador certo' },
  folha:         { section: 'RH · FOLHA',         title: 'Folha salarial',   description: 'Quanto cada funcionário tem a receber, com base no ponto importado' },
  relatorios:    { section: 'RH · FOLHA',         title: 'Relatórios',       description: 'Documentos da folha (calendário, holerite, espelho) + calendário de faltas e de atrasos por funcionário' },
  pagamentos:    { section: 'RH · FOLHA',         title: 'Pagamentos',       description: 'Registro de pagamentos da folha e recibos assinados — puxe qualquer pagamento depois' },
};

// URLs/estado legados que apontavam pra abas aposentadas → folha.
// (2026-07-03) "Relatórios" voltou como aba própria — não mapear mais pra folha.
const LEGACY_TAB_MAP: Record<string, Tab> = {
  'painel':      'folha',
  'fechamento':  'folha',
  'banco-horas': 'folha',
  'absenteismo': 'folha',
  'headcount':   'funcionarios',
};

export default function RHHub() {
  const [activeTab, setActiveTab] = usePersistedState<Tab>('rh-active-tab', 'folha');
  const [searchParams, setSearchParams] = useSearchParams();
  const { total: pendingTotal, overdueTotal } = usePendingTotal(30);

  // Sincroniza ?tab=xxx com o estado persistido.
  useEffect(() => {
    const fromUrl = searchParams.get('tab');
    if (!fromUrl) return;
    const mapped = (TABS as readonly string[]).includes(fromUrl)
      ? (fromUrl as Tab)
      : LEGACY_TAB_MAP[fromUrl];
    if (mapped && mapped !== activeTab) setActiveTab(mapped);
  }, [searchParams, activeTab, setActiveTab]);

  // Estado persistido pode apontar pra uma aba aposentada (painel/fechamento)
  // — sem isso o Tabs renderiza em branco. Cai na folha.
  useEffect(() => {
    if (!(TABS as readonly string[]).includes(activeTab)) setActiveTab('folha');
  }, [activeTab, setActiveTab]);

  const handleNavigateTab = (tab: string) => {
    setActiveTab(tab as Tab);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  };

  const header = TAB_HEADERS[activeTab] ?? TAB_HEADERS.folha;

  return (
    <div className="space-y-4 editorial-stagger">
      <EditorialPageHeader
        sectionLabel={header.section}
        title={header.title}
        description={header.description}
      />
      <Tabs value={activeTab} onValueChange={handleNavigateTab} className="w-full">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-2">
          <TabsList indicator="none" className="inline-flex w-max h-auto gap-1 bg-muted/50 p-1 rounded-lg">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md"
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
                {tab.value === 'ponto' && pendingTotal > 0 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-4 px-1 text-[10px] tabular-nums',
                      overdueTotal > 0
                        ? 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400'
                        : 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
                    )}
                    title={`${pendingTotal} pendências (${overdueTotal} atrasadas +7d)`}
                  >
                    {pendingTotal}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <Suspense fallback={<TabLoader />}>
          <TabsContent value="funcionarios"><Employees /></TabsContent>
          <TabsContent value="ponto"><Timesheet /></TabsContent>
          <TabsContent value="reconciliacao"><PunchReconciliation /></TabsContent>
          <TabsContent value="folha"><FolhaConsolidada /></TabsContent>
          <TabsContent value="relatorios"><PayrollReports reportsOnly /></TabsContent>
          <TabsContent value="pagamentos"><PayrollPaymentsHistory /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
