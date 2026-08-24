/**
 * Hub de Ordens de Serviço (rota canônica `/terceirizados`).
 *
 * Unifica o que era espalhado entre "Terceiros" /terceiros e "Terceirizados"
 * /contractors. O dono nomeou o módulo de terceirização; o menu e o título da
 * página falam a operação diária: **Ordens de Serviço**.
 *
 * Uma única barra de abas, agrupada em OPERAÇÃO | CADASTRO:
 *   OPERAÇÃO:
 *   • Ordens de Serviço → lista + na rua / atrasados + enviar/receber + PDF
 *   • Planejar          → carga por contratada
 *   • Pagamentos        → contas a pagar por OS (antes "Relatório" — o nome
 *                         colidia com o botão de PDF da lista)
 *   CADASTRO:
 *   • Prestadores       → CRUD das contratadas
 *   • Tarifas           → R$/par por ficha
 *
 * `?tab=recipes` redireciona ao hub de Tiras. `?tab=rua` cai em Ordens.
 * `?tab=pagamentos` é alias de `relatorio` (URL antiga continua válida).
 *
 * Contractors renderiza as 3 abas de cadastro/OS em modo `embedded`; a
 * TabsList interna fica oculta e o painel ativo vem daqui.
 */
import { useState, useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import {
  ClipboardText as ClipboardList,
  ChartLineUp, Users, Tag, CurrencyDollar as DollarSign,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { HubTabsList, type HubTab } from '@/components/layout/HubTabs';
import ContractorReportsPage from './ContractorReports';
import ContractorsPage from './Contractors';
import { TerceirizacaoCoberturaPanel } from '@/components/contractors/TerceirizacaoCoberturaPanel';

const CONTRACTOR_TABS = ['orders', 'planning', 'contractors'];
const TAB_ALIASES: Record<string, string> = {
  rua: 'orders',
  pagamentos: 'relatorio',
};
const VALID_TABS = new Set([...CONTRACTOR_TABS, 'cobertura', 'relatorio']);
const DEFAULT_TAB = 'orders';

const HUB_TABS: HubTab[] = [
  { value: 'orders', label: 'Ordens de Serviço', icon: ClipboardList, group: 'Operação' },
  { value: 'planning', label: 'Planejar', icon: ChartLineUp, group: 'Operação' },
  { value: 'relatorio', label: 'Pagamentos', icon: DollarSign, group: 'Operação' },
  { value: 'contractors', label: 'Prestadores', icon: Users, group: 'Cadastro' },
  { value: 'cobertura', label: 'Tarifas', icon: Tag, group: 'Cadastro' },
];

export default function TerceirizadosHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRaw = searchParams.get('tab') ?? '';
  const requested = TAB_ALIASES[requestedRaw] ?? requestedRaw;
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
        title="Ordens de Serviço"
        description="Fila na rua, geração por pedido, retorno, pagamento e cadastro de prestadores — um só fluxo."
      />
      <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
        <HubTabsList tabs={HUB_TABS} ariaLabel="Áreas de ordens de serviço" />

        <TabsContent value="cobertura">
          <TerceirizacaoCoberturaPanel />
        </TabsContent>
        <TabsContent value="relatorio">
          <ContractorReportsPage embedded />
        </TabsContent>

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
