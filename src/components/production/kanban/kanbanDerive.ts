import type { QueueDetailRow } from '@/hooks/useProductionEngine';
import type { OrderStage } from '@/hooks/useOrderStages';

export const norm = (s: string) => (s === 'Mesa' ? 'Aviamento' : s);
export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

/**
 * Data de HOJE no fuso LOCAL — reexporta o helper canônico de `@/lib/date`.
 *
 * ⚠ Não voltar pra `new Date().toISOString().slice(0,10)`: aquilo é UTC, e em
 * São Paulo (UTC-3) já retorna o dia SEGUINTE a partir das ~21h. O cabeçalho de
 * capacidade das colunas ("hoje: 600/600 pares") passava a noite inteira
 * mostrando a grade de AMANHÃ rotulada como hoje — quem programa o turno da
 * noite decidia em cima do dia errado.
 */
export { todayISO } from '@/lib/date';

export interface KanbanCardData {
  /**
   * Identidade do CARD, não da OP: `order_id::setor`.
   *
   * ⚠ Desde os setores em paralelo (decisão do dono 06/08/2026) a mesma OP pode
   * ter mais de um card no quadro. Seleção em lote, refs de rolagem e halo de
   * pouso passaram a ser chaveados por AQUI — chavear por `order_id` fazia
   * selecionar um card marcar o irmão da coluna vizinha, e apontar num setor
   * acender o halo nos dois.
   */
  key: string;
  /** Outros setores do MESMO nível paralelo onde esta OP também tem card. */
  parallelSiblings: string[];
  q: QueueDetailRow;
  stages: OrderStage[];          // estágios da OP em ordem de fluxo
  column: string;                // setor onde o card está (R5.1)
  front: OrderStage | null;      // último setor com progresso (entrega pro column)
  delivered: number;             // pares entregues pro setor do card
  isPartial: boolean;            // amarelo (R5.3)
  columnStage: OrderStage | null;
  /**
   * Primeiro setor ANTES da coluna do card que ficou com saldo aberto — o buraco
   * que o pulo de setor deixa pra trás. `null` quando a rota até aqui está
   * íntegra. Ver `deriveCard`.
   */
  upstreamGap: { sector: string; missing: number } | null;
}

/**
 * Ordem REAL das etapas de UMA OP = `order_stages.stage_order` (a rota daquela
 * ficha), não a `sector_settings.flow_order` global.
 *
 * ⚠ Não inverter isso (auditoria 2026-07-26 contra o banco de produção): hoje
 * `sector_settings` tem Aviamento(30) ANTES de Costura(40), enquanto 229 das
 * 232 OPs têm Costura(3) antes de Aviamento(4) — e é o `stage_order` da OP que
 * o servidor valida em `apontar_producao_setor`. Ordenar pela config global
 * fazia "mover Corte Forração → Costura" enxergar Aviamento no meio do caminho
 * e FECHÁ-LO com 0 pares (setor pulado sem produção). `flow_order` só serve
 * pra ordenar as COLUNAS na tela; a rota de cada OP manda no resto.
 */
export function orderStagesByRoute(stages: OrderStage[], flowOrder: Map<string, number>): OrderStage[] {
  return [...stages].sort(
    (a, b) =>
      (a.stage_order - b.stage_order) ||
      ((flowOrder.get(norm(a.stage_name)) ?? 0) - (flowOrder.get(norm(b.stage_name)) ?? 0)),
  );
}

/**
 * UM CARD POR SETOR EM PARALELO (decisão do dono, 2026-08-06) — substitui a
 * regra de 2026-07-12 ("um card só por OP, na coluna mais avançada").
 *
 * O motor agenda setores do mesmo `parallel_group` no MESMO nível: a OP roda em
 * Corte Palmilha **e** Corte Forração no mesmo dia. O quadro era serial, então a
 * coluna do par paralelo ficava vazia mesmo com trabalho agendado — medido em
 * 06/08/2026, Corte Forração tinha 514 pares em 28 OPs e anunciava "Sem OP
 * aguardando", com o cabeçalho da própria coluna dizendo "hoje: 514/514".
 *
 * Agora cada setor não concluído do nível corrente ganha o SEU card, com o SEU
 * saldo e o SEU apontamento — que é como a fábrica de fato trabalha: duas
 * bancadas, dois trabalhos independentes.
 *
 * ⚠ Consequência aceita: a mesma OP aparece em mais de uma coluna, e o WIP por
 * setor conta o TRABALHO daquele setor, não OPs distintas. O KPI do topo segue
 * contando OPs distintas — os dois números medem coisas diferentes de propósito.
 *
 * `levelOf` mapeia setor → nível do motor (grupo paralelo resolvido pro menor
 * `flow_order` do grupo). Sem ele, cai no comportamento serial antigo.
 */
export function deriveCards(
  q: QueueDetailRow,
  stagesRaw: OrderStage[],
  flowOrder: Map<string, number>,
  levelOf?: Map<string, number>,
): KanbanCardData[] {
  const primeiro = deriveCard(q, stagesRaw, flowOrder);
  if (!primeiro || !levelOf) return primeiro ? [primeiro] : [];

  const stages = orderStagesByRoute(stagesRaw, flowOrder);
  const nivel = (s: OrderStage) => levelOf.get(norm(s.stage_name)) ?? flowOrder.get(norm(s.stage_name)) ?? 0;
  const colStage = primeiro.columnStage;
  if (!colStage) return [primeiro];

  const nivelCorrente = nivel(colStage);
  const idxCol = stages.indexOf(colStage);

  // Irmãos do mesmo nível ainda não concluídos. Só olha pra FRENTE: setor do
  // mesmo grupo que ficou pra trás sem fechar é buraco de rota (`upstreamGap`),
  // não trabalho corrente — dar card a ele reabriria etapa já ultrapassada.
  const irmaos = stages.filter((s, i) =>
    i > idxCol && s.status !== 'concluido' && nivel(s) === nivelCorrente,
  );
  if (irmaos.length === 0) return [primeiro];

  const nomes = [primeiro.column, ...irmaos.map(s => norm(s.stage_name))];
  const comIrmaos = (card: KanbanCardData): KanbanCardData => ({
    ...card,
    parallelSiblings: nomes.filter(n => n !== card.column),
  });

  return [
    comIrmaos(primeiro),
    ...irmaos.map(s => comIrmaos(buildCard(q, stages, primeiro.front, s))),
  ];
}

/**
 * Card de UM setor específico da rota. Extraído de `deriveCard` pra que os
 * setores em paralelo nasçam com exatamente a mesma matemática de entrega,
 * parcial e buraco de rota — se divergirem, o card do par paralelo mente
 * diferente do principal.
 */
function buildCard(
  q: QueueDetailRow,
  stages: OrderStage[],
  front: OrderStage | null,
  column: OrderStage,
): KanbanCardData {
  /**
   * Pares ENTREGUES pro setor do card = o que o setor de trás de fato apontou.
   *
   * ⚠ Não voltar a ler `quantity_total` quando o front está `concluido`
   * (auditoria 2026-08-06 contra o banco de produção): setor PULADO é fechado
   * com `quantity_processed = 0`, então "concluído" NÃO implica "produzido".
   * Trocar o número real (0) pelo nominal fazia o card da OP-2026-01191 anunciar
   * `288/288` no Acabamento com 180 pares cortados — e, como `delivered` batia
   * com o total, `isPartial` dava false: saía verde, sem o âmbar que existe
   * exatamente pra esse caso (R5.3). Quem programa o turno alocava gente pra
   * acabar 288 pares que não existiam.
   *
   * Setor concluído de verdade tem `quantity_processed == quantity_total`, então
   * ler o processado não muda nada no caminho normal — só para de mentir no pulo.
   */
  const delivered = !front ? 0
    : front === column ? column.quantity_processed
    : front.quantity_processed;
  const total = column.quantity_total || q.quantity;

  // Buraco deixado pra trás: primeiro setor ANTES da coluna que não fechou o
  // total. É o saldo abandonado na origem quando se pula com quantidade parcial
  // (OP-2026-01191: 108 pares nunca cortados; OP-2026-01195: 24).
  const colIdx = stages.indexOf(column);
  const gapStage = stages.slice(0, colIdx).find(s => s.quantity_processed < s.quantity_total) ?? null;
  const upstreamGap = gapStage
    ? { sector: norm(gapStage.stage_name), missing: gapStage.quantity_total - gapStage.quantity_processed }
    : null;

  return {
    key: `${q.order_id}::${norm(column.stage_name)}`,
    parallelSiblings: [],
    q, stages,
    column: norm(column.stage_name),
    front,
    delivered,
    isPartial: !!front && (delivered < total || !!upstreamGap),
    columnStage: column,
    upstreamGap,
  };
}

/**
 * Card PRINCIPAL da OP — o setor mais avançado da rota.
 *
 * Continua sendo a base de tudo: `deriveCards` deriva os irmãos em paralelo a
 * partir dele. Arrastar Corte→Costura apontando 120/300 move o card pra Costura
 * mostrando 120/300 em AMARELO — os 180 não cortados ficam implícitos no
 * contador. O card normaliza quando a entrega completa (R5.3/5.4).
 */
export function deriveCard(q: QueueDetailRow, stagesRaw: OrderStage[], flowOrder: Map<string, number>): KanbanCardData | null {
  const stages = orderStagesByRoute(stagesRaw, flowOrder);
  const hasProgress = (s: OrderStage) => s.quantity_processed > 0 || s.status === 'concluido';
  let front: OrderStage | null = null;
  for (const s of stages) if (hasProgress(s)) front = s;

  let column: OrderStage | null = null;
  if (!front) {
    column = stages.find(s => s.status !== 'concluido') ?? null;
  } else {
    const idx = stages.indexOf(front);
    column = stages.slice(idx + 1).find(s => s.status !== 'concluido') ?? null;
    if (!column) {
      // front é o último setor: parcial fica nele; completo = OP saindo do quadro
      if (front.status !== 'concluido' && front.quantity_processed < front.quantity_total) column = front;
      else return null;
    }
  }
  if (!column) return null;

  return buildCard(q, stages, front, column);
}
