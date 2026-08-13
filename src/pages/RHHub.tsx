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

const tabs: { value: Tab; label: string; description: string; icon: typeof Users }[] = [
  { value: 'funcionarios', label: 'Equipe',  description: 'Cadastros e adiantamentos', icon: Users },
  { value: 'ponto',        label: 'Ponto',   description: 'Importação e conferência', icon: AlarmClock },
  { value: 'espelho',      label: 'Espelho', description: 'Jornada por colaborador', icon: FileText },
  { value: 'folha',        label: 'Folha',   description: 'Cálculo e pagamentos', icon: DollarSign },
];

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

  return (
    <div className="space-y-4 editorial-stagger">
      <EditorialPageHeader
        sectionLabel="PESSOAS · OPERAÇÃO"
        title="Gestão de Pessoas"
        description="Equipe, jornada e folha em um só lugar — comece pela área que precisa operar agora."
        meta={<><strong>{employees.filter(employee => employee.active).length}</strong> ATIVOS · {pendingTotal > 0 ? <><strong>{pendingTotal}</strong> PENDÊNCIAS DE PONTO</> : 'PONTO EM DIA'}</>}
      />
      <Tabs value={activeTab} onValueChange={(tab) => setActiveTab(tab as Tab)} className="w-full">
        <div className="border-y border-border/70 bg-muted/20">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-0 border-0 bg-transparent p-0 md:grid-cols-4" aria-label="Áreas de Gestão de Pessoas">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="group relative h-auto min-h-[76px] justify-start gap-3 whitespace-normal border-b-0 px-4 py-3 text-left normal-case tracking-normal font-sans data-[state=active]:bg-background data-[state=active]:text-foreground md:min-h-[88px] md:px-5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-sm ring-1 ring-border/60 transition-colors group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
                  <tab.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-sm font-semibold">{tab.label}</span>
                  <span className="mt-1 hidden text-xs font-normal text-muted-foreground md:block">{tab.description}</span>
                </span>
                {tab.value === 'ponto' && pendingTotal > 0 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'ml-auto h-5 shrink-0 px-1.5 text-[10px] tabular-nums',
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
          <TabsContent value="funcionarios" className="mt-6"><Employees /></TabsContent>
          <TabsContent value="ponto" className="mt-6"><Timesheet /></TabsContent>
          <TabsContent value="espelho" className="mt-6"><PayrollReports reportsOnly /></TabsContent>
          <TabsContent value="folha" className="mt-6"><FolhaTab /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
