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
 *   ?tab=planning            → planejar
 *   ?tab=gestao              → relatorio
 *   ?tab=prep                → corte
 *   requestedRaw === 'prep'  → corte (atalho antigo)
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
  Calendar, ClipboardText, Factory, Kanban, Scissors, Tag, Truck, Users,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOutsourcedPairLedger } from '@/hooks/useOutsourcedPairLedger';
import { totalsFromLedger } from '@/lib/outsourcedPairLedger';
import { OsAtivasPanel, OsRedistribuicaoHistorico } from '@/components/contractors/OsAtivasPanel';
import { OutsourcingPlanPanel } from '@/components/contractors/OutsourcingPlanPanel';
import { TerceirizacaoCoberturaPanel } from '@/components/contractors/TerceirizacaoCoberturaPanel';
import { AtelierLancamento } from '@/components/atelier/AtelierLancamento';
import { AtelierRelatorioView } from '@/components/atelier/AtelierRelatorioView';
import { AtelierStrapsView } from '@/components/atelier/AtelierStrapsView';
import { CadastroView, FilaView } from '@/pages/Atelie';
import ContractorsPage from './Contractors';
import ContractorReportsPage from './ContractorReports';

const TRIGGER = 'h-11 shrink-0 snap-start rounded-md px-3 text-[11px] sm:text-xs';

const TAB_ALIAS: Record<string, string> = {
  orders: 'rua',
  'os-ativas': 'rua',
  planning: 'planejar',
  gestao: 'relatorio',
  prep: 'corte',
  rua: 'rua',
  contractors: 'prestadores',
  cobertura: 'prestadores',
  recipes: 'tiras',
};

const TABS = new Set(['planejar', 'lancar', 'rua', 'receber', 'corte', 'prestadores', 'relatorio', 'modelos', 'tiras']);

export default function TerceirizadosHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab') ?? 'planejar';
  const mapped = TAB_ALIAS[raw] ?? raw;
  const [tab, setTab] = useState(TABS.has(mapped) ? mapped : 'planejar');

  useEffect(() => {
    if (TABS.has(mapped)) setTab(mapped);
  }, [mapped]);

  if (raw === 'recipes') {
    return <Navigate to="/tiras-artesanais?tab=receitas" replace />;
  }

  const onTabChange = (value: string) => {
    setTab(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', value);
      return next;
    }, { replace: true });
  };

  return (
    <div className="space-y-4 pb-24">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · ORDENS DE SERVIÇO"
        title="Terceirizados"
        description="Um módulo só: planejar, lançar, acompanhar na rua e receber. Cabedal complexo entra aqui, sempre com prestador."
      />
      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList
          indicator="none"
          aria-label="Ordens de serviço"
          className="h-auto snap-x snap-proximity flex-nowrap gap-1 overflow-x-auto rounded-lg border border-border/60 bg-muted/50 p-0.5"
        >
          <TabsTrigger value="planejar" className={TRIGGER}><Calendar className="h-3.5 w-3.5" /> Planejar</TabsTrigger>
          <TabsTrigger value="lancar" className={TRIGGER}><ClipboardText className="h-3.5 w-3.5" /> Lançar</TabsTrigger>
          <TabsTrigger value="rua" className={TRIGGER}><Truck className="h-3.5 w-3.5" /> Na rua</TabsTrigger>
          <TabsTrigger value="receber" className={TRIGGER}><Kanban className="h-3.5 w-3.5" /> Receber</TabsTrigger>
          <TabsTrigger value="corte" className={TRIGGER}><Scissors className="h-3.5 w-3.5" /> Corte</TabsTrigger>
          <TabsTrigger value="prestadores" className={TRIGGER}><Users className="h-3.5 w-3.5" /> Prestadores</TabsTrigger>
          <TabsTrigger value="relatorio" className={TRIGGER}><Factory className="h-3.5 w-3.5" /> Relatório</TabsTrigger>
          <TabsTrigger value="modelos" className={TRIGGER}><Tag className="h-3.5 w-3.5" /> Modelos</TabsTrigger>
          <TabsTrigger value="tiras" className={TRIGGER}><Scissors className="h-3.5 w-3.5" /> Tiras</TabsTrigger>
        </TabsList>

        <TabsContent value="planejar" className="mt-3">
          <OutsourcingPlanPanel />
        </TabsContent>
        <TabsContent value="lancar" className="mt-3">
          <AtelierLancamento />
        </TabsContent>
        <TabsContent value="rua" className="mt-3 space-y-4">
          <OsAtivasPanel />
          <OsRedistribuicaoHistorico />
          <ContractorsPage embedded activeTab="orders" onActiveTabChange={() => undefined} />
        </TabsContent>
        <TabsContent value="receber" className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            A conferência (bom, defeito e retrabalho) é a da OS que está na rua. Os pares abaixo são os que o motor ainda marca como enviados e não recebidos.
          </p>
          <ReceberResumo />
          <ContractorsPage embedded activeTab="orders" onActiveTabChange={() => undefined} />
        </TabsContent>
        <TabsContent value="corte" className="mt-3">
          <FilaView />
        </TabsContent>
        <TabsContent value="prestadores" className="mt-3 space-y-4">
          <ContractorsPage embedded activeTab="contractors" onActiveTabChange={() => undefined} />
          <TerceirizacaoCoberturaPanel />
        </TabsContent>
        <TabsContent value="relatorio" className="mt-3 space-y-4">
          <TotaisDoMotor />
          <AtelierRelatorioView />
          <ContractorReportsPage embedded />
        </TabsContent>
        <TabsContent value="modelos" className="mt-3">
          <CadastroView />
        </TabsContent>
        <TabsContent value="tiras" className="mt-3">
          <AtelierStrapsView />
          <p className="text-sm text-muted-foreground">
            Receitas de tira comprada ficam na <Link className="underline" to="/tiras-artesanais?tab=receitas">Central de Tiras</Link>.
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
      Abra a OS na lista e use Receber. O saldo da cor no Lançar e os totais do Planejar saem do mesmo motor.
    </p>
  );
}
