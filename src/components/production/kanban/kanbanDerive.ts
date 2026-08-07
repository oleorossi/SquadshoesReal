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
  const nivel = makeNivel(flowOrder, levelOf);
  const colStage = primeiro.columnStage;
  if (!colStage) return [primeiro];

  const nivelCorrente = nivel(colStage);

  /**
   * Ganha card TODA etapa ainda aberta até o nível corrente — não só os irmãos
   * "à frente" do card mais avançado.
   *
   * ⚠ O filtro anterior era `i > idxCol` e furava no caso NORMAL de duas
   * bancadas: bastava o par paralelo receber o primeiro apontamento PARCIAL pra
   * ele virar o `front` da OP, empurrar a coluna pro nível seguinte e sumir do
   * quadro com saldo aberto — sem card em coluna nenhuma, e sem caminho pra
   * apontar os pares que faltavam (só sobrava o estorno). Contrariava a própria
   * promessa desta função ("cada setor não concluído do nível corrente ganha o
   * SEU card, com o SEU saldo").
   *
   * Etapa aberta de nível ANTERIOR também entra: é o saldo abandonado por um
   * pulo, e com a opção C ele tem bancada e trabalho de verdade — deixá-lo
   * invisível era o que criava OP em dois lugares sem ninguém ver.
   */
  const doCard = stages.filter(s => s.status !== 'concluido' && nivel(s) <= nivelCorrente);
  if (doCard.length <= 1) return [primeiro];

  // Irmão = MESMO nível. Etapa aberta de nível anterior não é paralela a nada;
  // ela aparece como card próprio, mas não se anuncia como irmã.
  const porNivel = new Map<number, string[]>();
  for (const s of doCard) {
    const n = nivel(s);
    porNivel.set(n, [...(porNivel.get(n) ?? []), norm(s.stage_name)]);
  }

  return doCard.map(s => {
    const card = buildCard(q, stages, s, nivel);
    return { ...card, parallelSiblings: (porNivel.get(nivel(s)) ?? []).filter(n => n !== card.column) };
  });
}

/**
 * Nível do motor de uma etapa, com fallback que NÃO colapsa desconhecidos.
 *
 * ⚠ Não voltar pra `?? 0`: duas etapas fora de `sector_settings` (grafia legada,
 * setor removido do cadastro — caso que o quadro suporta de propósito, R1.5)
 * caíam ambas no nível 0, viravam irmãs paralelas FALSAS e ganhavam cards
 * simultâneos em colunas que não têm nada a ver uma com a outra. O sentinela
 * derivado do `stage_order` mantém cada desconhecida no seu próprio nível.
 */
function makeNivel(flowOrder: Map<string, number>, levelOf: Map<string, number>) {
  return (s: OrderStage): number => {
    const nome = norm(s.stage_name);
    return levelOf.get(nome) ?? flowOrder.get(nome) ?? (1_000_000 + s.stage_order);
  };
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
  column: OrderStage,
  nivel?: (s: OrderStage) => number,
): KanbanCardData {
  /**
   * A MONTANTE deste card — quem de fato entrega pra ELE.
   *
   * ⚠ Com setores em paralelo, "a última etapa com progresso da OP inteira" NÃO
   * serve: quando a Costura Palmilha apontava 100, os cards de Costura Cabedal e
   * Aviamento (que são PARALELOS a ela, não posteriores) passavam a exibir
   * `100/288` em âmbar e o selo vermelho "−188 em Costura Palmilha", cujo texto
   * afirma que 188 pares nunca passaram por lá. Mentira dupla: elas recebem do
   * CORTE, que entregou o lote cheio, e a vizinha não é a montante de ninguém.
   *
   * A montante real é a última etapa de nível ESTRITAMENTE MENOR. Sem mapa de
   * níveis (caminho serial antigo), todo índice anterior vale — que é o
   * comportamento original.
   */
  const colIdx = stages.indexOf(column);
  const nivelCol = nivel ? nivel(column) : Number.POSITIVE_INFINITY;
  const aMontante = stages.filter((s, i) => i < colIdx && (!nivel || nivel(s) < nivelCol));

  const hasProgress = (s: OrderStage) => s.quantity_processed > 0 || s.status === 'concluido';
  // O próprio setor sendo trabalhado é o seu "front" — é assim que o card do
  // setor corrente mostra o que ELE já produziu (180/288), e não 0.
  const front: OrderStage | null = hasProgress(column)
    ? column
    : ([...aMontante].reverse().find(hasProgress) ?? null);

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

  // Buraco deixado pra trás: primeiro setor A MONTANTE que não fechou o total.
  // É o saldo abandonado na origem quando se pula com quantidade parcial
  // (OP-2026-01191: 108 pares nunca cortados; OP-2026-01195: 24). Só olha nível
  // menor — irmão paralelo aberto não é buraco de rota, é bancada trabalhando.
  const gapStage = aMontante.find(s => s.quantity_processed < s.quantity_total) ?? null;
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

  return buildCard(q, stages, column);
}
