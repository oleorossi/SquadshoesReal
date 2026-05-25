import { lazy, Suspense, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SquaresFour as LayoutDashboard, Users, Alarm as AlarmClock, CurrencyDollar as DollarSign, FileText, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { usePersistedState } from '@/hooks/usePersistedState';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { usePendingTotal } from '@/hooks/useTimePendings';
import { cn } from '@/lib/utils';

const PainelRH         = lazy(() => import('@/components/hr/PainelRH'));
const Employees        = lazy(() => import('./Employees'));
const Timesheet        = lazy(() => import('./Timesheet'));
const FolhaConsolidada = lazy(() => import('@/components/hr/FolhaConsolidada'));
const RelatoriosRH     = lazy(() => import('@/components/hr/RelatoriosRH'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

const TABS = ['painel', 'funcionarios', 'ponto', 'folha', 'relatorios'] as const;
type Tab = typeof TABS[number];

const tabs: { value: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { value: 'painel',       label: 'Painel',       icon: LayoutDashboard },
  { value: 'funcionarios', label: 'Funcionários', icon: Users },
  { value: 'ponto',        label: 'Ponto',        icon: AlarmClock },
  { value: 'folha',        label: 'Folha',        icon: DollarSign },
  { value: 'relatorios',   label: 'Relatórios',   icon: FileText },
];

// Contexto por aba: o header global muda título/descrição/sectionLabel
// conforme a navegação — evita "Recursos Humanos" abstrato em toda tela.
const TAB_HEADERS: Record<Tab, { section: string; title: string; description: string }> = {
  painel:       { section: 'RH · PAINEL',        title: 'Painel',        description: 'Visão geral, alertas e evolução do quadro' },
  funcionarios: { section: 'RH · COLABORADORES', title: 'Funcionários',  description: 'Gestão de equipe e adiantamentos' },
  ponto:        { section: 'RH · PONTO',         title: 'Controle de Ponto', description: 'Registros, pendências, resolução de HE e configuração' },
  folha:        { section: 'RH · FOLHA',         title: 'Folha & Banco', description: 'Folha mensal, banco de horas e adiantamentos' },
  relatorios:   { section: 'RH · RELATÓRIOS',    title: 'Relatórios',    description: 'Custo, HE, produtividade, absenteísmo e quadro' },
};

// Compatibilidade com URLs legadas que usavam tabs antigas
const LEGACY_TAB_MAP: Record<string, Tab> = {
  'banco-horas': 'folha',
  'absenteismo': 'relatorios',
  'headcount':   'relatorios',
};

export default function RHHub() {
  const [activeTab, setActiveTab] = usePersistedState<Tab>('rh-active-tab', 'painel');
  const [searchParams, setSearchParams] = useSearchParams();
  // Badge de pendências de ponto — aparece sempre, redireciona pra tab 'ponto' ao clicar
  const { total: pendingTotal, overdueTotal } = usePendingTotal(30);

  // Sincroniza ?tab=xxx com o estado persistido
  useEffect(() => {
    const fromUrl = searchParams.get('tab');
    if (!fromUrl) return;
    const mapped = (TABS as readonly string[]).includes(fromUrl)
      ? (fromUrl as Tab)
      : LEGACY_TAB_MAP[fromUrl];
    if (mapped && mapped !== activeTab) {
      setActiveTab(mapped);
    }
  }, [searchParams, activeTab, setActiveTab]);

  const handleNavigateTab = (tab: string) => {
    setActiveTab(tab as Tab);
    // Atualiza URL sem reload pra manter atalhos copiáveis
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  };

  const header = TAB_HEADERS[activeTab] ?? TAB_HEADERS.painel;

  return (
    <div className="space-y-4 editorial-stagger">
      <EditorialPageHeader
        sectionLabel={header.section}
        title={header.title}
        description={header.description}
      />
      <Tabs value={activeTab} onValueChange={handleNavigateTab} className="w-full">
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
          <TabsContent value="painel"><PainelRH onNavigateTab={handleNavigateTab} /></TabsContent>
          <TabsContent value="funcionarios"><Employees /></TabsContent>
          <TabsContent value="ponto"><Timesheet /></TabsContent>
          <TabsContent value="folha"><FolhaConsolidada /></TabsContent>
          <TabsContent value="relatorios"><RelatoriosRH /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
