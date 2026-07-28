import { lazy, Suspense } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useEnsureFreshSchedule } from '@/hooks/useProductionEngine';

// Ferramentas de análise/diagnóstico — todas leem do motor único
// (orders/order_stages/production_schedule); nada de production_waves.
const PCPDashboard = lazy(() => import('./PCPDashboard'));
const SectorBottleneckView = lazy(() => import('./SectorBottleneckView'));
const LeadTime = lazy(() => import('./LeadTime'));
const DefaultLeadTimesCapacity = lazy(() => import('./DefaultLeadTimesCapacity'));
const RCCPPlanning = lazy(() => import('@/components/production/RCCPPlanning'));
const PostOPAnalysis = lazy(() => import('@/components/production/PostOPAnalysis'));
const OrderFlowAudit = lazy(() => import('./OrderFlowAudit'));
const Quality = lazy(() => import('./Quality'));
const ParadasOee = lazy(() => import('./ParadasOee'));
const Cronoanalise = lazy(() => import('./Cronoanalise'));
const SetupTimes = lazy(() => import('./SetupTimes'));
const ProductionFlow = lazy(() => import('./ProductionFlow'));
const ProductionTimeline = lazy(() => import('./ProductionTimeline'));
const SectorAggregatedView = lazy(() => import('./SectorAggregatedView'));
const LotSplitPage = lazy(() => import('./LotSplitPage'));
const ProductionControlCenter = lazy(() => import('./ProductionControlCenter'));

const Loader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

const VIEWS: { value: string; label: string; render: () => JSX.Element }[] = [
  { value: 'dashboard',    label: 'Dashboard',        render: () => <PCPDashboard /> },
  { value: 'gargalos',     label: 'Gargalos',         render: () => <SectorBottleneckView /> },
  { value: 'lead-time',    label: 'Lead Time',        render: () => <LeadTime /> },
  { value: 'tempos-padrao', label: 'Tempos-Padrão por Setor', render: () => <DefaultLeadTimesCapacity /> },
  { value: 'rccp',         label: 'RCCP',             render: () => <RCCPPlanning /> },
  { value: 'pos-op',       label: 'Pós-OP',           render: () => <PostOPAnalysis /> },
  { value: 'auditoria',    label: 'Auditoria',        render: () => <OrderFlowAudit embedded /> },
  { value: 'qualidade',    label: 'Qualidade',        render: () => <Quality /> },
  { value: 'oee',          label: 'Paradas & OEE',    render: () => <ParadasOee /> },
  { value: 'cronoanalise', label: 'Cronoanálise',     render: () => <Cronoanalise /> },
  { value: 'setup',        label: 'Tempos de Setup',  render: () => <SetupTimes /> },
  // Visões legadas do antigo Quadro de Produção (R5.7) — o Kanban é o padrão
  { value: 'matriz',       label: 'Matriz (legado)',   render: () => <ProductionFlow embedded /> },
  { value: 'timeline',     label: 'Timeline (legado)', render: () => <ProductionTimeline embedded /> },
  { value: 'lote',         label: 'Visão Lote (legado)', render: () => <SectorAggregatedView embedded /> },
  { value: 'lot-split',    label: 'Split de Lotes',   render: () => <LotSplitPage /> },
  { value: 'centro-controle', label: 'Centro de Controle', render: () => <ProductionControlCenter /> },
];

/**
 * ANÁLISES (R8) — todas as ferramentas de análise/diagnóstico de produção num
 * lugar só, lendo do motor único. O dia a dia mora nos itens diretos do menu
 * (Planejamento, Kanban, Estouro, Setores, Apontamento).
 */
export default function ProducaoAnalises() {
  useEnsureFreshSchedule();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') || 'dashboard';
  if (view === 'capacidade') {
    return <Navigate to="/producao/analises?view=tempos-padrao" replace />;
  }
  const active = VIEWS.find(v => v.value === view) ?? VIEWS[0];

  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · ANÁLISES"
        title="Análises"
        description="Diagnóstico e visões analíticas da produção — todos os números vêm do mesmo motor das telas de operação."
      />
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-1">
        <div className="inline-flex w-max gap-1 bg-muted/50 p-1 rounded-lg">
          {VIEWS.map(v => (
            <button
              key={v.value}
              onClick={() => setSearchParams({ view: v.value }, { replace: true })}
              className={`text-xs whitespace-nowrap px-3 py-1.5 rounded-md transition-colors ${
                active.value === v.value
                  ? 'bg-background shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <Suspense fallback={<Loader />}>
        {active.render()}
      </Suspense>
    </div>
  );
}
