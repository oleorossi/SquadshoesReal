import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { HubTabsList } from '@/components/layout/HubTabs';
import { ShoppingCart, ChartBar as BarChart3, Calculator, Warning as AlertTriangle, FlowArrow as Workflow, Info, TrendUp as TrendingUp } from '@phosphor-icons/react';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useSearchParams } from 'react-router-dom';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

const PurchasePlanningWizard = lazy(() => import('@/components/financial/PurchasePlanningWizard'));
const CostAnalyticsPanel = lazy(() => import('@/components/financial/CostAnalyticsPanel'));
const SaldoFinalTab = lazy(() => import('@/components/financial/SaldoFinalTab'));
const WeeklyPurchasingContent = lazy(() => import('@/components/financial/WeeklyPurchasingContent'));
const MrpUnifiedContent = lazy(() => import('@/components/financial/MrpUnifiedContent'));
// Motor CANÔNICO de MRP (v_mrp_needs: 87 necessidades acionáveis em prod, com "Gerar OC").
// Promovido na aba MRP em 2026-06-28; o item de menu /mrp-advanced era duplicata.
const MrpNeedsTable = lazy(() => import('@/components/mrp/MrpNeedsTable').then(m => ({ default: m.MrpNeedsTable })));
const PurchaseTimelineTab = lazy(() => import('@/components/financial/PurchaseTimeline').then(m => ({ default: m.PurchaseTimeline })));
const ProductionScheduleTimeline = lazy(() => import('@/components/financial/ProductionScheduleTimeline'));
const PurchaseProjectionContent = lazy(() => import('@/components/financial/PurchaseProjectionContent'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Consolidação 2026-05-29: 8 tabs antigas → 5 tabs novas com sub-toggle interno.
// URLs antigas continuam funcionando via mapa LEGACY_TAB_MAP abaixo.
//
// Antes              → Agora
// ───────────────────────────────────────────────────────────────────────────
// planning           → plano (view=fornecedor)
// weekly             → plano (view=semana)
// projection         → projecoes (view=historico)
// timeline           → projecoes (view=timeline)
// schedule           → cronograma (sem mudança)
// mrp                → mrp (sem mudança)
// saldo              → saldo-analytics (view=saldo)
// analytics          → saldo-analytics (view=analytics)
// ─────────────────────────────────────────────────────────────────────────────

type MainTab = 'plano' | 'projecoes' | 'mrp' | 'cronograma' | 'saldo-analytics';
const MAIN_TABS: MainTab[] = ['plano', 'projecoes', 'mrp', 'cronograma', 'saldo-analytics'];

const LEGACY_TAB_MAP: Record<string, { tab: MainTab; view?: string }> = {
  planning:   { tab: 'plano',           view: 'fornecedor' },
  weekly:     { tab: 'plano',           view: 'semana' },
  projection: { tab: 'projecoes',       view: 'historico' },
  timeline:   { tab: 'projecoes',       view: 'timeline' },
  schedule:   { tab: 'cronograma' },
  saldo:      { tab: 'saldo-analytics', view: 'saldo' },
  analytics:  { tab: 'saldo-analytics', view: 'analytics' },
};

const DEFAULT_VIEW: Record<MainTab, string | undefined> = {
  'plano': 'fornecedor',
  'projecoes': 'historico',
  'mrp': undefined,
  'cronograma': undefined,
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
      {options.map(opt => (
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

  // Resolve tab/view a partir da URL — suporta URLs legadas (?tab=weekly etc.)
  const { activeTab, activeView } = useMemo(() => {
    const tabParam = searchParams.get('tab');
    const viewParam = searchParams.get('view');

    if (tabParam && LEGACY_TAB_MAP[tabParam]) {
      const legacy = LEGACY_TAB_MAP[tabParam];
      return { activeTab: legacy.tab, activeView: legacy.view ?? DEFAULT_VIEW[legacy.tab] };
    }
    const resolvedTab = (MAIN_TABS.includes(tabParam as MainTab) ? tabParam : 'plano') as MainTab;
    return { activeTab: resolvedTab, activeView: viewParam || DEFAULT_VIEW[resolvedTab] };
  }, [searchParams]);

  // Reescreve URL legada na primeira carga
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && LEGACY_TAB_MAP[tabParam]) {
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
        description="Plano por PV, projeções, MRP e saldo final — consolidados em 5 áreas"
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <HubTabsList tabs={[
          { value: 'plano',           label: 'Plano de Compras', icon: ShoppingCart },
          { value: 'projecoes',       label: 'Projeções',        icon: TrendingUp },
          { value: 'mrp',             label: 'MRP & Alertas',    icon: AlertTriangle },
          { value: 'cronograma',      label: 'Cronograma',       icon: Workflow },
          { value: 'saldo-analytics', label: 'Saldo & Custos',   icon: Calculator },
        ]} />

        {/* Callout orientativo curto (resumo do que cada tab faz) */}
        <Card className="border-dashed bg-muted/20 mt-3 mb-1">
          <CardContent className="py-2.5 px-4 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong>Plano</strong> = materiais necessários dos PVs ativos (por fornecedor ou semana) ·
              <strong> Projeções</strong> = histórico estatístico (ABC) ou data-limite por material ·
              <strong> MRP</strong> = sugestões automáticas + alertas ·
              <strong> Cronograma</strong> = quando iniciar produção pra entregar no prazo ·
              <strong> Saldo & Custos</strong> = posição após OCs em aberto + variação histórica de preço.
            </p>
          </CardContent>
        </Card>

        {/* ── Tab 1: Plano de Compras (fornecedor / semana) ── */}
        <TabsContent value="plano">
          <div className="space-y-4">
            <SubToggle
              value={activeView || 'fornecedor'}
              onChange={handleViewChange}
              options={[
                { value: 'fornecedor', label: 'Por Fornecedor', hint: 'Wizard guiado: agrupa materiais por fornecedor pra gerar OCs' },
                { value: 'semana',     label: 'Por Semana',     hint: 'Consolidado semanal: necessidades agrupadas por semana' },
              ]}
            />
            <Suspense fallback={<TabLoader />}>
              {activeView === 'semana' ? <WeeklyPurchasingContent /> : <PurchasePlanningWizard />}
            </Suspense>
          </div>
        </TabsContent>

        {/* ── Tab 2: Projeções (histórico / timeline) ── */}
        <TabsContent value="projecoes">
          <div className="space-y-4">
            <SubToggle
              value={activeView || 'historico'}
              onChange={handleViewChange}
              options={[
                { value: 'historico', label: 'Histórico (ABC)', hint: 'Curva ABC + giro + reorder sugerido baseado em consumo histórico' },
                { value: 'timeline',  label: 'Timeline',        hint: 'Data-limite por material — quando comprar pra ter pronto na data necessária' },
              ]}
            />
            <Suspense fallback={<TabLoader />}>
              {activeView === 'timeline' ? <PurchaseTimelineTab /> : <PurchaseProjectionContent />}
            </Suspense>
          </div>
        </TabsContent>

        {/* ── Tab 3: MRP — Necessidades líquidas (motor canônico v_mrp_needs, com
            "Gerar OC") no topo + Projeções/Alertas embaixo. O item de menu
            "MRP (Necessidades)" (/mrp-advanced) era o MESMO motor — unificado aqui. ── */}
        <TabsContent value="mrp">
          <div className="space-y-6">
            <Suspense fallback={<TabLoader />}>
              <MrpNeedsTable />
            </Suspense>
            <Suspense fallback={<TabLoader />}>
              <MrpUnifiedContent />
            </Suspense>
          </div>
        </TabsContent>

        {/* ── Tab 4: Cronograma Reverso ── */}
        <TabsContent value="cronograma">
          <Suspense fallback={<TabLoader />}>
            <ProductionScheduleTimeline />
          </Suspense>
        </TabsContent>

        {/* ── Tab 5: Saldo & Analytics (saldo / variação preço) ── */}
        <TabsContent value="saldo-analytics">
          <div className="space-y-4">
            <SubToggle
              value={activeView || 'saldo'}
              onChange={handleViewChange}
              options={[
                { value: 'saldo',     label: 'Saldo Final',      hint: 'Posição de estoque depois de todas as OCs em aberto' },
                { value: 'analytics', label: 'Variação Preço',   hint: 'Histórico de variação de preço por material' },
              ]}
            />
            <Suspense fallback={<TabLoader />}>
              {activeView === 'analytics' ? <CostAnalyticsPanel /> : <SaldoFinalTab />}
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
