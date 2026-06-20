/**
 * Hub "Terceirizados" (rota canônica `/terceirizados`) — UNIFICA num só módulo
 * tudo que era espalhado entre duas telas/itens de menu (o antigo "Terceiros"
 * /terceiros e o "Terceirizados" /contractors). O dono apontou que "é o mesmo
 * conceito" e nomeou o módulo unificado como **Terceirizados**.
 *
 * Uma única barra de abas (flat) engloba as duas funcionalidades:
 *   • Na Rua            → acompanhamento operacional (OutsourcedInField)
 *   • Ordens de Serviço → lista de OS + filtros/seleção/PDF (Contractors)
 *   • Planejamento      → projeção de carga por contratada (Contractors)
 *   • Prestadores       → cadastro/CRUD das contratadas (Contractors)
 *   • Receitas          → receitas artesanais (Contractors)
 *   • Relatório         → métricas + histórico (ContractorReports)
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
  ChartLineUp, Users, Flask as FlaskConical,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import OutsourcedInFieldPage from './OutsourcedInField';
import ContractorReportsPage from './ContractorReports';
import ContractorsPage from './Contractors';

const TRIGGER = 'gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md';

// Abas servidas pelo componente Contractors (uma única instância controlada).
const CONTRACTOR_TABS = ['orders', 'planning', 'contractors', 'recipes'];
const VALID_TABS = new Set(['rua', ...CONTRACTOR_TABS, 'relatorio']);
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

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · TERCEIRIZAÇÃO"
        title="Terceirizados"
        description="Acompanhamento na rua, ordens de serviço, cadastro de contratadas e relatório — tudo num só lugar."
      />
      <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
        <TabsList className="h-auto flex-wrap gap-1 bg-muted/50 p-1 rounded-lg">
          <TabsTrigger value="rua" className={TRIGGER}>
            <Truck className="h-3.5 w-3.5" /> Na Rua
          </TabsTrigger>
          <TabsTrigger value="orders" className={TRIGGER}>
            <ClipboardList className="h-3.5 w-3.5" /> Ordens de Serviço
          </TabsTrigger>
          <TabsTrigger value="planning" className={TRIGGER}>
            <ChartLineUp className="h-3.5 w-3.5" /> Planejamento
          </TabsTrigger>
          <TabsTrigger value="contractors" className={TRIGGER}>
            <Users className="h-3.5 w-3.5" /> Prestadores
          </TabsTrigger>
          <TabsTrigger value="recipes" className={TRIGGER}>
            <FlaskConical className="h-3.5 w-3.5" /> Receitas
          </TabsTrigger>
          <TabsTrigger value="relatorio" className={TRIGGER}>
            <BarChart3 className="h-3.5 w-3.5" /> Relatório
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rua">
          <OutsourcedInFieldPage embedded />
        </TabsContent>
        <TabsContent value="relatorio">
          <ContractorReportsPage embedded />
        </TabsContent>

        {/* Uma única instância de Contractors serve as 4 abas de cadastro/OS.
            Só monta quando uma dessas abas está ativa (evita carregar suas
            queries pesadas enquanto o usuário fica só no "Na Rua"). O painel
            ativo é dirigido por `activeTab`; a TabsList interna fica oculta. */}
        {CONTRACTOR_TABS.includes(tab) && (
          <ContractorsPage embedded activeTab={tab} onActiveTabChange={onTabChange} />
        )}
      </Tabs>
    </div>
  );
}
