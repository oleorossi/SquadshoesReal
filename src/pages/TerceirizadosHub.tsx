/**
 * Hub "Terceirizados" (rota canônica `/terceirizados`) — UNIFICA num só módulo
 * tudo que era espalhado entre duas telas/itens de menu (o antigo "Terceiros"
 * /terceiros e o "Terceirizados" /contractors). O dono apontou que "é o mesmo
 * conceito" e nomeou o módulo unificado como **Terceirizados**.
 *
 * Uma única barra de abas, agrupada em OPERACIONAL | CADASTRO:
 *   OPERACIONAL:
 *   • Na Rua            → acompanhamento + recebimento/retorno (OutsourcedInField)
 *   • Ordens de Serviço → lista de OS + filtros/seleção/PDF (Contractors)
 *   • Planejamento      → projeção de carga por contratada (Contractors)
 *   • Relatório         → métricas + histórico (ContractorReports)
 *   CADASTRO:
 *   • Prestadores          → cadastro/CRUD das contratadas (Contractors)
 *   • Tarifas por Referência → R$/par por ficha (TerceirizacaoCoberturaPanel)
 *
 * (A antiga aba "Receitas" foi removida na auditoria 2026-06-28 — duplicava
 *  Engenharia → Receitas /artisanal-recipes, que segue como página própria.)
 *
 * As páginas originais são renderizadas em modo `embedded` (sem header/AppLayout
 * próprios — o header é deste hub). Contractors mantém seus 4 painéis, mas a
 * TabsList interna fica oculta: a aba ativa é controlada pela barra única daqui.
 *
 * Rotas antigas (/terceiros, /terceiros-na-rua, /terceiros/relatorios,
 * /contractors) redirecionam pra cá com a aba certa via ?tab=.
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Truck, ChartBar as BarChart3, ClipboardText as ClipboardList,
  ChartLineUp, Users, Tag,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import OutsourcedInFieldPage from './OutsourcedInField';
import ContractorReportsPage from './ContractorReports';
import ContractorsPage from './Contractors';
import { TerceirizacaoCoberturaPanel } from '@/components/contractors/TerceirizacaoCoberturaPanel';

const TRIGGER = 'gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md';

// Abas servidas pelo componente Contractors (uma única instância controlada).
const CONTRACTOR_TABS = ['orders', 'planning', 'contractors'];
const VALID_TABS = new Set(['rua', ...CONTRACTOR_TABS, 'cobertura', 'relatorio']);
const DEFAULT_TAB = 'rua';

export default function TerceirizadosHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab') ?? '';
  const [tab, setTab] = useState<string>(VALID_TABS.has(requested) ? requested : DEFAULT_TAB);

  useEffect(() => {
    if (VALID_TABS.has(requested)) setTab(requested);
  }, [requested]);

  const onTabChange = (v: string) => {
    setTab(v);
    setSearchParams(
      (prev) => { const p = new URLSearchParams(prev); p.set('tab', v); return p; },
      { replace: true },
    );
  };

  // "Nova OS" UNIFICADA: qualquer aba (ex.: "Na Rua") que peça criar OS abre o
  // ÚNICO formulário canônico, que vive na aba "Ordens de Serviço" (Contractors).
  // Troca pra essa aba + sinaliza o Contractors a abrir o form (com contratada
  // opcional pré-selecionada). Acaba com o formulário duplicado/divergente.
  const [pendingCreateOS, setPendingCreateOS] = useState<{ contractorId?: string } | null>(null);
  const requestCreateOS = (contractorId?: string) => {
    setPendingCreateOS({ contractorId });
    onTabChange('orders');
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · TERCEIRIZAÇÃO"
        title="Terceirizados"
        description="Acompanhamento na rua, ordens de serviço, cadastro de contratadas e relatório — tudo num só lugar."
      />
      <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
        <TabsList className="h-auto flex-wrap items-center gap-1 bg-muted/50 p-1 rounded-lg">
          {/* OPERACIONAL */}
          <TabsTrigger value="rua" className={TRIGGER}>
            <Truck className="h-3.5 w-3.5" /> Na Rua
          </TabsTrigger>
          <TabsTrigger value="orders" className={TRIGGER}>
            <ClipboardList className="h-3.5 w-3.5" /> Ordens de Serviço
          </TabsTrigger>
          <TabsTrigger value="planning" className={TRIGGER}>
            <ChartLineUp className="h-3.5 w-3.5" /> Planejamento
          </TabsTrigger>
          <TabsTrigger value="relatorio" className={TRIGGER}>
            <BarChart3 className="h-3.5 w-3.5" /> Relatório
          </TabsTrigger>
          {/* divisor OPERACIONAL | CADASTRO */}
          <span aria-hidden className="mx-1 h-5 w-px self-center bg-border" />
          {/* CADASTRO */}
          <TabsTrigger value="contractors" className={TRIGGER}>
            <Users className="h-3.5 w-3.5" /> Prestadores
          </TabsTrigger>
          <TabsTrigger value="cobertura" className={TRIGGER}>
            <Tag className="h-3.5 w-3.5" /> Tarifas por Referência
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rua">
          <OutsourcedInFieldPage embedded onRequestCreateOS={requestCreateOS} />
        </TabsContent>
        <TabsContent value="cobertura">
          <TerceirizacaoCoberturaPanel />
        </TabsContent>
        <TabsContent value="relatorio">
          <ContractorReportsPage embedded />
        </TabsContent>

        {/* Uma única instância de Contractors serve as 4 abas de cadastro/OS.
            Só monta quando uma dessas abas está ativa (evita carregar suas
            queries pesadas enquanto o usuário fica só no "Na Rua"). O painel
            ativo é dirigido por `activeTab`; a TabsList interna fica oculta. */}
        {CONTRACTOR_TABS.includes(tab) && (
          <ContractorsPage
            embedded
            activeTab={tab}
            onActiveTabChange={onTabChange}
            openCreateOS={pendingCreateOS}
            onCreateOSConsumed={() => setPendingCreateOS(null)}
          />
        )}
      </Tabs>
    </div>
  );
}
