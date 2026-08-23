import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Play, ClipboardText } from '@phosphor-icons/react';
import { type OrderStage, useUpdateOrderStage } from '@/hooks/useOrderStages';
import SectorStageDialog from '@/components/orders/SectorStageDialog';

interface Props {
  /** Etapa daquele setor para a OP do card (corteStage, montagemStage, …). */
  stage: OrderStage | null | undefined;
  /** Nº da OP — só pra exibir no título do diálogo. */
  orderNumber?: string;
  className?: string;
}

/**
 * Ações de apontamento de etapa DIRETO no card da tela de setor.
 *
 * Por que existe (keystone do PCP, 2026-06-25): a transição com timestamp já
 * existia (`SectorStageDialog` → `useUpdateOrderStage`, que grava
 * `status:'em_andamento' + started_at`), mas só era acessível no detalhe da OP
 * (`Orders.tsx`). As telas de setor onde o operador realmente trabalha só liam o
 * status — então `started_at` quase nunca era preenchido e os KPIs de
 * atraso/gargalo/lead-time-real (que dependem de `started_at`, ver
 * `sectorBottleneck.ts`) ficavam estruturalmente zerados. Este componente liga o
 * apontamento onde o trabalho acontece.
 *
 * - **Pendente** → "Iniciar" (1 clique: `em_andamento + started_at` pela mutation
 *   guardada, anti-corrida) E "Apontar" (dialog completo — dá pra iniciar já
 *   apontando quantidade, fluxo parcial).
 * - **Em andamento** → "Apontar": abre o `SectorStageDialog` completo
 *   (quantidade via RPC canônica + finalizar com operário obrigatório + DAG do
 *   banco). Só monta o diálogo quando aberto, pra não disparar 1 query por card.
 * - **Concluído** → nada (o card já fica verde).
 */
export function SectorStageActions({ stage, orderNumber, className }: Props) {
  const update = useUpdateOrderStage();
  const [open, setOpen] = useState(false);

  if (!stage || stage.status === 'concluido') return null;

  const start = (e: React.MouseEvent) => {
    e.stopPropagation();
    update.mutate({ id: stage.id, status: 'em_andamento', started_at: new Date().toISOString() });
  };

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
      {stage.status === 'pendente' && (
        <Button
          size="sm"
          variant="outline"
          className="h-11 min-h-11 gap-1.5 text-xs"
          onClick={start}
          disabled={update.isPending}
          title="Marcar início desta etapa (registra a hora de início para gargalo e lead time real)"
        >
          <Play className="h-3.5 w-3.5" weight="fill" /> Iniciar
        </Button>
      )}
      {/* "Apontar" também no pendente: dá pra iniciar JÁ apontando quantidade
          (fluxo parcial) pelo dialog, em vez de dois cliques separados. */}
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Apontar quantidade produzida / finalizar esta etapa"
      >
        <ClipboardText className="h-3.5 w-3.5" /> Apontar
      </Button>
      {open && (
        <SectorStageDialog stage={stage} open={open} onOpenChange={setOpen} orderNumber={orderNumber} />
      )}
    </div>
  );
}
