/**
 * Motor de produção — menu único com tudo do motor (pedido do Leonardo,
 * 25/11/2026: "Prazos do motor" ficava escondido em Terceirizados › Modelos).
 * Só reúne telas que já existiam; a lógica continua nos mesmos componentes.
 *
 * Abas (?tab=):
 *   plano       → plano/agenda (v_production_motor_plan)      · alias: agenda
 *   sequencia   → Sequência / liberação (ProducaoSequencia)    · alias: fila
 *   compras     → OCs rascunho priorizadas (comprar até)       · alias: ocs, oc
 *   atelie      → prestador (envio/volta) + reservas do kit    · alias: reservas, prestador
 *   prazos      → Prazos do motor (MotorPrazosPanel)
 *   capacidade  → capacidade por setor, Equipe por setor e capacidade por
 *                 prestador (ProducaoSetoresConfig + AtelierSectorAdmin) · alias: equipe, setores
 *   config      → chaves do motor (só exibição) + Recalcular fila · alias: configuracoes
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarDots, Gauge, ListNumbers, Scissors, ShoppingCart, SlidersHorizontal, Timer, UsersThree,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MotorPrazosPanel } from '@/components/atelier/MotorPrazosPanel';
import { AtelierSectorAdmin } from '@/components/atelier/AtelierAdminPanel';
import {
  MotorAtelierPanel,
  MotorComprasPanel,
  MotorConfigPanel,
  MotorPlanoPanel,
  MotorUltimoRecalculo,
} from '@/components/motor/MotorPanels';
import { resolveMotorTab, type MotorTab } from '@/lib/motorTabs';
import ProducaoSequencia from './ProducaoSequencia';
import ProducaoSetoresConfig from './ProducaoSetoresConfig';

const TRIGGER = 'h-11 shrink-0 snap-start rounded-md px-3 text-[11px] sm:text-xs';

export default function MotorProducao() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab');
  const [tab, setTab] = useState<MotorTab>(resolveMotorTab(raw));

  useEffect(() => {
    setTab(resolveMotorTab(raw));
  }, [raw]);

  const onTabChange = (value: string) => {
    const next = resolveMotorTab(value);
    setTab(next);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', next);
      return params;
    }, { replace: true });
  };

  return (
    <div className="space-y-4 pb-24">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · MOTOR"
        title="Motor de produção"
        description="Tudo do motor num lugar só: plano, sequência, compras, Ateliê, prazos, capacidade e equipe. O motor automático só liga quando o Leonardo decidir."
      />
      <MotorUltimoRecalculo />
      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList
          indicator="none"
          aria-label="Motor de produção"
          className="h-auto snap-x snap-proximity flex-nowrap gap-1 overflow-x-auto rounded-lg border border-border/60 bg-muted/50 p-0.5"
        >
          <TabsTrigger value="plano" className={TRIGGER}><CalendarDots className="h-3.5 w-3.5" /> Plano e agenda</TabsTrigger>
          <TabsTrigger value="sequencia" className={TRIGGER}><ListNumbers className="h-3.5 w-3.5" /> Sequência</TabsTrigger>
          <TabsTrigger value="compras" className={TRIGGER}><ShoppingCart className="h-3.5 w-3.5" /> Compras</TabsTrigger>
          <TabsTrigger value="atelie" className={TRIGGER}><Scissors className="h-3.5 w-3.5" /> Ateliê e reservas</TabsTrigger>
          <TabsTrigger value="prazos" className={TRIGGER}><Timer className="h-3.5 w-3.5" /> Prazos do motor</TabsTrigger>
          <TabsTrigger value="capacidade" className={TRIGGER}><UsersThree className="h-3.5 w-3.5" /> Capacidade e equipe</TabsTrigger>
          <TabsTrigger value="config" className={TRIGGER}><SlidersHorizontal className="h-3.5 w-3.5" /> Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="plano" className="mt-4"><MotorPlanoPanel /></TabsContent>
        <TabsContent value="sequencia" className="mt-4"><ProducaoSequencia /></TabsContent>
        <TabsContent value="compras" className="mt-4"><MotorComprasPanel /></TabsContent>
        <TabsContent value="atelie" className="mt-4"><MotorAtelierPanel /></TabsContent>
        <TabsContent value="prazos" className="mt-4"><MotorPrazosPanel /></TabsContent>
        <TabsContent value="capacidade" className="mt-4 space-y-4">
          <ProducaoSetoresConfig />
          <div className="space-y-2">
            <h2 className="display flex items-center gap-1.5 text-sm uppercase tracking-wide">
              <Gauge className="h-4 w-4" /> Capacidade por prestador
            </h2>
            <AtelierSectorAdmin sector="costura_cabedal" />
            <AtelierSectorAdmin sector="aviamento" />
          </div>
        </TabsContent>
        <TabsContent value="config" className="mt-4"><MotorConfigPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
