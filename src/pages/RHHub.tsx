import { lazy, Suspense, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Alarm as AlarmClock, CurrencyDollar as DollarSign, CircleNotch as Loader2, Receipt, FileText } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { usePendingTotal } from '@/hooks/useTimePendings';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useEmployees } from '@/hooks/useEmployees';
import { cn } from '@/lib/utils';

const Employees            = lazy(() => import('./Employees'));
const Timesheet            = lazy(() => import('./Timesheet'));
const FolhaConsolidada     = lazy(() => import('@/components/hr/FolhaConsolidada'));
const PayrollPaymentsHistory = lazy(() => import('@/components/hr/PayrollPaymentsHistory'));
// Espelho / documentos: a página Folha em modo somente-relatórios (reportsOnly) já
// gera o Espelho de ponto + calendário de faltas e de atrasos por funcionário.
const PayrollReports       = lazy(() => import('./Payroll'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

// Reforma Gestão de Pessoas (spec 2026-07-09): RH tem QUATRO telas —
// Funcionários · Ponto · Espelho · Folha. Reconciliação foi pra dentro do Ponto,
// Pagamentos pra dentro da Folha, e as abas aposentadas (painel/fechamento/
// banco-horas) foram removidas (não só remapeadas).
const TABS = ['funcionarios', 'ponto', 'espelho', 'folha'] as const;
type Tab = typeof TABS[number];

const tabs: { value: Tab; label: string; icon: typeof Users }[] = [
  { value: 'funcionarios', label: 'Equipe',  icon: Users },
  { value: 'ponto',        label: 'Ponto',   icon: AlarmClock },
  { value: 'espelho',      label: 'Espelho', icon: FileText },
  { value: 'folha',        label: 'Folha',   icon: DollarSign },
];

const TAB_HEADERS: Record<Tab, { section: string; title: string; description: string }> = {
  funcionarios: {
    section: 'PESSOAS · EQUIPE',
    title: 'Equipe',
    description: 'Cadastros, jornadas, salários e adiantamentos dos colaboradores.',
  },
  ponto: {
    section: 'PESSOAS · PONTO',
    title: 'Controle de Ponto',
    description: 'Importe as batidas, resolva pendências e prepare o período para a folha.',
  },
  espelho: {
    section: 'PESSOAS · ESPELHO',
    title: 'Espelho do Ponto',
    description: 'Confira a jornada e as ocorrências de cada colaborador no período.',
  },
  folha: {
    section: 'PESSOAS · FOLHA',
    title: 'Folha de Pagamento',
    description: 'Calcule valores, confira o fechamento e acompanhe os pagamentos.',
  },
};

// URLs/estado legados que apontavam pras abas antigas → novas telas.
const LEGACY_TAB_MAP: Record<string, Tab> = {
  'reconciliacao': 'ponto',    // reconciliação de prestadores agora vive no Ponto
  'relatorios':    'espelho',  // Relatórios (espelho/faltas/atrasos) virou "Espelho"
  'pagamentos':    'folha',    // Pagamentos agora é sub-aba da Folha
  'painel':        'folha',
  'fechamento':    'folha',
  'banco-horas':   'folha',
  'absenteismo':   'espelho',
  'headcount':     'funcionarios',
};

/** Folha = consolidada + histórico de pagamentos (sub-abas internas). */
function FolhaTab() {
  const [inner, setInner] = useState<'consolidada' | 'pagamentos'>('consolidada');
  return (
    <div className="space-y-4">
      <div className="inline-flex gap-1 bg-muted/50 p-1 rounded-lg">
        <button
          onClick={() => setInner('consolidada')}
          className={cn('inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors',
            inner === 'consolidada' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted/40')}
        >
          <DollarSign className="h-3.5 w-3.5" /> Consolidada
        </button>
        <button
          onClick={() => setInner('pagamentos')}
          className={cn('inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors',
            inner === 'pagamentos' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:bg-muted/40')}
        >
          <Receipt className="h-3.5 w-3.5" /> Pagamentos
        </button>
      </div>
      <Suspense fallback={<TabLoader />}>
        {inner === 'consolidada' ? <FolhaConsolidada /> : <PayrollPaymentsHistory />}
      </Suspense>
    </div>
  );
}

export default function RHHub() {
  const { value: activeTab, setValue: setActiveTab } = useUrlTabState<Tab>({
    values: TABS,
    defaultValue: 'funcionarios',
    aliases: LEGACY_TAB_MAP,
    legacyParams: ['view'],
    clearOnChange: ['subtab'],
    migrateFrom: 'rh-active-tab',
  });
  const { data: employees = [] } = useEmployees();
  const { total: pendingTotal, overdueTotal } = usePendingTotal(30);
  const header = TAB_HEADERS[activeTab];
  const activeEmployees = employees.filter(employee => employee.active).length;

  return (
    <div className="space-y-4 editorial-stagger">
      <EditorialPageHeader
        sectionLabel={header.section}
        title={header.title}
        description={header.description}
        meta={<><strong>{activeEmployees}</strong> ATIVOS · {pendingTotal > 0 ? <><strong>{pendingTotal}</strong> PENDÊNCIAS DE PONTO</> : 'PONTO EM DIA'}</>}
      />
      <Tabs value={activeTab} onValueChange={(tab) => setActiveTab(tab as Tab)} className="w-full">
        <div>
          <TabsList
            indicator="none"
            className="grid h-auto w-full grid-cols-4 gap-1 rounded-lg border border-border/70 bg-muted/30 p-1"
            aria-label="Áreas de Gestão de Pessoas"
          >
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="group relative min-h-11 min-w-0 gap-1 rounded-md border-b-0 px-2 py-2 font-sans text-xs font-semibold normal-case tracking-normal data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:gap-2 sm:px-3 sm:text-sm"
              >
                <tab.icon className="hidden h-4 w-4 shrink-0 text-muted-foreground group-data-[state=active]:text-primary sm:block" />
                <span>{tab.label}</span>
                {tab.value === 'ponto' && pendingTotal > 0 && (
                  <>
                    <span
                      className={cn('h-2 w-2 shrink-0 rounded-full sm:hidden', overdueTotal > 0 ? 'bg-destructive' : 'bg-amber-500')}
                      title={`${pendingTotal} pendências de ponto`}
                    />
                    <span className="sr-only">{pendingTotal} pendências de ponto</span>
                    <Badge
                      variant="outline"
                      aria-hidden="true"
                      className={cn(
                        'hidden h-5 shrink-0 px-1.5 text-[10px] tabular-nums sm:inline-flex',
                        overdueTotal > 0
                          ? 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400'
                          : 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
                      )}
                      title={`${pendingTotal} pendências (${overdueTotal} atrasadas +7d)`}
                    >
                      {pendingTotal}
                    </Badge>
                  </>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <Suspense fallback={<TabLoader />}>
          <TabsContent value="funcionarios" className="mt-4"><Employees /></TabsContent>
          <TabsContent value="ponto" className="mt-4"><Timesheet /></TabsContent>
          <TabsContent value="espelho" className="mt-4"><PayrollReports reportsOnly /></TabsContent>
          <TabsContent value="folha" className="mt-4"><FolhaTab /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
