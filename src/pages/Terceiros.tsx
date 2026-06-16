/**
 * Hub de Terceirização — unifica o acompanhamento "Na Rua" (operacional) e o
 * "Relatório" (analítico) num só lugar, em abas. Antes eram duas páginas/itens
 * de menu separados (que o usuário apontou como "a mesma coisa").
 *
 * As páginas originais (OutsourcedInField / ContractorReports) são renderizadas
 * em modo `embedded` (sem o header próprio — o header é deste hub). As rotas
 * antigas (/terceiros-na-rua, /terceiros/relatorios) redirecionam pra cá com a
 * aba certa via ?tab=.
 *
 * O cadastro de prestadores (/contractors) segue separado — é função distinta
 * (e tem outro módulo de acesso).
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Truck, ChartBar as BarChart3 } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import OutsourcedInFieldPage from './OutsourcedInField';
import ContractorReportsPage from './ContractorReports';

const TRIGGER = 'gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md';

export default function Terceiros() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const [tab, setTab] = useState<string>(requested === 'relatorio' ? 'relatorio' : 'rua');

  useEffect(() => {
    if (requested === 'relatorio' || requested === 'rua') setTab(requested);
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
        title="Terceiros"
        description="Acompanhamento na rua e relatório de desempenho dos prestadores — num só lugar."
      />
      <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
        <TabsList className="h-auto gap-1 bg-muted/50 p-1 rounded-lg">
          <TabsTrigger value="rua" className={TRIGGER}>
            <Truck className="h-3.5 w-3.5" /> Na Rua
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
      </Tabs>
    </div>
  );
}
