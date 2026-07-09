import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SquaresFour as LayoutDashboard, Users, Alarm as AlarmClock, CurrencyDollar as DollarSign, CircleNotch as Loader2, Receipt, FileText } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { usePersistedState } from '@/hooks/usePersistedState';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { usePendingTotal } from '@/hooks/useTimePendings';
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

const tabs: { value: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { value: 'funcionarios', label: 'Funcionários', icon: Users },
  { value: 'ponto',        label: 'Ponto',        icon: AlarmClock },
  { value: 'espelho',      label: 'Espelho',      icon: FileText },
  { value: 'folha',        label: 'Folha',        icon: DollarSign },
];

const TAB_HEADERS: Record<Tab, { section: string; title: string; description: string }> = {
  funcionarios: { section: 'RH · COLABORADORES', title: 'Funcionários',    description: 'Cadastro da equipe: salário, escala, diarista e valores de hora extra por pessoa' },
  ponto:        { section: 'RH · PONTO',         title: 'Controle de Ponto', description: 'Importe o arquivo do relógio, corrija batidas e marque faltas/atrasos justificados' },
  espelho:      { section: 'RH · ESPELHO',       title: 'Espelho do funcionário', description: 'Por pessoa, no período: batidas, atrasos, horas extras e faltas — o que vira dinheiro' },
  folha:        { section: 'RH · FOLHA',         title: 'Folha salarial',   description: 'Quanto cada um recebe (salário − faltas/atrasos + HE), com os pagamentos e recibos' },
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

  // Estado persistido pode apontar pra uma aba removida (ex.: 'reconciliacao' de um
  // usuário que voltou): remapeia pela LEGACY_TAB_MAP antes de cair na folha, pra
  // levar ao destino certo ('reconciliacao'→ponto, 'relatorios'→espelho, etc.).
  useEffect(() => {
    if (!(TABS as readonly string[]).includes(activeTab)) {
      setActiveTab(LEGACY_TAB_MAP[activeTab as string] ?? 'folha');
    }
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
          <TabsContent value="espelho"><PayrollReports reportsOnly /></TabsContent>
          <TabsContent value="folha"><FolhaTab /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
