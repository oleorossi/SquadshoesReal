import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import {
  ArrowLeft, ArrowRight, ArrowsInSimple, ArrowsOutSimple, CaretLeft, CaretRight, CheckSquare, Funnel, Highlighter,
  Info, Kanban as KanbanIcon, ListBullets, Package, QrCode, Stack as Layers, Warning as AlertTriangle, X,
} from '@phosphor-icons/react';
import {
  useSectorSettings, useProductionQueueDetail, useProductionScheduleGrid,
  useEnsureFreshSchedule,
} from '@/hooks/useProductionEngine';
import { useAllOrderStages, useApontarProducao, useRealtimeOrderStages } from '@/hooks/useOrderStages';
import { useCan } from '@/hooks/useAccessControl';
import { useIsAdmin } from '@/hooks/useUserManagement';
import { useReferenceThumbs } from '@/hooks/useReferenceThumbs';
import { useOrdersMaterialGate } from '@/hooks/useMaterialGate';
import { useIsCoarsePointer } from '@/hooks/use-mobile';
import { usePersistedState } from '@/hooks/usePersistedState';
import { searchMatchesAllTerms, searchMatchesAny, splitSearchTerms, normalizeForSearch } from '@/lib/searchUtils';
import { thumbUrl } from '@/lib/imageThumb';
import { toast } from 'sonner';
import { deriveCards, todayISO, KanbanCardData, norm, fmtDate } from '@/components/production/kanban/kanbanDerive';
import {
  readKanbanSortMode,
  sortKanbanColumnCards,
  writeKanbanSortMode,
  type KanbanSortMode,
} from '@/components/production/kanban/kanbanSort';
import { buildPointingPlan } from '@/components/production/kanban/pointingPlan';
import {
  addUniqueOrderCards,
  buildBulkMoveBatch,
  pruneSelectedCardKeys,
  toggleUniqueOrderCard,
  uniqueCardsByOrder,
} from '@/components/production/kanban/bulkMovePlan';
import {
  cardCommercialPrimary,
  countsForConstraint,
  filterCardsForChao,
  filterCardsForFila,
  type KanbanBoardMode,
} from '@/components/production/kanban/kanbanQueueSplit';
import { KanbanOpCard } from '@/components/production/kanban/KanbanOpCard';
import { DropApontarDialog } from '@/components/production/kanban/DropApontarDialog';
import { BulkMoveDialog } from '@/components/production/kanban/BulkMoveDialog';
import { QrScanDialog } from '@/components/production/kanban/QrScanDialog';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Limite saudável de OPs acumuladas num setor antes de sinalizar gargalo. */
const WIP_LIMIT = 20;

/**
 * Tom da barra de capacidade do setor: verde <80%, âmbar 80–100%, vermelho >100%.
 *
 * ⚠ O percentual vem de `utilization` — a fração do dia que o MOTOR de fato
 * consumiu (1.0 = dia cheio) —, não de `planned_pairs / daily_capacity_pairs`.
 * O tipo `ScheduleGridCell` avisa isso explicitamente ("comparar por AQUI").
 * Motivo: quando a ficha técnica define a capacidade da OP (`ficha_override`),
 * o ritmo real do dia não é o global do setor. Um setor com 300 pares agendados
 * contra um global de 600 parecia 50% (verde) enquanto rodava a 100% do dia
 * porque as fichas daquele mix produzem 300/dia — e o gestor movia gente pro
 * gargalo errado.
 */
function capacityTone(utilization: number): { pct: number; bar: string; text: string } {
  const pct = Math.round((utilization || 0) * 100);
  if (pct > 100) return { pct, bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };
  if (pct >= 80) return { pct, bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' };
  return { pct, bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' };
}

/**
 * CENTRAL DE PRODUÇÃO — o quadro de OPs por setor. Uma implementação só, duas
 * molduras:
 *
 *  • `embedded={false}` (rota `/producao/kanban/gestao`): tela cheia SEM a casca
 *    do ERP, relógio, KPIs, botão de fullscreen. Pro analista deixar num monitor
 *    o dia inteiro.
 *  • `embedded` (rota `/producao/kanban`, dentro do AppLayout): mesmo quadro,
 *    sem a moldura de sala de controle.
 *
 * Abas Chão / Fila: só `em_producao` entra nas colunas; `na_fila` (reservadas)
 * vive na lista da Fila até o 1º apontamento promover a OP.
 *
 * ⚠ Antes existiam DOIS componentes. O do menu (`ProducaoKanban.tsx`, 187
 * linhas) era uma versão pobre do mesmo quadro. Não recriar o segundo:
 * adicionar feature aqui e, se precisar, esconder por `embedded`.
 */
export default function ProducaoKanbanGestao({ embedded = false }: { embedded?: boolean } = {}) {
  useEnsureFreshSchedule();
  useRealtimeOrderStages();
  const {
    data: sectors = [], isLoading: sectorsLoading, isError: sectorsError,
    error: sectorsErrObj, refetch: refetchSectors,
  } = useSectorSettings();
  // ⚠ `isError` NÃO é decorativo aqui. Sem ele, falha de rede/RLS caía no
  // default `[]` e o quadro dizia "Nenhuma OP em produção" — indistinguível de
  // fábrica vazia. No chão de fábrica isso vira "não tem o que fazer hoje".
  const {
    data: queue = [], isLoading: queueLoading, isError: queueError,
    error: queueErrObj, refetch: refetchQueue, dataUpdatedAt: queueUpdatedAt,
  } = useProductionQueueDetail();
  const orderIds = useMemo(() => queue.map(q => q.order_id), [queue]);
  const {
    data: allStages = [], isLoading: stagesLoading, isError: stagesError,
    error: stagesErrObj, refetch: refetchStages, dataUpdatedAt: stagesUpdatedAt,
  } = useAllOrderStages(orderIds);
  // ⚠ MESMO raciocínio das duas queries acima, pras duas consultas de APOIO:
  // sem `isError` a agenda do dia caía em `[]` e o cabeçalho da coluna dizia
  // "hoje: 0" (lido como "capacidade zerada"), e o gate de material caía em
  // `undefined` fazendo "0 OPs travadas" — a faixa azul sumia inteira. Nos dois
  // casos "não consegui buscar" virava um zero legítimo na tela. O erro agora
  // aparece na faixa de fluxo e o "hoje:" sai como "—", não como 0.
  const { data: todayGrid = [], isError: gridError } = useProductionScheduleGrid(todayISO(), todayISO());
  // Foto da referência: a view manda reference_photo_url vazio (ver o hook)
  const { data: refThumbs } = useReferenceThumbs(queue.map(q => q.reference_id));
  // Gate de material (auditoria Crítico #1): OP sem matéria-prima pra arrancar.
  const { data: gateMap, isError: gateError } = useOrdersMaterialGate(orderIds);
  const apontar = useApontarProducao();
  const canEdit = useCan('/producao/kanban').canEdit;
  const isAdmin = useIsAdmin();
  const planOptions = useMemo(() => ({ allowParallelSkip: isAdmin }), [isAdmin]);
  // Touch (celular E iPad): sem autofocus (o teclado pularia na cara ao abrir)
  // e sem drag HTML5 confiável — o select "Mover para" do diálogo cobre.
  const coarsePointer = useIsCoarsePointer();
  // iPhone não tem Fullscreen API pra elementos (só vídeo) — esconde o botão.
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;

  const [search, setSearch] = useState('');
  // PADRÃO 'filtrar' (decisão do dono 2026-07-26): buscar deve deixar no quadro
  // SÓ as OPs que casam — inclusive escondendo os setores que ficaram vazios,
  // senão no celular se navega por telas em branco. 'destacar' (anel + resto
  // esmaecido, quadro inteiro visível) fica como opção, e a escolha persiste.
  const [viewMode, setViewMode] = usePersistedState<'destacar' | 'filtrar'>('kanban-gestao-view-mode', 'filtrar');
  const [boardMode, setBoardMode] = usePersistedState<KanbanBoardMode>('kanban-gestao-board-mode', 'chao');
  const [sortMode, setSortMode] = useState<KanbanSortMode>(() => readKanbanSortMode());
  const setSortModePersist = (mode: KanbanSortMode) => {
    setSortMode(mode);
    writeKanbanSortMode(mode);
  };

  const { data: soleByRefColor } = useQuery({
    queryKey: ['kanban-sole-color-keys'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheet_sole_colors')
        .select('sheet_id, product_color, sole_product_id');
      if (error) throw error;
      const m = new Map<string, string>();
      for (const row of data || []) {
        const color = String((row as { product_color?: string }).product_color || '')
          .trim()
          .toLocaleUpperCase('pt-BR');
        const sheetId = (row as { sheet_id: string }).sheet_id;
        const soleId = (row as { sole_product_id?: string | null }).sole_product_id;
        if (sheetId && soleId) m.set(`${sheetId}::${color}`, soleId);
      }
      return m;
    },
  });
  const [scanOpen, setScanOpen] = useState(false);
  const [dragCard, setDragCard] = useState<KanbanCardData | null>(null);
  const [dropTarget, setDropTarget] = useState<{ card: KanbanCardData; target: string } | null>(null);
  const [detailStage, setDetailStage] = useState<{ card: KanbanCardData } | null>(null);
  // Seleção múltipla → mover várias OPs de setor preenchendo uma por uma
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  // Snapshot do lote: o primeiro apontamento muda o setor e, portanto, a chave
  // do card no realtime. Manter os cards aqui impede o wizard de desmontar no
  // meio da distribuição quando a seleção viva deixa de casar com o quadro.
  const [bulkRequest, setBulkRequest] = useState<{
    cards: KanbanCardData[];
    target: string;
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [activeSector, setActiveSector] = useState('');
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const boardEl = useRef<HTMLDivElement | null>(null);
  const sectorNavEl = useRef<HTMLDivElement | null>(null);
  const boardScrollRaf = useRef(0);
  // Coluna sob o card arrastado (contorno respirando) e OP que acabou de ser
  // apontada (halo de pouso). Ambos são transitórios — nada fica piscando.
  const [dragOverSector, setDragOverSector] = useState<string | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);
  /** Hover/foco num card → realça irmãos paralelos da mesma OP. */
  const [hoverOrderId, setHoverOrderId] = useState<string | null>(null);

  // ⚠ Nada de document.title na mão aqui: o EditorialPageHeader (renderizado
  // logo abaixo, só quando `!embedded`) já grava `${title} · Squad Shoes` e
  // restaura o anterior ao desmontar. Dois donos do mesmo título brigam — o
  // último efeito a rodar vence e o restore devolve o valor errado.

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* noop */ });
    else document.documentElement.requestFullscreen().catch(() => toast.error('Tela cheia indisponível neste navegador.'));
  };

  const flowOrder = useMemo(() => new Map(sectors.map(s => [s.sector, s.flow_order])), [sectors]);
  /**
   * Nível do MOTOR por setor. Setores do mesmo `parallel_group` colapsam no
   * menor `flow_order` do grupo — é exatamente o `COALESCE(g.grp_order,
   * ss.flow_order)` de `recompute_production_schedule`. Espelhar o servidor
   * aqui é o que faz o quadro concordar com a agenda: hoje Corte Palmilha +
   * Corte Forração são um nível, e Acabamento Palmilha + Costura Cabedal +
   * Aviamento são outro.
   */
  const levelOf = useMemo(() => {
    const grpMin = new Map<string, number>();
    for (const s of sectors) {
      if (!s.parallel_group) continue;
      const cur = grpMin.get(s.parallel_group);
      if (cur === undefined || s.flow_order < cur) grpMin.set(s.parallel_group, s.flow_order);
    }
    return new Map(sectors.map(s => [
      s.sector,
      (s.parallel_group ? grpMin.get(s.parallel_group) : undefined) ?? s.flow_order,
    ]));
  }, [sectors]);
  const stagesByOrder = useMemo(() => {
    const m = new Map<string, typeof allStages>();
    allStages.forEach(s => {
      const arr = m.get(s.order_id) || [];
      arr.push(s);
      m.set(s.order_id, arr);
    });
    return m;
  }, [allStages]);

  // Derivação completa (chão + fila) — o filtro por aba vem depois.
  const derivedCards = useMemo(() => {
    const out: KanbanCardData[] = [];
    for (const q of queue) {
      const stages = stagesByOrder.get(q.order_id);
      if (!stages?.length) continue;
      out.push(...deriveCards(q, stages, flowOrder, levelOf));
    }
    return out;
  }, [queue, stagesByOrder, flowOrder, levelOf]);

  const boardCards = useMemo(() => filterCardsForChao(derivedCards), [derivedCards]);
  const filaCards = useMemo(
    () => uniqueCardsByOrder(filterCardsForFila(derivedCards)),
    [derivedCards],
  );
  /** Universo ativo da aba: colunas = chão; lista = fila. */
  const allCards = boardMode === 'chao' ? boardCards : filaCards;

  const parallelGroupOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sectors) {
      if (s.parallel_group) m.set(s.sector, s.parallel_group);
    }
    return m;
  }, [sectors]);
  const parallelGroupSize = useMemo(() => {
    const counts = new Map<string, number>();
    for (const grp of parallelGroupOf.values()) {
      counts.set(grp, (counts.get(grp) || 0) + 1);
    }
    return counts;
  }, [parallelGroupOf]);

  const searchActive = search.trim().length > 0;

  // QR da ficha de operador = lista de PVs separada por vírgula ("PV-00141,
  // PV-00142"). A busca padrão é AND entre termos (nenhuma OP tem dois PVs),
  // então payload de scan vira OR: acha QUALQUER OP dos PVs bipados. Digitação
  // normal (1 termo, ou termos que não são todos PV) segue o AND do sistema.
  const scanTerms = useMemo(() => {
    const terms = splitSearchTerms(search);
    return terms.length >= 2 && terms.every(t => normalizeForSearch(t).startsWith('pv')) ? terms : null;
  }, [search]);

  const matchedIds = useMemo(() => {
    if (!searchActive) return null;
    const s = new Set<string>();
    for (const c of allCards) {
      const q = c.q;
      // Cliente entra pelos TRÊS nomes (mig `20261101120000`): razão social,
      // nome fantasia e grupo econômico. Medido em 01/08/2026 com 22 dos 27
      // clientes do quadro em grupo — só a razão social achava 8 das 27 lojas
      // do grupo Raquel Calçados e NENHUMA das 4 de VIVIAN FERREIRA (a razão
      // social "ALCINEU DE MADUREIRA CALCADOS" não tem letra em comum com o
      // nome do grupo). A fantasia cobre o nome pelo qual a fábrica chama a
      // loja ("LOJAS NALIN" para "LNG 10 CONFECCOES LTDA").
      const hit = scanTerms
        ? scanTerms.some(t => searchMatchesAny(t, q.sale_order_number))
        : searchMatchesAllTerms(
            search,
            q.order_number, q.reference_name, q.color,
            q.client_name, q.client_fantasia, q.client_group_name,
            q.sale_order_number,
          );
      if (hit) s.add(q.order_id);
    }
    return s;
  }, [searchActive, scanTerms, search, allCards]);

  const matches = useMemo(
    () => (matchedIds ? allCards.filter(c => matchedIds.has(c.q.order_id)) : []),
    [matchedIds, allCards],
  );
  // Setores paralelos podem renderizar mais de um card da mesma OP. Busca e
  // seleção comunicam OPs, então a contagem e o "selecionar encontradas" usam
  // uma ocorrência por order_id — o resumo por setor abaixo continua contando
  // cards, porque ali cada bancada é uma ocorrência real.
  const matchedOrders = useMemo(() => uniqueCardsByOrder(matches), [matches]);

  // Onde as OPs achadas estão, agrupadas por setor e na ordem do fluxo — é o
  // mapa que a faixa de resultados mostra (um botão por setor).
  const matchSummary = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of matches) n.set(c.column, (n.get(c.column) || 0) + 1);
    return [...n.entries()]
      .map(([sector, count]) => ({ sector, n: count }))
      .sort((a, b) => (flowOrder.get(a.sector) ?? 999) - (flowOrder.get(b.sector) ?? 999));
  }, [matches, flowOrder]);

  // Achou → leva o olho até o card (a coluna certa pode estar fora da viewport)
  useEffect(() => {
    if (!matches.length) return;
    const el = cardEls.current.get(matches[0].key);
    if (!el) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const t = setTimeout(() => el.scrollIntoView({ behavior, block: 'center', inline: 'center' }), 150);
    return () => clearTimeout(t);
  }, [matches]);

  // Colunas: setores ativos na ordem do fluxo + qualquer setor que apareça como
  // coluna de um card do CHÃO (setor desligado globalmente mas presente via ficha)
  const columns = useMemo(() => {
    const active = sectors.filter(s => s.enabled).map(s => s.sector);
    const extra = [...new Set(boardCards.map(c => c.column))].filter(s => !active.includes(s));
    return [...active, ...extra].sort((a, b) => (flowOrder.get(a) ?? 999) - (flowOrder.get(b) ?? 999));
  }, [sectors, boardCards, flowOrder]);

  const gridToday = useMemo(() => new Map(todayGrid.map(g => [g.sector, g])), [todayGrid]);

  /**
   * KPIs do topo contam OPs DISTINTAS, não cards.
   *
   * ⚠ Desde os setores em paralelo a mesma OP tem card em mais de uma coluna.
   * Somar cards aqui contaria a OP (e os pares dela) duas vezes — é o mesmo
   * erro de dupla contagem que a auditoria tirou do 'restam N pares'. O WIP por
   * setor, esse sim, conta CARDS: lá a pergunta é 'quanto trabalho tem nesta
   * bancada', e as duas bancadas têm trabalho de verdade.
   */
  const kpis = useMemo(() => {
    const porOp = new Map<string, KanbanCardData>();
    for (const c of allCards) if (!porOp.has(c.q.order_id)) porOp.set(c.q.order_id, c);
    const ops = [...porOp.values()];
    return {
      ops: ops.length,
      pares: ops.reduce((s, c) => s + (c.q.quantity || 0), 0),
      atrasadas: ops.filter(c => c.q.late_days > 0).length,
      parciais: new Set(allCards.filter(c => c.isPartial).map(c => c.q.order_id)).size,
    };
  }, [allCards]);

  const filaCount = useMemo(
    () => new Set(filaCards.map(c => c.q.order_id)).size,
    [filaCards],
  );
  const chaoCount = useMemo(
    () => new Set(boardCards.map(c => c.q.order_id)).size,
    [boardCards],
  );

  const filaSorted = useMemo(() => {
    return [...filaCards].sort((a, b) => {
      const late = (b.q.late_days || 0) - (a.q.late_days || 0);
      if (late !== 0) return late;
      const da = a.q.due_date || '9999-99-99';
      const db = b.q.due_date || '9999-99-99';
      return da.localeCompare(db) || a.q.order_number.localeCompare(b.q.order_number);
    });
  }, [filaCards]);

  // WIP por setor + gargalo — SÓ no chão (reservadas não entram no quadro).
  const wipBySector = useMemo(() => {
    const m = new Map<string, number>();
    if (boardMode !== 'chao') return m;
    for (const c of boardCards) {
      if (!countsForConstraint(c)) continue;
      m.set(c.column, (m.get(c.column) || 0) + 1);
    }
    return m;
  }, [boardCards, boardMode]);
  const constraintSector = useMemo(() => {
    let best: string | null = null, max = WIP_LIMIT;
    for (const [s, n] of wipBySector) if (n > max) { max = n; best = s; }
    return best;
  }, [wipBySector]);
  /**
   * Setores REALMENTE ociosos abaixo do gargalo.
   *
   * ⚠ Coluna vazia não é setor parado. Setores do mesmo `parallel_group` rodam
   * no mesmo nível do motor (Corte Palmilha + Corte Forração; Acabamento Palmilha +
   * Costura Cabedal + Aviamento), mas o quadro é serial — UM card por OP, na
   * coluna mais avançada (decisão do dono, entrevista 2026-07-12) —, então o par
   * paralelo fica sem card enquanto o primeiro do grupo não fecha.
   *
   * Medido em 06/08/2026: Corte Forração tinha 514 pares em 28 OPs agendados
   * PRA HOJE, coluna vazia, e a faixa anunciava "9 setores ociosos abaixo" —
   * incluindo o segundo setor mais carregado do dia. O gestor lia isso e movia
   * gente PARA FORA de um setor com o dia cheio. Agora quem tem pares agendados
   * hoje não conta como ocioso.
   */
  const idleBelowConstraint = useMemo(() => {
    if (!constraintSector) return 0;
    const cOrder = flowOrder.get(constraintSector) ?? 999;
    return columns.filter(s =>
      (flowOrder.get(s) ?? 999) > cOrder
      && !wipBySector.has(s)
      && (gridToday.get(s)?.planned_pairs ?? 0) === 0,
    ).length;
  }, [constraintSector, columns, flowOrder, wipBySector, gridToday]);

  // OPs travadas por material: quantas e a data mais tardia em que o material
  // tem como chegar. É o que separa "atrasado porque a fábrica não deu conta"
  // de "atrasado porque a matéria-prima não está aqui" — decisões diferentes.
  const travadasMaterial = useMemo(() => {
    if (!gateMap || gateMap.size === 0) return { n: 0, pior: null as string | null };
    const vistas = new Set<string>();
    let pior: string | null = null;
    for (const c of boardCards) {
      const g = gateMap.get(c.q.order_id);
      if (!g || vistas.has(c.q.order_id)) continue;
      vistas.add(c.q.order_id);
      if (!pior || g.ready_date > pior) pior = g.ready_date;
    }
    return { n: vistas.size, pior };
  }, [gateMap, boardCards]);

  // Busca ativa em modo filtrar: dentro da coluna ficam SÓ os cards que casaram.
  const filtering = viewMode === 'filtrar' && !!matchedIds;

  /**
   * Setores com ao menos uma OP da busca.
   *
   * ⚠ Filtrar CARD e esconder COLUNA eram a mesma decisão até 02/08/2026, e
   * isso quebrava o gesto principal do quadro: buscar uma referência e ARRASTAR
   * a OP pro próximo setor. Some com o destino, some com o arraste. Agora as
   * duas coisas são independentes — o setor sem match continua no quadro (como
   * trilho fino, ver `isRail` no render) e segue sendo alvo de soltar.
   *
   * No CELULAR o setor sem match continua saindo (decisão do dono 26/07/2026:
   * cada coluna ocupa uma tela e passar por 9 vazias é ruído puro) — mas isso
   * é feito por CSS (`hidden md:flex`), não aqui, pra não precisar medir
   * viewport em JS nem duplicar a lista de colunas.
   */
  const matchedColumns = useMemo(() => {
    if (!filtering || !matchedIds) return null;
    const s = new Set<string>();
    for (const c of allCards) if (matchedIds.has(c.q.order_id)) s.add(c.column);
    return s;
  }, [filtering, matchedIds, allCards]);

  /**
   * TRILHO DO FLUXO — navegação curta entre as colunas do quadro.
   *
   * No celular cada coluna ocupa quase a viewport; sem um índice, chegar ao
   * décimo setor exigia nove swipes sem nenhuma noção de distância. No desktop
   * o trilho também evita arrastar a barra horizontal até achar um setor.
   * Durante uma busca filtrada ele lista só os setores que continuam visíveis
   * no celular, espelhando a regra `hidden md:flex` das colunas sem resultado.
   */
  const navigableColumns = useMemo(
    () => (filtering && matchedColumns
      ? columns.filter(sector => matchedColumns.has(sector))
      : columns),
    [columns, filtering, matchedColumns],
  );
  const navigableColumnSet = useMemo(() => new Set(navigableColumns), [navigableColumns]);

  const navCountBySector = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of allCards) {
      if (filtering && matchedIds && !matchedIds.has(card.q.order_id)) continue;
      counts.set(card.column, (counts.get(card.column) || 0) + 1);
    }
    return counts;
  }, [allCards, filtering, matchedIds]);

  const scrollToSector = useCallback((sector: string) => {
    const board = boardEl.current;
    const column = board?.querySelector<HTMLElement>(`[data-kb-col="${CSS.escape(sector)}"]`);
    if (!board || !column || column.offsetParent === null) return;
    // `offsetLeft` não é necessariamente relativo ao quadro (na versão
    // embedded o offsetParent pode ser a casca do ERP). Medir os dois retângulos
    // preserva o centro correto nas duas molduras e em qualquer breakpoint.
    const boardRect = board.getBoundingClientRect();
    const columnRect = column.getBoundingClientRect();
    const target = board.scrollLeft
      + columnRect.left
      - boardRect.left
      - Math.max((board.clientWidth - columnRect.width) / 2, 0);
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    board.scrollTo({ left: target, behavior });
    setActiveSector(sector);
  }, []);

  const syncActiveSector = useCallback(() => {
    cancelAnimationFrame(boardScrollRaf.current);
    boardScrollRaf.current = requestAnimationFrame(() => {
      const board = boardEl.current;
      if (!board) return;
      const center = board.getBoundingClientRect().left + board.clientWidth / 2;
      let nearest: { sector: string; distance: number } | null = null;
      board.querySelectorAll<HTMLElement>('[data-kb-col]').forEach(column => {
        if (column.offsetParent === null) return;
        const rect = column.getBoundingClientRect();
        const distance = Math.abs(rect.left + rect.width / 2 - center);
        const sector = column.dataset.kbCol;
        if (sector && navigableColumnSet.has(sector) && (!nearest || distance < nearest.distance)) {
          nearest = { sector, distance };
        }
      });
      if (nearest) setActiveSector(nearest.sector);
    });
  }, [navigableColumnSet]);

  useEffect(() => () => cancelAnimationFrame(boardScrollRaf.current), []);

  useEffect(() => {
    setActiveSector(current => (
      current && navigableColumns.includes(current) ? current : navigableColumns[0] || ''
    ));
  }, [navigableColumns]);

  useEffect(() => {
    if (!activeSector) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    sectorNavEl.current
      ?.querySelector<HTMLElement>(`[data-kb-nav="${CSS.escape(activeSector)}"]`)
      ?.scrollIntoView({ behavior, block: 'nearest', inline: 'nearest' });
  }, [activeSector]);

  const activeSectorIndex = Math.max(navigableColumns.indexOf(activeSector), 0);
  const goToAdjacentSector = (direction: -1 | 1) => {
    const target = navigableColumns[activeSectorIndex + direction];
    if (target) scrollToSector(target);
  };

  const selectedCards = useMemo(
    () => uniqueCardsByOrder(allCards.filter(c => selectedIds.has(c.key))),
    [allCards, selectedIds],
  );
  const selectedPares = useMemo(
    () => selectedCards.reduce((s, c) => s + (c.q.quantity || 0), 0),
    [selectedCards],
  );
  const selectedOrigins = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of selectedCards) counts.set(card.column, (counts.get(card.column) || 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => (flowOrder.get(a[0]) ?? 999) - (flowOrder.get(b[0]) ?? 999))
      .map(([sector, count]) => `${sector}: ${count}`);
  }, [selectedCards, flowOrder]);

  // O realtime troca `order_id::setor` assim que uma OP avança. Sem esta poda,
  // a barra mantinha uma seleção invisível e habilitava ações com payload vazio.
  useEffect(() => {
    setSelectedIds(previous => pruneSelectedCardKeys(previous, allCards));
  }, [allCards]);

  const toggleSelect = (card: KanbanCardData) => {
    setSelectedIds(previous => toggleUniqueOrderCard(previous, allCards, card));
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkTarget('');
  };

  /**
   * A OP pode ir pra este setor? Reusa a MESMA regra do apontamento
   * (`buildPointingPlan`) que o diálogo aplica ao soltar — assim o realce da
   * coluna nunca promete um destino que o diálogo vai recusar.
   */
  const dropEligibility = useCallback((card: KanbanCardData, target: string): {
    ok: boolean; kind: 'frente' | 'pulo' | 'estorno'; reason?: string;
  } => {
    const plan = buildPointingPlan(card, target, flowOrder, levelOf, planOptions);
    if (!plan.available) return { ok: false, kind: 'frente', reason: plan.unavailableReason };
    if (plan.isBackward) return { ok: true, kind: 'estorno' };
    return { ok: true, kind: plan.skipped.length > 0 ? 'pulo' : 'frente' };
  }, [flowOrder, levelOf, planOptions]);

  /**
   * Elegibilidade do card EM ARRASTE por setor, calculada uma vez por arraste.
   *
   * O render pedia isto 3× por coluna (borda, tom e `aria-dropeffect`) e cada
   * chamada remonta a rota da OP — 11 setores × 3 = 33 `buildPointingPlan` a
   * cada coluna cruzada, sempre com a MESMA resposta enquanto o card na mão não
   * muda. Agora é um mapa por arraste.
   */
  const dragEligibilityBySector = useMemo(() => {
    if (!dragCard) return null;
    const m = new Map<string, ReturnType<typeof dropEligibility>>();
    for (const sector of columns) m.set(sector, dropEligibility(dragCard, sector));
    return m;
  }, [dragCard, columns, dropEligibility]);

  /**
   * Prévia por destino da seleção em lote. Usa o mesmo planejador que o
   * diálogo, inclusive para destino igual à origem e etapas fora da rota.
   */
  const bulkDestinations = useMemo(() => columns.map(sector => {
    const batch = buildBulkMoveBatch(selectedCards, sector, flowOrder, levelOf, planOptions);
    return {
      sector,
      eligible: batch.steps.length,
      blocked: batch.blocked.length,
    };
  }), [columns, selectedCards, flowOrder, levelOf, planOptions]);
  const selectedDestination = bulkDestinations.find(item => item.sector === bulkTarget) || null;
  const canReviewBulk = selectedCards.length > 0 && !!bulkTarget && !!selectedDestination?.eligible;

  const openBulkReview = () => {
    if (!canReviewBulk) return;
    setBulkRequest({ cards: selectedCards, target: bulkTarget });
  };

  const handleDrop = (target: string) => {
    if (!dragCard) return;
    const card = dragCard;
    setDragCard(null);
    if (norm(target) === norm(card.column)) return;
    // Destino impossível: avisa NA HORA em vez de abrir um diálogo só pra dizer
    // que não dá.
    const elig = dropEligibility(card, target);
    if (!elig.ok) {
      toast.error(elig.reason || `${card.q.order_number} não pode ir pra ${target}.`);
      return;
    }
    setDropTarget({ card, target });
  };

  const handleScan = (raw: string) => {
    setScanOpen(false);
    const payload = raw.trim();
    if (!payload) return;
    setSearch(payload);
    toast.success(`QR lido: ${payload}`);
  };

  const isLoading = sectorsLoading || queueLoading || stagesLoading;
  const loadError = sectorsError || queueError || stagesError;
  const loadErrorMsg = (queueErrObj as Error | null)?.message
    || (stagesErrObj as Error | null)?.message
    || (sectorsErrObj as Error | null)?.message
    || 'Falha ao consultar o servidor.';
  const retryLoad = () => { void refetchSectors(); void refetchQueue(); void refetchStages(); };

  /**
   * SELO DE FRESCOR — substitui o relógio nu.
   *
   * ⚠ O relógio andava sozinho, independente dos dados: quadro congelado ficava
   * visualmente IDÊNTICO a quadro vivo (ponteiro andando, cards nas colunas,
   * barras coloridas). E "parado" é o estado normal aqui — a produção aponta em
   * rajadas curtas (em 14 dias medidos, apontamento em 7; num dia inteiro, zero
   * até as 9h22). Sem o selo ninguém distingue "a fábrica não apontou" de
   * "a conexão morreu". Agora a hora exibida é a do ÚLTIMO DADO que chegou.
   */
  /**
   * ⚠ O selo tem que olhar o MAIS ANTIGO das duas fontes, não só a fila.
   *
   * A fila tem piso de atualização de 90s; `order_stages` — de onde vêm os
   * PARES de cada card — depende só do realtime. Se o canal morrer em silêncio
   * (degradação do Realtime, timeout de proxy) sem emitir CHANNEL_ERROR nem
   * disparar `online`, o HTTP segue vivo: a fila continua fresca, o selo
   * continua cinza dizendo "atualizado agora", e os números dos cards ficam
   * congelados há horas. Era exatamente o modo de falha que o selo existe pra
   * expor, e ele ficava invisível.
   */
  const frescorMs = Math.min(queueUpdatedAt || 0, stagesUpdatedAt || 0) || queueUpdatedAt;
  const updatedAt = frescorMs ? new Date(frescorMs) : null;
  const staleMin = updatedAt ? Math.floor((now.getTime() - updatedAt.getTime()) / 60_000) : null;
  const stale = staleMin !== null && staleMin >= 5;
  const updatedLabel = updatedAt
    ? updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';

  /** Máscaras de topo/pé da coluna: aparecem só quando há mais OP naquele
   *  sentido. É o aviso de "esta lista rola" antes de alguém tentar. */
  const syncColumnFade = (list: HTMLElement | null) => {
    const wrap = list?.parentElement;
    if (!list || !wrap) return;
    const more = list.scrollHeight - list.clientHeight;
    wrap.dataset.moreUp = list.scrollTop > 2 ? '1' : '0';
    wrap.dataset.moreDown = more > 2 && list.scrollTop < more - 2 ? '1' : '0';
  };

  useEffect(() => {
    boardEl.current?.querySelectorAll<HTMLElement>('[data-kb-list]').forEach(syncColumnFade);
  }, [columns, allCards.length, matchedIds]);

  /**
   * A RODA DO MOUSE PERTENCE À COLUNA SOB O CURSOR — nunca à página.
   *
   * As colunas já tinham `overflow-y-auto`, mas sem `overscroll-behavior` o
   * scroll ENCADEIA assim que a coluna chega ao fim: vai pro quadro
   * (`overflow-x-auto`) e daí pro documento — era isso que fazia "a página"
   * subir/descer em vez das OPs. O `overscroll-contain` no JSX corta o
   * encadeamento; este handler cobre o resto: ponteiro no cabeçalho da coluna,
   * em coluna vazia, ou em coluna que não rola (aí NADA se mexe, em vez de o
   * quadro andar de lado). Panorâmica horizontal segue em Shift+roda, trackpad
   * horizontal ou arraste.
   *
   * ⚠ Listener NATIVO, não `onWheel`: o React registra `wheel` como PASSIVE no
   *   root, e `preventDefault()` em listener passivo é no-op silencioso.
   */
  useEffect(() => {
    const board = boardEl.current;
    if (!board) return;
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const list = (e.target as HTMLElement | null)
        ?.closest?.('[data-kb-col]')
        ?.querySelector<HTMLElement>('[data-kb-list]');
      e.preventDefault();
      if (list && list.scrollHeight - list.clientHeight > 1) {
        list.scrollTop += e.deltaY;
        syncColumnFade(list);
      }
    };
    board.addEventListener('wheel', onWheel, { passive: false });
    return () => board.removeEventListener('wheel', onWheel);
  }, [isLoading, allCards.length, columns.length]);

  /**
   * AUTO-ROLAGEM NA BORDA DURANTE O ARRASTE.
   *
   * São 11 setores ativos a `min-w-[185px]` = 2035px de quadro — sempre mais
   * largo que a tela. Sem isto, arrastar pra um setor fora da viewport era
   * IMPOSSÍVEL: o arraste HTML5 não emite `wheel`, e o handler acima ainda
   * chama `preventDefault()` e joga a rolagem pra dentro da coluna. Ou seja,
   * manter todos os setores no quadro só entrega o gesto junto com isto.
   *
   * Segurar o card na faixa de `EDGE_PX` de cada borda rola o quadro; a
   * velocidade cresce conforme chega na borda (0 → `MAX_SPEED` px/frame), pra
   * dar controle fino perto do alvo e travessia rápida quando o destino está
   * longe. O rAF só existe enquanto há card na mão.
   */
  useEffect(() => {
    const board = boardEl.current;
    if (!board || !dragCard) return;
    const EDGE_PX = 72;
    const MAX_SPEED = 22;
    let raf = 0;
    let speed = 0;

    const step = () => {
      if (speed !== 0) board.scrollLeft += speed;
      raf = requestAnimationFrame(step);
    };
    const onDragOver = (e: DragEvent) => {
      const r = board.getBoundingClientRect();
      const fromLeft = e.clientX - r.left;
      const fromRight = r.right - e.clientX;
      if (fromLeft < EDGE_PX) speed = -MAX_SPEED * (1 - Math.max(fromLeft, 0) / EDGE_PX);
      else if (fromRight < EDGE_PX) speed = MAX_SPEED * (1 - Math.max(fromRight, 0) / EDGE_PX);
      else speed = 0;
    };
    const stop = () => { speed = 0; };

    board.addEventListener('dragover', onDragOver);
    board.addEventListener('dragleave', stop);
    board.addEventListener('drop', stop);
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      board.removeEventListener('dragover', onDragOver);
      board.removeEventListener('dragleave', stop);
      board.removeEventListener('drop', stop);
    };
  }, [dragCard]);

  /** Apontou → a OP ganha halo de pouso na coluna nova por ~1,6s.
   *  Se veio da Fila, troca pra aba Chão pra o gestor ver o card pousar. */
  const markLanded = (orderId: string) => {
    setLandedId(orderId);
    window.setTimeout(() => setLandedId(cur => (cur === orderId ? null : cur)), 1600);
    if (boardMode === 'fila') setBoardMode('chao');
  };

  // Na rota dedicada este componente É o conteúdo principal da página. Dentro
  // do ERP ele vira section, evitando um <main> aninhado no <main> do AppLayout.
  const Root = embedded ? 'section' : 'main';

  return (
    // h-dvh (não h-screen/100vh): no Safari iOS o vh inclui a área da barra de
    // endereço e cortava o rodapé das colunas. Embutido no ERP a altura é
    // limitada pelo AppLayout — usar h-dvh aqui empurraria o rodapé pra fora.
    // O desconto inclui topbar/breadcrumb, paddings e o EditorialPageHeader que
    // vivem FORA deste componente. O valor anterior (11rem) ignorava parte
    // dessa casca e criava duas rolagens verticais concorrendo no desktop.
    <Root
      aria-label={embedded ? 'Quadro Kanban de produção' : 'Modo Gestão do Kanban'}
      data-kanban-mode={embedded ? 'erp' : 'gestao'}
      className={`flex flex-col overflow-hidden bg-background text-foreground ${
      embedded
        ? 'h-[calc(100dvh-17rem)] min-h-[28rem] md:h-[calc(100dvh-15rem)] md:min-h-[34rem]'
        : 'h-dvh'
      }`}
    >
      {/* ── Cabeçalho editorial (só na rota dedicada) ────────────────────
          Substitui o par eyebrow+display inline que vivia dentro da barra de
          comando. `shrink-0`: num container `h-dvh` com `overflow-hidden`,
          quem cede altura é o quadro (`flex-1 min-h-0`), nunca o cabeçalho.
          `live` porque o quadro é realtime (useRealtimeOrderStages) — o selo
          de frescor com a hora do último dado continua na barra de comando,
          onde o modo `embedded` também o enxerga. */}
      {!embedded && (
        <EditorialPageHeader
          sectionLabel="PRODUÇÃO · KANBAN · GESTÃO"
          title="Central de Produção"
          live
          className="shrink-0 px-2 md:px-3 pt-2 pb-0"
          actions={
            <Button asChild variant="outline" size="sm" className="h-11 md:h-9 gap-1.5" title="Voltar para o Planejamento de Produção">
              <Link to="/producao/planejamento" aria-label="Voltar para o Planejamento de Produção">
                <ArrowLeft className="h-4 w-4" /> Planejamento
              </Link>
            </Button>
          }
        />
      )}

      {/* Abas Chão (kanban) × Fila (reservadas) */}
      <div className="shrink-0 border-b border-border bg-card px-2 md:px-3">
        <Tabs
          value={boardMode}
          onValueChange={v => {
            setBoardMode(v as KanbanBoardMode);
            if (v === 'fila') exitSelectMode();
          }}
        >
          <TabsList className="h-10 w-full justify-start gap-1 bg-transparent p-0">
            <TabsTrigger value="chao" className="h-10 gap-1.5 px-3 text-xs font-semibold uppercase tracking-wide data-[state=active]:shadow-none">
              <KanbanIcon className="h-4 w-4" />
              Chão
              <span className="font-mono text-[10px] opacity-70">{chaoCount}</span>
            </TabsTrigger>
            <TabsTrigger value="fila" className="h-10 gap-1.5 px-3 text-xs font-semibold uppercase tracking-wide data-[state=active]:shadow-none">
              <ListBullets className="h-4 w-4" />
              Fila
              <span className="font-mono text-[10px] opacity-70">{filaCount}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* ── Barra de comando ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-card px-2 md:px-3 py-1.5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] 2xl:grid-cols-[minmax(20rem,1fr)_auto_auto] items-center gap-2 md:gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          autoFocus={!coarsePointer}
          enterKeyHint="search"
          placeholder="Buscar OP, referência, cor, cliente, PV — ou bipe o QR da ficha…"
          resultCount={matchedOrders.length}
          totalCount={kpis.ops}
          className="w-full min-w-0 max-w-none 2xl:max-w-xl"
          inputClassName="h-11 md:h-9"
        />

        {/* No celular as ações ficam numa faixa própria: a busca vem primeiro e
            nenhum botão comprime a viewport. O overflow é intencional — gesto
            horizontal curto, com alvos de 44px e rótulos sempre visíveis. */}
        <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden xl:overflow-visible">
        <div className="flex w-max items-center gap-1.5 xl:w-auto">
          <Button variant="outline" size="sm" className="h-11 md:h-9 gap-1.5" onClick={() => setScanOpen(true)}>
            <QrCode className="h-4 w-4" /> Bipar
          </Button>
          <div className="flex rounded-md border border-border overflow-hidden" role="group" aria-label="Ordenação da coluna">
            <button
              type="button"
              onClick={() => setSortModePersist('atraso')}
              aria-pressed={sortMode === 'atraso'}
              className={`h-11 md:h-9 px-3 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                sortMode === 'atraso' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted/40'
              }`}
              title="Mais atrasadas no topo (padrão)"
            >
              <AlertTriangle className="h-4 w-4" /> Atraso
            </button>
            <button
              type="button"
              onClick={() => setSortModePersist('setup')}
              aria-pressed={sortMode === 'setup'}
              className={`h-11 md:h-9 px-3 text-xs font-semibold flex items-center gap-1.5 transition-colors border-l border-border ${
                sortMode === 'setup' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted/40'
              }`}
              title="Agrupar por solado + cor; pin continua no topo"
            >
              <Layers className="h-4 w-4" /> Setup
            </button>
          </div>
          {/* Segmented: os dois modos visíveis (tooltip não existe no toque) */}
          <div className="flex rounded-md border border-border overflow-hidden" role="group" aria-label="Modo da busca">
            <button
              type="button"
              onClick={() => setViewMode('destacar')}
              aria-pressed={viewMode === 'destacar'}
              className={`h-11 md:h-9 px-3 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                viewMode === 'destacar' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted/40'
              }`}
            >
              <Highlighter className="h-4 w-4" /> Destacar
            </button>
            <button
              type="button"
              onClick={() => setViewMode('filtrar')}
              aria-pressed={viewMode === 'filtrar'}
              className={`h-11 md:h-9 px-3 text-xs font-semibold flex items-center gap-1.5 transition-colors border-l border-border ${
                viewMode === 'filtrar' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted/40'
              }`}
            >
              <Funnel className="h-4 w-4" /> Filtrar
            </button>
          </div>
          {canEdit && boardMode === 'chao' && (
            <Button
              variant={selectMode ? 'default' : 'outline'}
              size="sm"
              className="h-11 md:h-9 gap-1.5"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              aria-pressed={selectMode}
            >
              <CheckSquare className="h-4 w-4" /> {selectMode ? 'Sair da seleção' : 'Selecionar OPs'}
            </Button>
          )}
          {/* No celular os KPIs somem, mas o frescor não pode sumir: é onde o
              operador mais depende do realtime sem ter espaço pra diagnóstico. */}
          <span
            className={`flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[10px] md:hidden ${
              stale ? 'border-warning/40 bg-warning/10 text-warning' : 'border-border bg-muted/30 text-muted-foreground'
            }`}
            role="status"
            title={stale
              ? `Nenhum dado novo há ${staleMin} minutos.`
              : `Último dado recebido às ${updatedLabel}.`}
          >
            <span className={`h-2 w-2 rounded-full ${stale ? 'bg-warning' : 'bg-success'}`} aria-hidden="true" />
            {stale ? `sem atualizar · ${staleMin} min` : `dados · ${updatedLabel}`}
          </span>
          {/* Dentro do ERP o atalho é abrir a Central (tela cheia dedicada);
              fullscreen do navegador só faz sentido na rota própria. */}
          {embedded ? (
            <Button asChild variant="outline" size="sm" className="h-11 md:h-9 gap-1.5" title="Abrir a Central de Produção em tela cheia, sem a casca do ERP">
              <Link to="/producao/kanban/gestao" aria-label="Abrir Modo Gestão em página dedicada">
                <ArrowsOutSimple className="h-4 w-4" /> <span className="hidden sm:inline">Modo Gestão</span>
              </Link>
            </Button>
          ) : canFullscreen && (
            <Button variant="outline" size="sm" className="h-11 w-11 md:h-9 md:w-9 p-0" onClick={toggleFullscreen} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>
              {isFullscreen ? <ArrowsInSimple className="h-4 w-4" /> : <ArrowsOutSimple className="h-4 w-4" />}
            </Button>
          )}
        </div>
        </div>

        {/* KPIs do quadro + relógio (painel de sala de controle). No celular
            ficam ocultos — os headers das colunas já carregam as contagens. Em
            notebook ocupam uma segunda linha previsível; em 2XL voltam pra
            mesma linha sem disputar largura com a busca. */}
        <div className="hidden md:flex col-span-1 xl:col-span-2 2xl:col-span-1 items-center justify-end gap-4 shrink-0 font-mono text-xs border-t border-border/60 pt-1 2xl:border-0 2xl:pt-0 2xl:ml-auto">
          <span><strong className="text-sm">{kpis.ops}</strong> <span className="text-muted-foreground">{boardMode === 'fila' ? 'reservadas' : 'OPs'}</span></span>
          <span><strong className="text-sm">{kpis.pares.toLocaleString('pt-BR')}</strong> <span className="text-muted-foreground">pares</span></span>
          <span className={kpis.atrasadas > 0 ? 'text-red-600' : ''}>
            <strong className="text-sm">{kpis.atrasadas}</strong> <span className={kpis.atrasadas > 0 ? '' : 'text-muted-foreground'}>atrasadas</span>
          </span>
          {boardMode === 'chao' && (
            <span className={kpis.parciais > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
              <strong className="text-sm">{kpis.parciais}</strong> <span className={kpis.parciais > 0 ? '' : 'text-muted-foreground'}>parciais</span>
            </span>
          )}
          <span
            className={`hidden lg:inline tabular-nums ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
            title={stale
              ? `Nenhum dado novo há ${staleMin} min. O quadro se atualiza sozinho a cada 90s e a cada apontamento — se este número continuar subindo, a conexão caiu.`
              : 'Hora do último dado recebido do servidor (não é o relógio da máquina).'}
          >
            atualizado {updatedLabel}
            {stale ? ` · há ${staleMin} min` : ''}
          </span>
        </div>
      </div>

      {/* ── Barra da seleção em lote ─────────────────────────────────────── */}
      {selectMode && boardMode === 'chao' && (
        <div className="shrink-0 border-b border-border bg-primary/5 px-2 py-2 md:px-3">
          {/* Jornada única e explícita. No desktop vira um trilho compacto; no
              celular empilha sem comprimir o destino nem o botão principal. */}
          <div className="grid gap-2 md:grid-cols-[minmax(14rem,1fr)_auto_minmax(13rem,0.8fr)_auto_minmax(12rem,auto)] md:items-center">
            <div className="flex min-w-0 items-center gap-2 rounded-md border border-primary/25 bg-card px-2.5 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-xs font-bold text-primary-foreground">1</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Selecionar OPs</p>
                {selectedCards.length === 0 ? (
                  <p className="truncate text-xs text-muted-foreground">Toque nos cards do quadro</p>
                ) : (
                  <p
                    className="truncate font-mono text-xs font-semibold"
                    title={`${selectedOrigins.join(' · ')} · ${selectedPares.toLocaleString('pt-BR')} pares`}
                  >
                    {selectedCards.length} OP{selectedCards.length > 1 ? 's' : ''} · {selectedPares.toLocaleString('pt-BR')} pares
                    {selectedOrigins.length > 0 ? ` · ${selectedOrigins.join(' · ')}` : ''}
                  </p>
                )}
              </div>
              {searchActive && matchedOrders.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 shrink-0 px-2 text-xs"
                  onClick={() => setSelectedIds(previous => addUniqueOrderCards(previous, allCards, matchedOrders))}
                  title="Selecionar uma ocorrência de cada OP encontrada"
                >
                  + {matchedOrders.length} da busca
                </Button>
              )}
              {selectedCards.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 shrink-0 p-0"
                  onClick={() => setSelectedIds(new Set())}
                  aria-label="Limpar OPs selecionadas"
                  title="Limpar seleção"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <ArrowRight className="hidden h-4 w-4 text-muted-foreground md:block" aria-hidden="true" />

            <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${
                selectedCards.length > 0 ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
              }`}>2</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Setor de destino</p>
                <Select value={bulkTarget} onValueChange={setBulkTarget} disabled={selectedCards.length === 0}>
                  <SelectTrigger className="h-8 w-full border-0 bg-transparent px-0 shadow-none focus:ring-0">
                    <SelectValue placeholder="Escolher setor…" />
                  </SelectTrigger>
                  <SelectContent>
                    {bulkDestinations.map(destination => (
                      <SelectItem
                        key={destination.sector}
                        value={destination.sector}
                        disabled={destination.eligible === 0}
                      >
                        <span className="flex w-full items-center justify-between gap-3">
                          <span>{destination.sector}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {destination.eligible} apta{destination.eligible === 1 ? '' : 's'}
                            {destination.blocked > 0 ? ` · ${destination.blocked} bloqueada${destination.blocked === 1 ? '' : 's'}` : ''}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ArrowRight className="hidden h-4 w-4 text-muted-foreground md:block" aria-hidden="true" />

            <Button
              className="h-12 w-full gap-2 md:h-[3.25rem] md:w-auto"
              disabled={!canReviewBulk}
              title={
                selectedCards.length === 0
                  ? 'Selecione pelo menos uma OP'
                  : !bulkTarget
                    ? 'Escolha o setor de destino'
                    : !selectedDestination?.eligible
                      ? `Nenhuma OP selecionada pode ir para ${bulkTarget}`
                      : `Revisar ${selectedDestination.eligible} OP${selectedDestination.eligible > 1 ? 's' : ''} para ${bulkTarget}`
              }
              onClick={openBulkReview}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-foreground/15 font-mono text-xs font-bold">3</span>
              <span className="text-left leading-tight">
                <span className="block">Revisar distribuição</span>
                {selectedDestination && selectedCards.length > 0 && (
                  <span className="block text-[10px] font-normal opacity-80">
                    {selectedDestination.eligible} apta{selectedDestination.eligible === 1 ? '' : 's'}
                    {selectedDestination.blocked > 0 ? ` · ${selectedDestination.blocked} bloqueada${selectedDestination.blocked === 1 ? '' : 's'}` : ''}
                  </span>
                )}
              </span>
            </Button>
          </div>
        </div>
      )}

      {/* ── Faixa de resultados da busca (onde cada OP está no fluxo) ────── */}
      {/* flex-nowrap + rolagem horizontal: com flex-wrap, no celular cada chip
          virava uma linha e 12 OPs empurravam o quadro inteiro pra fora da
          tela — sobrava um card visível pra tocar. Agora a faixa tem altura de
          uma linha, não importa quantas OPs a busca ache. */}
      {searchActive && (
        <div className="shrink-0 border-b border-border bg-muted/30 px-3 py-1.5 flex items-center gap-2 flex-nowrap overflow-x-auto text-xs [scrollbar-width:thin]">
          {matches.length === 0 ? (
            <span className="text-muted-foreground">
              Nenhuma OP no quadro casa com a busca — pode já ter saído da produção ou ainda não ter entrado.
            </span>
          ) : (
            <>
              {/* Um botão por SETOR, não por OP: com 22 achadas isto era uma
                  fileira de 22 chips que estourava a largura e repetia o mesmo
                  destino. O que a faixa precisa responder é "onde está o que eu
                  procuro", e isso são 2 botões, não 22. Clicar rola até lá. */}
              <span className="text-muted-foreground shrink-0">
                {matchedOrders.length} OP{matchedOrders.length > 1 ? 's' : ''} em {matchSummary.length} setor{matchSummary.length > 1 ? 'es' : ''}:
              </span>
              {matchSummary.map(({ sector, n }) => (
                <button
                  key={sector}
                  type="button"
                  className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1.5 md:px-2 md:py-0.5 hover:bg-muted/60 transition-colors"
                  onClick={() => scrollToSector(sector)}
                  title={`Rolar o quadro até ${sector}`}
                >
                  <strong className="uppercase tracking-wide">{sector}</strong>
                  <span className="text-muted-foreground font-mono"> {n}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {!canEdit && (
        <p className="shrink-0 px-3 py-1 text-xs text-muted-foreground flex items-center gap-1.5 border-b border-border">
          <Info className="h-3.5 w-3.5" /> Somente leitura — você não tem permissão de apontar produção.
        </p>
      )}

      {/* ── Faixa de fluxo: gargalo + atraso — só no chão ───────────────── */}
      {boardMode === 'chao' && !isLoading && boardCards.length > 0 && (constraintSector || kpis.atrasadas > 0 || travadasMaterial.n > 0 || gridError || gateError) && (
        <div className="shrink-0 border-b border-border px-2 md:px-3 py-1.5 flex items-stretch md:items-center gap-2 md:gap-3 flex-nowrap overflow-x-auto md:flex-wrap md:overflow-visible text-xs [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {constraintSector && (
            <div className="flex shrink-0 max-w-[calc(100vw-1rem)] md:max-w-none items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1">
              <span className="text-sm leading-none" aria-hidden="true">⛏️</span>
              <span>
                <strong className="uppercase tracking-wide">Gargalo: {constraintSector}</strong>
                <span className="text-muted-foreground">
                  {' · '}<span className="font-mono">{wipBySector.get(constraintSector)}</span> OPs acumuladas
                  {idleBelowConstraint > 0 ? <> · <span className="font-mono">{idleBelowConstraint}</span> setores ociosos abaixo</> : null}
                </span>
              </span>
            </div>
          )}
          {kpis.atrasadas > 0 && (
            <div className="flex shrink-0 max-w-[calc(100vw-1rem)] md:max-w-none items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1">
              <strong className="text-red-600 dark:text-red-400 font-mono text-sm leading-none">
                {Math.round((kpis.atrasadas / Math.max(kpis.ops, 1)) * 100)}%
              </strong>
              <span>
                <span className="font-mono font-semibold">{kpis.atrasadas}</span> de <span className="font-mono">{kpis.ops}</span> OPs atrasadas
                <span className="text-muted-foreground"> — ordenadas primeiro em cada coluna</span>
              </span>
            </div>
          )}
          {/* Travadas por MATERIAL: atraso que não se resolve com mais gente na
              linha — só com a matéria-prima chegando. */}
          {travadasMaterial.n > 0 && (
            <div className="flex shrink-0 max-w-[calc(100vw-1rem)] md:max-w-none items-center gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-2.5 py-1">
              <Package className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span>
                <span className="font-mono font-semibold">{travadasMaterial.n}</span> OP(s) sem material
                {travadasMaterial.pior && (
                  <span className="text-muted-foreground">
                    {' — '}o último chega em{' '}
                    <span className="font-mono">
                      {new Date(`${travadasMaterial.pior}T12:00:00`).toLocaleDateString('pt-BR')}
                    </span>
                  </span>
                )}
              </span>
            </div>
          )}
          {/* Consulta de APOIO que falhou: o número correspondente na tela não é
              zero, é ausência de resposta. Sem estes dois avisos o quadro seguia
              afirmando "hoje: 0" e "nenhuma OP travada" com a mesma cara de
              quando a fábrica está de fato em dia. */}
          {gridError && (
            <div className="flex shrink-0 max-w-[calc(100vw-1rem)] md:max-w-none items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Agenda de hoje indisponível</strong>
                <span className="text-muted-foreground">
                  {' '}— o <span className="font-mono">hoje:</span> das colunas sai como{' '}
                  <span className="font-mono">—</span>. Não é capacidade zerada: a consulta falhou.
                </span>
              </span>
            </div>
          )}
          {gateError && (
            <div className="flex shrink-0 max-w-[calc(100vw-1rem)] md:max-w-none items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1">
              <Package className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Gate de material indisponível</strong>
                <span className="text-muted-foreground">
                  {' '}— nenhuma OP aparece marcada como sem matéria-prima porque a consulta falhou,
                  não porque todas têm material.
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Trilho do fluxo: índice navegável das colunas ───────────────────
          É sequência de produção de verdade (não tabs decorativas): o número
          indica a posição no fluxo, a pílula conta os cards visíveis e o
          destaque acompanha a coluna central enquanto o quadro rola. */}
      {boardMode === 'chao' && !isLoading && !loadError && boardCards.length > 0 && navigableColumns.length > 0 && (
        <nav className="shrink-0 border-b border-border bg-background px-2 md:px-3 py-1.5" aria-label="Navegar pelos setores do Kanban">
          <div className="flex min-w-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 md:h-8 md:w-8 shrink-0"
              aria-label="Ir ao setor anterior"
              onClick={() => goToAdjacentSector(-1)}
              disabled={activeSectorIndex <= 0}
              title={activeSectorIndex > 0
                ? `Ir para ${navigableColumns[activeSectorIndex - 1]}`
                : 'Primeiro setor do fluxo'}
            >
              <CaretLeft className="h-4 w-4" />
            </Button>
            <div
              ref={sectorNavEl}
              className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto motion-safe:scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
              {navigableColumns.map((sector, index) => {
                const count = navCountBySector.get(sector) || 0;
                const isActive = sector === activeSector;
                const isConstraint = sector === constraintSector;
                const overWip = (wipBySector.get(sector) || 0) > WIP_LIMIT;
                return (
                  <button
                    key={sector}
                    type="button"
                    data-kb-nav={sector}
                    aria-current={isActive ? 'step' : undefined}
                    aria-label={`${index + 1} de ${navigableColumns.length}: ${sector}, ${count} OP${count === 1 ? '' : 's'}${isConstraint ? ', gargalo atual' : ''}`}
                    onClick={() => scrollToSector(sector)}
                    className={`group h-11 md:h-8 shrink-0 flex items-center gap-2 rounded-sm border px-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                      isActive
                        ? 'border-foreground bg-foreground text-background shadow-sm'
                        : isConstraint
                          ? 'border-amber-500/50 bg-amber-500/10 text-foreground hover:bg-amber-500/20'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    }`}
                    title={`${sector}: ${count} card${count === 1 ? '' : 's'}${isConstraint ? ' · gargalo atual' : ''}`}
                  >
                    <span className={`font-mono text-[9px] ${isActive ? 'text-background/65' : 'text-muted-foreground/70'}`}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="max-w-[9rem] truncate">{sector}</span>
                    <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center font-mono text-[10px] leading-none ${
                      isActive
                        ? 'bg-background/15 text-background'
                        : overWip
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                          : 'bg-muted text-foreground'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 md:h-8 md:w-8 shrink-0"
              aria-label="Ir ao próximo setor"
              onClick={() => goToAdjacentSector(1)}
              disabled={activeSectorIndex >= navigableColumns.length - 1}
              title={activeSectorIndex < navigableColumns.length - 1
                ? `Ir para ${navigableColumns[activeSectorIndex + 1]}`
                : 'Último setor do fluxo'}
            >
              <CaretRight className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      )}

      {/* ── Quadro / Fila ─────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex-1 flex gap-2 p-3 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="flex-1 min-w-[calc(100vw-4rem)] md:min-w-[13.5rem]" />
          ))}
        </div>
      ) : loadError ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-center">
            <p className="font-semibold text-red-600 dark:text-red-400">
              Não foi possível carregar o quadro
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              O quadro está <strong>sem dados</strong> por falha de consulta — isto NÃO quer dizer
              que não há OP em produção. Não aponte produção até recarregar.
            </p>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground break-words">{loadErrorMsg}</p>
            <Button className="mt-3 h-10" onClick={retryLoad}>Tentar de novo</Button>
          </div>
        </div>
      ) : boardMode === 'fila' ? (
        filtering && matches.length === 0 && searchActive ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={Funnel}
              title="Nenhuma OP encontrada"
              description={`Nada na fila casa com "${search.trim()}".`}
            />
          </div>
        ) : filaSorted.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={ListBullets}
              title="Fila vazia"
              description="OPs reservadas (ainda não liberadas pra produção) aparecem aqui. No 1º apontamento elas sobem pro Chão."
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 md:px-3 py-2">
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {(filtering && matchedIds
                ? filaSorted.filter(c => matchedIds.has(c.q.order_id))
                : filaSorted
              ).map(card => {
                const { pv, client } = cardCommercialPrimary(card.q);
                const thumb = thumbUrl(
                  refThumbs?.get(card.q.reference_id || '') || card.q.reference_photo_url,
                  40,
                );
                return (
                  <li
                    key={card.q.order_id}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors"
                  >
                    {thumb ? (
                      <img src={thumb} alt="" className="h-10 w-10 rounded object-contain bg-muted shrink-0" loading="lazy" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-mono text-xs font-bold shrink-0">{pv}</span>
                        <span className="truncate text-sm font-semibold">{client}</span>
                      </div>
                      <p className="truncate text-[11px]">
                        <span className="font-semibold text-primary">{card.q.reference_name || '—'}</span>
                        {card.q.color ? <span className="text-muted-foreground"> · {card.q.color}</span> : null}
                        <span className="text-muted-foreground"> · {card.q.order_number}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {card.q.quantity.toLocaleString('pt-BR')} pares · entrega {fmtDate(card.q.due_date)}
                        {card.q.late_days > 0 ? (
                          <span className="text-red-600"> · +{card.q.late_days}d</span>
                        ) : null}
                        {' · '}{card.column}
                      </p>
                    </div>
                    {canEdit ? (
                      <Button
                        size="sm"
                        className="h-11 md:h-9 shrink-0 min-w-[5.5rem]"
                        onClick={() => setDetailStage({ card })}
                      >
                        Mover
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 md:h-9 shrink-0"
                        onClick={() => setDetailStage({ card })}
                      >
                        Ver
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )
      ) : boardCards.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={KanbanIcon}
            title="Nenhuma OP no chão"
            description={
              filaCount > 0
                ? `Há ${filaCount} OP(s) na Fila. Mova uma delas pra liberar produção neste quadro.`
                : 'OPs em produção aparecem aqui. Reservadas ficam na aba Fila.'
            }
          />
        </div>
      ) : filtering && matches.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={Funnel}
            title="Nenhuma OP encontrada"
            description={`Nada no chão casa com "${search.trim()}". Limpe a busca ou tente outro termo.`}
          />
        </div>
      ) : (
        <div
          ref={boardEl}
          onScroll={syncActiveSector}
          className="flex-1 min-h-0 flex gap-2 overflow-x-auto overscroll-x-contain scroll-px-3 px-3 py-2 snap-x snap-mandatory md:snap-none [scrollbar-width:thin]"
        >
          {columns.map((sector, colIdx) => {
            const colAll = boardCards.filter(c => c.column === sector);
            // Pin → (setup: solado+cor) → atraso. Default = atraso.
            const colCards = sortKanbanColumnCards(
              filtering && matchedIds
                ? colAll.filter(c => matchedIds.has(c.q.order_id))
                : colAll.slice(),
              sortMode,
              soleByRefColor,
            );
            const colPares = colCards.reduce((s, c) => s + (c.columnStage?.quantity_total || c.q.quantity), 0);
            const g = gridToday.get(sector);
            const cap = g && g.utilization > 0 ? capacityTone(g.utilization) : null;
            const capDenom = g ? (g.effective_capacity_pairs || g.capacity_pairs) : 0;
            const capFromFicha = !!g && g.ops_ficha_override > 0;
            const colWip = colAll.length;
            const colContavel = wipBySector.get(sector) || 0;
            const overWip = colContavel > WIP_LIMIT;
            const isConstraint = sector === constraintSector;
            const isIdle = colWip === 0 && !filtering;
            const hasMatch = !filtering || !!matchedColumns?.has(sector);
            const isRail = isIdle || (filtering && !hasMatch);
            const railOpen = isRail && dragOverSector === sector;
            const pGroup = parallelGroupOf.get(sector);
            const isParallelPair = !!pGroup && (parallelGroupSize.get(pGroup) || 0) > 1;
            return (
              /* Celular: uma coluna por swipe (85vw + snap-center); iPad/desktop:
                 colunas fluidas lado a lado como antes. */
              <div
                key={sector}
                data-kb-col={sector}
                style={{ animationDelay: `${colIdx * 45}ms` }}
                /* `hidden md:flex` = a regra do celular (26/07/2026: setor sem
                   OP da busca sai, pra não passar o dedo por telas em branco)
                   vive SÓ no CSS. O desktop nunca perde o setor. */
                className={`kb-col-in flex-col min-h-0 snap-center md:snap-align-none transition-[min-width,max-width,opacity] duration-200 ${
                  filtering && !hasMatch ? 'hidden md:flex' : 'flex'
                } ${
                  isRail && !railOpen
                    ? 'flex-1 basis-0 min-w-[calc(100vw-4rem)] max-w-[calc(100vw-4rem)] md:flex-none md:min-w-[3.5rem] md:max-w-[3.5rem] md:opacity-70 md:hover:opacity-100'
                    : 'flex-1 basis-0 min-w-[calc(100vw-4rem)] max-w-[calc(100vw-4rem)] md:min-w-[13.5rem] lg:min-w-[14rem] 2xl:min-w-[15rem] md:max-w-[20rem]'
                }`}
                onDragOver={e => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverSector(cur => (cur === sector ? cur : sector));
                }}
                onDrop={e => { e.preventDefault(); setDragOverSector(null); handleDrop(sector); }}
              >
                {/* ── Trilho fechado (só desktop) ──────────────────────────
                    Traz a CONTAGEM REAL do setor, não a da busca: um trilho
                    com "48" diz "aqui tem trabalho, só não desta busca", e um
                    com "0" diz "setor parado". Sem esse número dava pra soltar
                    uma OP num setor achando que estava livre quando havia 48
                    na frente dela. */}
                {isRail && !railOpen && (
                  <div
                    className={`hidden md:flex flex-1 min-h-0 flex-col items-center gap-2 rounded-md border py-2 transition-colors ${
                      isConstraint ? 'bg-amber-500/10 border-amber-500/50' : 'bg-muted/40 border-border'
                    } ${dragCard && dragEligibilityBySector?.get(sector)?.ok ? 'border-primary/60 bg-primary/5' : ''}`}
                    title={`${sector} — ${colWip} OP${colWip === 1 ? '' : 's'} no setor${
                      filtering ? ', nenhuma desta busca' : ''
                    }. Arraste um card até aqui pra abrir.`}
                  >
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-mono shrink-0 px-1.5 ${
                        overWip ? 'border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400' : ''
                      }`}
                    >
                      {colWip}
                    </Badge>
                    <span
                      className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap overflow-hidden"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                    >
                      {sector}
                    </span>
                  </div>
                )}
                <div className={`shrink-0 rounded-t-md px-2.5 py-1.5 border ${
                  isRail && !railOpen ? 'md:hidden' : ''
                } ${
                  isConstraint ? 'bg-amber-500/10 border-amber-500/50' : 'bg-muted border-border'
                } ${isParallelPair ? 'kb-parallel-pair' : ''}`}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="min-w-0">
                      <span className="text-[11px] font-bold uppercase tracking-wider truncate block">{sector}</span>
                      {isParallelPair && (
                        <span className="kb-parallel-pair-label text-[9px] font-semibold uppercase text-primary/80">
                          em paralelo
                        </span>
                      )}
                    </span>
                    {/* WIP: vermelho e com o limite quando o setor passa do saudável
                        — vira sinal de acúmulo/gargalo, não só uma contagem. */}
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 font-mono ${overWip ? 'border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400' : ''}`}
                      title={
                        `${colContavel} OP${colContavel === 1 ? '' : 's'} contando pro gargalo`
                        + (colWip !== colContavel ? ` · ${colWip} cards no setor (inclui OP reservada de faturamento distante)` : '')
                        + (overWip ? ` — acima do limite saudável de ${WIP_LIMIT}` : '')
                      }
                    >
                      {/* ⚠ Numerador e denominador do MESMO universo.
                          Antes o número vinha de `colCards` (filtrado pela busca)
                          e o "/20" de `colWip` (o setor inteiro): buscar 1 OP no
                          gargalo lia "1/20" — folga confortável — num setor com
                          48 acumuladas, e a dica do mouse dizia 48. É o mesmo
                          erro que o comentário do `colPares` acima já corrigiu
                          no Σ pares; aqui tinha sobrado o híbrido. */}
                      {filtering ? `${colCards.length} de ${colContavel}` : colContavel}
                      {overWip && !filtering ? `/${WIP_LIMIT}` : ''}
                    </Badge>
                  </div>
                  {/* R2.7: MESMO número do Planejamento (v_production_schedule_grid).
                      Denominador = capacidade EFETIVA do mix do dia; o asterisco
                      marca quando ela veio da ficha técnica e não do global. */}
                  <p
                    className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate"
                    title={`${
                      gridError
                        ? 'Agenda de hoje NÃO carregou — número indisponível, não é zero agendado.'
                        : g
                          ? `${g.planned_pairs} pares agendados hoje · capacidade ${capDenom}/dia${
                              capFromFicha ? ` (ficha técnica, ${g.ops_ficha_override} OP(s); global ${g.capacity_pairs})` : ' (global do setor)'
                            }${g.carryover_pairs > 0 ? ` · ${g.carryover_pairs} pares rolados de dias anteriores` : ''}`
                          : 'Sem agenda pra hoje neste setor'
                    } · Σ ${colPares.toLocaleString('pt-BR')} pares ${
                      filtering ? `das ${colCards.length} OP(s) desta busca` : 'no setor'
                    }`}
                  >
                    hoje: {gridError ? '—' : g ? `${g.planned_pairs}/${capDenom}${capFromFicha ? '*' : ''}` : '0'}
                    {!gridError && g && g.carryover_pairs > 0 ? ` +${g.carryover_pairs}` : ''} · Σ {colPares.toLocaleString('pt-BR')} pares
                  </p>
                  {/* Barra de capacidade: verde/âmbar/vermelho num relance; o traço
                      vermelho à direita marca o estouro (>100%). */}
                  {cap && (
                    <div className="mt-1 h-1.5 rounded-full bg-muted-foreground/15 overflow-hidden relative" title={`${cap.pct}% do dia consumido neste setor`}>
                      <div className={`h-full rounded-full ${cap.bar} transition-[width] duration-700`} style={{ width: `${Math.min(cap.pct, 100)}%` }} />
                      {cap.pct > 100 && <span className="absolute inset-y-0 right-0 w-0.5 bg-red-600" aria-hidden="true" />}
                    </div>
                  )}
                </div>
                {/* kb-fade: as máscaras de rolagem moram no WRAPPER, não no
                    scroller — senão elas rolariam junto com as OPs. */}
                <div className={`kb-fade flex-1 min-h-0 ${isRail && !railOpen ? 'md:hidden' : ''}`}>
                <div
                  data-kb-list={sector}
                  onScroll={e => syncColumnFade(e.currentTarget)}
                  className={`h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable] space-y-1.5 rounded-b-md border border-t-0 border-border bg-muted/20 p-1.5 transition-colors ${
                    dragOverSector === sector && dragCard && dragCard.column !== sector
                      // Feedback HONESTO: verde/tinta só quando a OP realmente
                      // pode ir pra cá. Antes qualquer coluna diferente da atual
                      // acendia como destino válido e o operador só descobria a
                      // recusa depois de soltar ("Esta OP não passa por X").
                      ? (dragEligibilityBySector?.get(sector)?.ok
                          ? (dragEligibilityBySector.get(sector)?.kind === 'pulo'
                              ? 'kb-drop-target border-warning bg-warning/10'
                              : 'kb-drop-target border-success bg-success/10')
                          : 'border-dashed border-muted-foreground/40 bg-muted/40 opacity-60 cursor-no-drop')
                      : ''
                  }`}
                  aria-dropeffect={
                    dragOverSector === sector && dragCard && dragCard.column !== sector
                      ? (dragEligibilityBySector?.get(sector)?.ok ? 'move' : 'none')
                      : undefined
                  }
                >
                  {/* Coluna vazia não pode parecer bug nem "acabou o trabalho":
                      diz o motivo e, quando dá, o que destrava. */}
                  {colCards.length === 0 && (
                    <p className="px-2 py-6 text-center text-[11px] leading-snug text-muted-foreground">
                      {filtering
                        ? 'Nenhuma OP desta busca aqui.'
                        : <>Sem OP aguardando <strong>{sector}</strong>.
                            {canEdit ? <><br />Arraste um card de outro setor pra cá.</> : null}</>}
                    </p>
                  )}
                  {colCards.map((card, cardIdx) => (
                    <div
                      key={card.key}
                      // Cascata com teto de 10: o 11º card já nasce pronto, senão
                      // uma coluna com 72 OPs levaria 1,6s pra terminar de entrar.
                      style={{ animationDelay: `${colIdx * 45 + 140 + Math.min(cardIdx, 10) * 22}ms` }}
                      className="kb-card-in"
                      ref={el => {
                        if (el) cardEls.current.set(card.key, el);
                        else cardEls.current.delete(card.key);
                      }}
                    >
                      <KanbanOpCard
                        card={card}
                        compact
                        photoUrl={refThumbs?.get(card.q.reference_id || '') || null}
                        draggable={canEdit && !selectMode}
                        dragging={dragCard?.key === card.key}
                        dimmed={viewMode === 'destacar' && !!matchedIds && !matchedIds.has(card.q.order_id)}
                        highlighted={!selectMode && viewMode === 'destacar' && !!matchedIds && matchedIds.has(card.q.order_id)}
                        siblingActive={
                          !!hoverOrderId
                          && hoverOrderId === card.q.order_id
                          && card.parallelSiblings.length > 0
                        }
                        selectable={selectMode}
                        selected={selectedIds.has(card.key)}
                        readOnly={!canEdit}
                        landed={landedId === card.q.order_id}
                        materialGateDate={gateMap?.get(card.q.order_id)?.ready_date ?? null}
                        materialGateReason={gateMap?.get(card.q.order_id)?.reason ?? null}
                        onToggleSelect={() => toggleSelect(card)}
                        onDragStart={() => setDragCard(card)}
                        onDragEnd={() => { setDragCard(null); setDragOverSector(null); }}
                        onOpen={() => setDetailStage({ card })}
                        onHoverOrder={setHoverOrderId}
                      />
                    </div>
                  ))}
                </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dropTarget && canEdit && (
        <DropApontarDialog
          card={dropTarget.card}
          target={dropTarget.target}
          flowOrder={flowOrder}
          levelOf={levelOf}
          allowParallelSkip={isAdmin}
          apontar={apontar}
          photoUrl={refThumbs?.get(dropTarget.card.q.reference_id || '') || null}
          onApontado={markLanded}
          onClose={() => setDropTarget(null)}
        />
      )}
      {detailStage && (
        <DropApontarDialog
          card={detailStage.card}
          target={null}
          flowOrder={flowOrder}
          levelOf={levelOf}
          allowParallelSkip={isAdmin}
          apontar={apontar}
          photoUrl={refThumbs?.get(detailStage.card.q.reference_id || '') || null}
          onApontado={markLanded}
          readOnly={!canEdit}
          onClose={() => setDetailStage(null)}
        />
      )}
      {bulkRequest && canEdit && (
        <BulkMoveDialog
          cards={bulkRequest.cards}
          target={bulkRequest.target}
          flowOrder={flowOrder}
          levelOf={levelOf}
          allowParallelSkip={isAdmin}
          apontar={apontar}
          onBack={() => setBulkRequest(null)}
          onClose={() => { setBulkRequest(null); exitSelectMode(); }}
        />
      )}
      <QrScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onDetect={handleScan} />
    </Root>
  );
}
