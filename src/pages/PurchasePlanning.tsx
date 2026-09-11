import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { HubTabsList } from '@/components/layout/HubTabs';
import {
  Calculator,
  CalendarBlank,
  FlowArrow as Workflow,
  Info,
} from '@phosphor-icons/react';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useSearchParams } from 'react-router-dom';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

const PurchaseProjectionWeeklyContent = lazy(
  () => import('@/components/financial/PurchaseProjectionWeeklyContent'),
);
const CostAnalyticsPanel = lazy(() => import('@/components/financial/CostAnalyticsPanel'));
const SaldoFinalTab = lazy(() => import('@/components/financial/SaldoFinalTab'));
const ProductionScheduleTimeline = lazy(
  () => import('@/components/financial/ProductionScheduleTimeline'),
);

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

// Spec projecao-compras-semanal-integrada:
// entrada principal = projeção; Plano/Projeções/MRP saem da nav (redirect).
// Cronograma + Saldo & Custos permanecem.
//
// URLs legadas (?tab=plano|projecoes|mrp|weekly|…) → projeção.

type MainTab = 'projecao' | 'cronograma' | 'saldo-analytics';
const MAIN_TABS: MainTab[] = ['projecao', 'cronograma', 'saldo-analytics'];

const LEGACY_TO_PROJECAO = new Set([
  'plano',
  'projecoes',
  'mrp',
  'planning',
  'weekly',
  'projection',
  'timeline',
  'fornecedor',
  'semana',
  'historico',
]);

const LEGACY_TAB_MAP: Record<string, { tab: MainTab; view?: string }> = {
  schedule: { tab: 'cronograma' },
  saldo: { tab: 'saldo-analytics', view: 'saldo' },
  analytics: { tab: 'saldo-analytics', view: 'analytics' },
};

const DEFAULT_VIEW: Record<MainTab, string | undefined> = {
  projecao: undefined,
  cronograma: undefined,
  'saldo-analytics': 'saldo',
};

interface SubToggleProps {
  options: { value: string; label: string; hint?: string }[];
  value: string;
  onChange: (v: string) => void;
}

function SubToggle({ options, value, onChange }: SubToggleProps) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-sm border border-foreground/15 bg-card w-fit">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          title={opt.hint}
          className={
            value === opt.value
              ? 'px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm bg-foreground text-background transition-colors'
              : 'px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm text-muted-foreground hover:text-foreground transition-colors'
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function PurchasePlanning() {
  const [searchParams, setSearchParams] = useSearchParams();

  const { activeTab, activeView } = useMemo(() => {
    const tabParam = searchParams.get('tab');
    const viewParam = searchParams.get('view');

    if (tabParam && LEGACY_TO_PROJECAO.has(tabParam)) {
      return { activeTab: 'projecao' as MainTab, activeView: undefined };
    }
    if (tabParam && LEGACY_TAB_MAP[tabParam]) {
      const legacy = LEGACY_TAB_MAP[tabParam];
      return {
        activeTab: legacy.tab,
        activeView: legacy.view ?? DEFAULT_VIEW[legacy.tab],
      };
    }
    const resolvedTab = (
      MAIN_TABS.includes(tabParam as MainTab) ? tabParam : 'projecao'
    ) as MainTab;
    return {
      activeTab: resolvedTab,
      activeView: viewParam || DEFAULT_VIEW[resolvedTab],
    };
  }, [searchParams]);

  // Reescreve URL legada / default na primeira carga
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (!tabParam || LEGACY_TO_PROJECAO.has(tabParam)) {
      if (tabParam !== 'projecao') {
        const next = new URLSearchParams();
        next.set('tab', 'projecao');
        setSearchParams(next, { replace: true });
      }
      return;
    }
    if (LEGACY_TAB_MAP[tabParam]) {
      const legacy = LEGACY_TAB_MAP[tabParam];
      const next = new URLSearchParams();
      next.set('tab', legacy.tab);
      if (legacy.view) next.set('view', legacy.view);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabChange = (value: string) => {
    const tab = value as MainTab;
    const next = new URLSearchParams();
    next.set('tab', tab);
    const dv = DEFAULT_VIEW[tab];
    if (dv) next.set('view', dv);
    setSearchParams(next, { replace: true });
  };

  const handleViewChange = (view: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', view);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="SUPRIMENTOS · PLANEJAMENTO"
        title="Planejamento de Compras"
        description="Projeção semanal (uso × comprar até × caixa), cronograma reverso e saldo após OCs"
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <HubTabsList
          tabs={[
            { value: 'projecao', label: 'Projeção', icon: CalendarBlank },
            { value: 'cronograma', label: 'Cronograma', icon: Workflow },
            { value: 'saldo-analytics', label: 'Saldo & Custos', icon: Calculator },
          ]}
        />

        <Card className="border-dashed bg-muted/20 mt-3 mb-1">
          <CardContent className="py-2.5 px-4 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong>Projeção</strong> = necessidade líquida por semana civil
              (seg–dom), com comprar até (lead time), R$ de caixa na semana de
              compra e geração de OC · <strong>Cronograma</strong> = quando
              iniciar produção · <strong>Saldo & Custos</strong> = posição após
              OCs + variação de preço. Demanda firme nas 4 primeiras semanas;
              forecast só além disso.
            </p>
          </CardContent>
        </Card>

        <TabsContent value="projecao">
          <Suspense fallback={<TabLoader />}>
            <PurchaseProjectionWeeklyContent />
          </Suspense>
        </TabsContent>

        <TabsContent value="cronograma">
          <Suspense fallback={<TabLoader />}>
            <ProductionScheduleTimeline />
          </Suspense>
        </TabsContent>

        <TabsContent value="saldo-analytics">
          <div className="space-y-4">
            <SubToggle
              value={activeView || 'saldo'}
              onChange={handleViewChange}
              options={[
                {
                  value: 'saldo',
                  label: 'Saldo Final',
                  hint: 'Posição de estoque depois de todas as OCs em aberto',
                },
                {
                  value: 'analytics',
                  label: 'Variação Preço',
                  hint: 'Histórico de variação de preço por material',
                },
              ]}
            />
            <Suspense fallback={<TabLoader />}>
              {activeView === 'analytics' ? (
                <CostAnalyticsPanel />
              ) : (
                <SaldoFinalTab />
              )}
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
