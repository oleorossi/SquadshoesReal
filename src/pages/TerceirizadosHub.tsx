/**
 * Hub "Terceirizados" (rota canônica `/terceirizados`) — UNIFICA num só módulo
 * tudo que era espalhado entre duas telas/itens de menu (o antigo "Terceiros"
 * /terceiros e o "Terceirizados" /contractors). O dono apontou que "é o mesmo
 * conceito" e nomeou o módulo unificado como **Terceirizados**.
 *
 * Uma única barra de abas, agrupada em OPERACIONAL | CADASTRO:
 *   OPERACIONAL:
 *   • Ordens de Serviço → lista de OS + acompanhamento em campo (chips "Na rua"/
 *     "Atrasados" + KPIs) + enviar/receber + filtros/seleção/PDF (Contractors).
 *     A antiga aba "Na Rua" (OutsourcedInField) foi FUNDIDA aqui em 2026-06-30 —
 *     era um recorte filtrado das próprias OS; ?tab=rua redireciona pra cá.
 *   • Planejamento      → projeção de carga por contratada (Contractors)
 *   • Relatório         → métricas + histórico (ContractorReports)
 *   CADASTRO:
 *   • Prestadores          → cadastro/CRUD das contratadas (Contractors)
 *   • Tarifas por Referência → R$/par por ficha (TerceirizacaoCoberturaPanel)
 *
 * Receitas de tiras agora pertencem ao grupo próprio Central de Tiras. O parâmetro
 * legado `?tab=recipes` é preservado apenas como redirect.
 *
 * As páginas originais são renderizadas em modo `embedded` (sem header/AppLayout
 * próprios — o header é deste hub). Contractors mantém seus 4 painéis, mas a
 * TabsList interna fica oculta: a aba ativa é controlada pela barra única daqui.
 *
 * Rotas antigas (/terceiros, /terceiros-na-rua, /terceiros/relatorios,
 * /contractors) redirecionam pra cá com a aba certa via ?tab=.
 */
import { useState, useEffect, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ChartBar as BarChart3, ClipboardText as ClipboardList,
  ChartLineUp, Users, Tag,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import ContractorReportsPage from './ContractorReports';
import ContractorsPage from './Contractors';
import { TerceirizacaoCoberturaPanel } from '@/components/contractors/TerceirizacaoCoberturaPanel';

// Uma única régua, com alvos de toque de 44px e labels curtos. O nome completo
// continua no aria-label/title de cada aba.
const TRIGGER = 'h-11 shrink-0 snap-start gap-1.5 rounded-md px-3 py-0 text-[11px] data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-xs';
const GROUP_LABEL = 'flex h-11 shrink-0 items-center px-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/80';

// Abas servidas pelo componente Contractors (uma única instância controlada).
const CONTRACTOR_TABS = ['orders', 'planning', 'contractors'];
const VALID_TABS = new Set([...CONTRACTOR_TABS, 'cobertura', 'relatorio']);
const DEFAULT_TAB = 'orders';

export default function TerceirizadosHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabListRef = useRef<HTMLDivElement>(null);
  // "Na Rua" foi FUNDIDA em "Ordens de Serviço" (2026-06-30): o acompanhamento
  // em campo virou os chips "Na rua"/"Atrasados" + KPIs dentro da própria OS.
  // Links/bookmarks antigos (?tab=rua) redirecionam pra Ordens de Serviço.
  const requestedRaw = searchParams.get('tab') ?? '';
  const requested = requestedRaw === 'rua' ? 'orders' : requestedRaw;
  const [tab, setTab] = useState<string>(VALID_TABS.has(requested) ? requested : DEFAULT_TAB);

  useEffect(() => {
    if (VALID_TABS.has(requested)) setTab(requested);
  }, [requested]);

  // Links diretos podem abrir uma aba que está fora do recorte horizontal no
  // celular. Mantemos a ativa visível sem mover verticalmente a página.
  useEffect(() => {
    const activeTab = tabListRef.current?.querySelector<HTMLElement>('[data-state="active"]');
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  const onTabChange = (v: string) => {
    setTab(v);
    setSearchParams(
      (prev) => { const p = new URLSearchParams(prev); p.set('tab', v); return p; },
      { replace: true },
    );
  };

  // "Nova OS" abre o ÚNICO formulário canônico (aba Ordens de Serviço). Mantido
  // o canal openCreateOS pra eventuais chamadas externas; sem a aba "Na Rua",
  // hoje a criação parte da própria Ordens de Serviço.
  const [pendingCreateOS, setPendingCreateOS] = useState<{ contractorId?: string } | null>(null);

  if (requestedRaw === 'recipes') {
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'receitas');
    return <Navigate to={`/tiras-artesanais?${params.toString()}`} replace />;
  }

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · TERCEIRIZAÇÃO"
        title="Terceirizados"
        description="Acompanhamento na rua, ordens de serviço, cadastro de contratadas e relatório — tudo num só lugar."
      />
      <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
        <TabsList
          ref={tabListRef}
          indicator="none"
          aria-label="Áreas de terceirização"
          className="h-auto snap-x snap-proximity flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain rounded-lg border border-border/60 bg-muted/50 p-0.5 scroll-px-2"
        >
          <span aria-hidden="true" className={GROUP_LABEL}>Operação</span>
          <TabsTrigger value="orders" className={TRIGGER} aria-label="Ordens de Serviço" title="Ordens de Serviço">
            <ClipboardList className="h-3.5 w-3.5" /> Ordens
          </TabsTrigger>
          <TabsTrigger value="planning" className={TRIGGER} aria-label="Planejamento de terceirização" title="Planejamento de terceirização">
            <ChartLineUp className="h-3.5 w-3.5" /> Planejar
          </TabsTrigger>
          <TabsTrigger value="relatorio" className={TRIGGER} aria-label="Relatório de terceirizados">
            <BarChart3 className="h-3.5 w-3.5" /> Relatório
          </TabsTrigger>
          <span aria-hidden className="mx-1 h-6 w-px shrink-0 self-center bg-border" />
          <span aria-hidden="true" className={GROUP_LABEL}>Cadastros</span>
          <TabsTrigger value="contractors" className={TRIGGER} aria-label="Cadastro de prestadores">
            <Users className="h-3.5 w-3.5" /> Prestadores
          </TabsTrigger>
          <TabsTrigger value="cobertura" className={TRIGGER} aria-label="Tarifas por Referência" title="Tarifas por Referência">
            <Tag className="h-3.5 w-3.5" /> Tarifas
          </TabsTrigger>
        </TabsList>

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
