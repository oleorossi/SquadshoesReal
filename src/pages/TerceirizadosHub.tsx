/**
 * Módulo único de ordens de serviço de terceirizados.
 * Ateliê (cabedal complexo) e o antigo menu Terceirizados moram aqui.
 * Os pares vêm de outsourced_pair_ledger.
 *
 * Rotas antigas:
 *   /atelie?view=fila        → corte
 *   /atelie?view=lancamento  → lancar
 *   /atelie?view=relatorio   → relatorio
 *   /atelie?view=cadastro    → modelos
 *   /atelie?view=tiras       → tiras
 *   ?tab=orders|os-ativas    → rua
 *   ?tab=na-rua              → rua
 *   ?tab=planning            → planejar
 *   ?tab=gestao              → relatorio
 *   ?tab=prep                → corte
 *   requestedRaw === 'prep'  → corte (atalho antigo)
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useOutsourcedPairLedger } from '@/hooks/useOutsourcedPairLedger';
import { totalsFromLedger } from '@/lib/outsourcedPairLedger';
import { OsAtivasPanel, OsRedistribuicaoHistorico } from '@/components/contractors/OsAtivasPanel';
import { OutsourcingPlanPanel } from '@/components/contractors/OutsourcingPlanPanel';
import { TerceirizacaoCoberturaPanel } from '@/components/contractors/TerceirizacaoCoberturaPanel';
import { AtelierLancamento } from '@/components/atelier/AtelierLancamento';
import { AtelierReceberPanel } from '@/components/atelier/AtelierReceberPanel';
import { AtelierRelatorioView } from '@/components/atelier/AtelierRelatorioView';
import { AtelierStrapsView } from '@/components/atelier/AtelierStrapsView';
import { MotorPrazosResumo } from '@/components/atelier/MotorPrazosPanel';
import {
  AtelierHubNav,
  AtelierKpiStrip,
  resolveAtelierHubTab,
  useAtelierHubKpis,
} from '@/components/atelier/AtelierHubChrome';
import { CadastroView, FilaView } from '@/pages/Atelie';
import ContractorsPage from './Contractors';
import ContractorReportsPage from './ContractorReports';

export default function TerceirizadosHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab') ?? 'planejar';
  const mapped = resolveAtelierHubTab(raw);
  const [tab, setTab] = useState(mapped);
  const kpis = useAtelierHubKpis();

  useEffect(() => {
    setTab(mapped);
  }, [mapped]);

  if (raw === 'recipes') {
    return <Navigate to="/tiras-artesanais?tab=receitas" replace />;
  }

  const onTabChange = (value: string, extras?: Record<string, string | null>) => {
    const next = resolveAtelierHubTab(value);
    setTab(next);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', next);
      if (extras) {
        for (const [key, val] of Object.entries(extras)) {
          if (val) params.set(key, val);
          else params.delete(key);
        }
      }
      return params;
    }, { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-[90rem] space-y-4 pb-24">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · ATELIÊ"
        title="Ateliê"
        description="Planejar, cortar, lançar a OS, acompanhar no prestador e receber. Cabedal complexo entra aqui, sempre com prestador."
      />
      <AtelierKpiStrip kpis={kpis} onTabChange={onTabChange} />
      <MotorPrazosResumo />
      <Tabs value={tab} onValueChange={(value) => onTabChange(value)}>
        <AtelierHubNav tab={tab} onTabChange={onTabChange} kpis={kpis} />

        <TabsContent value="planejar" className="mt-4">
          <OutsourcingPlanPanel />
        </TabsContent>
        <TabsContent value="corte" className="mt-4">
          <FilaView />
        </TabsContent>
        <TabsContent value="lancar" className="mt-4">
          <AtelierLancamento />
        </TabsContent>
        <TabsContent value="rua" className="mt-4 space-y-4">
          <OsAtivasPanel />
          <OsRedistribuicaoHistorico />
          <ContractorsPage embedded activeTab="orders" onActiveTabChange={() => undefined} />
        </TabsContent>
        <TabsContent value="receber" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            A conferência (bom, defeito e retrabalho) é a do job ou da OS que está na rua. Informe a quantidade parcial ou confirme o retorno total do cabedal.
          </p>
          <AtelierReceberPanel />
          <ReceberResumo />
          <ContractorsPage embedded activeTab="orders" onActiveTabChange={() => undefined} />
        </TabsContent>
        <TabsContent value="prestadores" className="mt-4 space-y-4">
          <ContractorsPage embedded activeTab="contractors" onActiveTabChange={() => undefined} />
          <TerceirizacaoCoberturaPanel />
        </TabsContent>
        <TabsContent value="relatorio" className="mt-4 space-y-4">
          <TotaisDoMotor />
          <AtelierRelatorioView />
          <ContractorReportsPage embedded />
        </TabsContent>
        <TabsContent value="modelos" className="mt-4">
          <CadastroView />
        </TabsContent>
        <TabsContent value="tiras" className="mt-4">
          <AtelierStrapsView />
          <p className="text-sm text-muted-foreground">
            Receitas de tira comprada ficam na <Link className="underline underline-offset-2" to="/tiras-artesanais?tab=receitas">Central de Tiras</Link>.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TotaisDoMotor() {
  const query = useOutsourcedPairLedger('week');
  const totals = totalsFromLedger(query.data ?? []);
  if (query.isLoading) return <p className="text-sm text-muted-foreground">Lendo o motor…</p>;
  if (query.isError) return <p className="text-sm text-destructive">O relatório não leu o motor de pares.</p>;
  return (
    <p className="text-sm text-muted-foreground">
      Nesta semana de produção: demanda {totals.demand.toLocaleString('pt-BR')}, enviado {totals.sent.toLocaleString('pt-BR')}, recebido {totals.received.toLocaleString('pt-BR')}, a enviar {totals.balance.toLocaleString('pt-BR')}. O detalhe por período está em Planejar.
    </p>
  );
}

function ReceberResumo() {
  return (
    <p className="text-xs text-muted-foreground">
      Os cartões acima são os jobs do Ateliê com saldo a receber. A lista de OS abaixo também tem Receber, para a mesma conferência de pares.
    </p>
  );
}
