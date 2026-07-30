import { lazy, Suspense, useRef } from 'react';
import { useUrlTabState } from '@/hooks/useUrlTabState';
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

  // Estas 16 "abas" eram <button> cru: sem role="tab", sem aria-selected e sem
  // navegação por setas. Quem usa teclado atravessava os 16 um a um, e o leitor
  // de tela não dizia qual estava ativa — é o maior conjunto do sistema (F/T7).
  //
  // E o `setSearchParams({ view })` de antes DESCARTAVA todo o resto da query:
  // qualquer filtro na URL morria ao trocar de visão. O hook preserva.
  const { value: view, setValue: setView } = useUrlTabState({
    values: VIEWS.map(v => v.value),
    defaultValue: 'dashboard',
    param: 'view',
    aliases: { capacidade: 'tempos-padrao' },
  });
  const active = VIEWS.find(v => v.value === view) ?? VIEWS[0];

  const listaRef = useRef<HTMLDivElement>(null);
  const aoTeclar = (e: React.KeyboardEvent) => {
    const i = VIEWS.findIndex(v => v.value === view);
    let alvo = -1;
    if (e.key === 'ArrowRight') alvo = (i + 1) % VIEWS.length;
    else if (e.key === 'ArrowLeft') alvo = (i - 1 + VIEWS.length) % VIEWS.length;
    else if (e.key === 'Home') alvo = 0;
    else if (e.key === 'End') alvo = VIEWS.length - 1;
    if (alvo < 0) return;
    e.preventDefault();
    setView(VIEWS[alvo].value);
    // Roving tabindex: o foco acompanha a seleção, senão o teclado navega uma
    // aba e o foco fica na anterior.
    listaRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[alvo]?.focus();
  };

  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · ANÁLISES"
        title="Análises"
        description="Diagnóstico e visões analíticas da produção — todos os números vêm do mesmo motor das telas de operação."
      />
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-1">
        <div
          ref={listaRef}
          role="tablist"
          aria-label="Visões de análise"
          onKeyDown={aoTeclar}
          className="inline-flex w-max gap-1 bg-muted/50 p-1 rounded-lg"
        >
          {VIEWS.map(v => {
            const ativa = active.value === v.value;
            return (
              <button
                key={v.value}
                type="button"
                role="tab"
                id={`aba-${v.value}`}
                aria-selected={ativa}
                aria-controls="painel-analise"
                tabIndex={ativa ? 0 : -1}
                onClick={() => setView(v.value)}
                className={`text-xs whitespace-nowrap px-3 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  ativa
                    ? 'bg-background shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" id="painel-analise" aria-labelledby={`aba-${active.value}`} tabIndex={0}>
        <Suspense fallback={<Loader />}>
          {active.render()}
        </Suspense>
      </div>
    </div>
  );
}
