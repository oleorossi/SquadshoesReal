import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, ArrowsInSimple, ArrowsOutSimple, CheckSquare, Funnel, Highlighter,
  Info, Kanban as KanbanIcon, QrCode, X,
} from '@phosphor-icons/react';
import {
  useSectorSettings, useProductionQueueDetail, useProductionScheduleGrid,
  useEnsureFreshSchedule,
} from '@/hooks/useProductionEngine';
import { useAllOrderStages, useApontarProducao, useRealtimeOrderStages } from '@/hooks/useOrderStages';
import { useCan } from '@/hooks/useAccessControl';
import { useIsCoarsePointer } from '@/hooks/use-mobile';
import { usePersistedState } from '@/hooks/usePersistedState';
import { searchMatchesAllTerms, searchMatchesAny, splitSearchTerms, normalizeForSearch } from '@/lib/searchUtils';
import { toast } from 'sonner';
import { deriveCard, todayISO, KanbanCardData } from '@/components/production/kanban/kanbanDerive';
import { KanbanOpCard } from '@/components/production/kanban/KanbanOpCard';
import { DropApontarDialog } from '@/components/production/kanban/DropApontarDialog';
import { BulkMoveDialog } from '@/components/production/kanban/BulkMoveDialog';
import { QrScanDialog } from '@/components/production/kanban/QrScanDialog';

/**
 * CENTRAL DE PRODUÇÃO — o Kanban em modo "programa dedicado de gestão":
 * tela cheia SEM a casca do ERP (rota fora do AppLayout), todos os setores
 * visíveis de uma vez, busca que FILTRA o quadro (padrão; 'destacar' é opção),
 * leitura do QR das fichas de operador (câmera ou leitor físico) e seleção
 * múltipla pra mover várias OPs de setor de uma vez. Mesmo motor do Kanban:
 * mesmos hooks, mesma RPC de apontamento, mesmo realtime — só muda a moldura.
 * Pensada pro analista deixar aberta num monitor o dia inteiro.
 */
export default function ProducaoKanbanGestao() {
  useEnsureFreshSchedule();
  useRealtimeOrderStages();
  const { data: sectors = [] } = useSectorSettings();
  const { data: queue = [], isLoading: queueLoading } = useProductionQueueDetail();
  const orderIds = useMemo(() => queue.map(q => q.order_id), [queue]);
  const { data: allStages = [], isLoading: stagesLoading } = useAllOrderStages(orderIds);
  const { data: todayGrid = [] } = useProductionScheduleGrid(todayISO(), todayISO());
  const apontar = useApontarProducao();
  const canEdit = useCan('/producao/kanban').canEdit;
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
  const [scanOpen, setScanOpen] = useState(false);
  const [dragCard, setDragCard] = useState<KanbanCardData | null>(null);
  const [dropTarget, setDropTarget] = useState<{ card: KanbanCardData; target: string } | null>(null);
  const [detailStage, setDetailStage] = useState<{ card: KanbanCardData } | null>(null);
  // Seleção múltipla → mover várias OPs de setor preenchendo uma por uma
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const cardEls = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const prev = document.title;
    document.title = 'Central de Produção · Squad Shoes';
    return () => { document.title = prev; };
  }, []);

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
  const stagesByOrder = useMemo(() => {
    const m = new Map<string, typeof allStages>();
    allStages.forEach(s => {
      const arr = m.get(s.order_id) || [];
      arr.push(s);
      m.set(s.order_id, arr);
    });
    return m;
  }, [allStages]);

  // TODAS as OPs do quadro (sem busca) — a busca aqui destaca/filtra depois,
  // pra não recalcular a derivação a cada tecla.
  const allCards = useMemo(() => {
    const out: KanbanCardData[] = [];
    for (const q of queue) {
      const stages = stagesByOrder.get(q.order_id);
      if (!stages?.length) continue;
      const card = deriveCard(q, stages, flowOrder);
      if (card) out.push(card);
    }
    return out;
  }, [queue, stagesByOrder, flowOrder]);

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
      const hit = scanTerms
        ? scanTerms.some(t => searchMatchesAny(t, q.sale_order_number))
        : searchMatchesAllTerms(search, q.order_number, q.reference_name, q.color, q.client_name, q.sale_order_number);
      if (hit) s.add(q.order_id);
    }
    return s;
  }, [searchActive, scanTerms, search, allCards]);

  const matches = useMemo(
    () => (matchedIds ? allCards.filter(c => matchedIds.has(c.q.order_id)) : []),
    [matchedIds, allCards],
  );

  // Setor comum a TODAS as OPs achadas (null quando estão espalhadas). Permite
  // dizer o destino uma vez no rótulo em vez de repeti-lo em cada chip.
  const uniformMatchColumn = useMemo(() => {
    if (matches.length === 0) return null;
    const first = matches[0].column;
    return matches.every(c => c.column === first) ? first : null;
  }, [matches]);

  // Achou → leva o olho até o card (a coluna certa pode estar fora da viewport)
  useEffect(() => {
    if (!matches.length) return;
    const el = cardEls.current.get(matches[0].q.order_id);
    if (!el) return;
    const t = setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }), 150);
    return () => clearTimeout(t);
  }, [matches]);

  // Colunas: setores ativos na ordem do fluxo + qualquer setor que apareça como
  // coluna de um card (setor desligado globalmente mas presente via ficha, R1.5)
  const columns = useMemo(() => {
    const active = sectors.filter(s => s.enabled).map(s => s.sector);
    const extra = [...new Set(allCards.map(c => c.column))].filter(s => !active.includes(s));
    return [...active, ...extra].sort((a, b) => (flowOrder.get(a) ?? 999) - (flowOrder.get(b) ?? 999));
  }, [sectors, allCards, flowOrder]);

  const gridToday = useMemo(() => new Map(todayGrid.map(g => [g.sector, g])), [todayGrid]);

  const kpis = useMemo(() => ({
    ops: allCards.length,
    pares: allCards.reduce((s, c) => s + (c.q.quantity || 0), 0),
    atrasadas: allCards.filter(c => c.q.late_days > 0).length,
    parciais: allCards.filter(c => c.isPartial).length,
  }), [allCards]);

  // Busca ativa em modo filtrar: o quadro mostra SÓ o que casou.
  const filtering = viewMode === 'filtrar' && !!matchedIds;

  // Setor que ficou sem OP casada sai do quadro — no celular cada coluna ocupa
  // uma tela inteira e passar por 9 vazias é ruído puro.
  const visibleColumns = useMemo(() => {
    if (!filtering || !matchedIds) return columns;
    return columns.filter(sector => allCards.some(c => c.column === sector && matchedIds.has(c.q.order_id)));
  }, [columns, filtering, matchedIds, allCards]);

  const selectedCards = useMemo(
    () => allCards.filter(c => selectedIds.has(c.q.order_id)),
    [allCards, selectedIds],
  );
  const selectedPares = useMemo(
    () => selectedCards.reduce((s, c) => s + (c.columnStage?.quantity_total || c.q.quantity), 0),
    [selectedCards],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkTarget('');
  };

  const handleDrop = (target: string) => {
    if (!dragCard) return;
    const card = dragCard;
    setDragCard(null);
    if (target === card.column) return;
    setDropTarget({ card, target });
  };

  const handleScan = (raw: string) => {
    setScanOpen(false);
    const payload = raw.trim();
    if (!payload) return;
    setSearch(payload);
    toast.success(`QR lido: ${payload}`);
  };

  const isLoading = queueLoading || stagesLoading;
  const clock = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    // h-dvh (não h-screen/100vh): no Safari iOS o vh inclui a área da barra de
    // endereço e cortava o rodapé das colunas.
    <div className="h-dvh flex flex-col overflow-hidden bg-background text-foreground">
      {/* ── Barra de comando ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-card px-2 md:px-3 py-2 flex items-center gap-2 md:gap-3 flex-wrap">
        <Button asChild variant="ghost" size="sm" className="h-11 md:h-8 gap-1.5 px-2 shrink-0" title="Voltar pro Kanban no ERP">
          <Link to="/producao/kanban" aria-label="Voltar pro Kanban">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Kanban</span>
          </Link>
        </Button>
        <div className="shrink-0 leading-none">
          <span className="ed-eyebrow block">PRODUÇÃO · GESTÃO</span>
          <span className="ed-display text-base md:text-lg leading-none">CENTRAL DE PRODUÇÃO</span>
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          autoFocus={!coarsePointer}
          enterKeyHint="search"
          placeholder="Buscar OP, referência, cor, cliente, PV — ou bipe o QR da ficha…"
          resultCount={matches.length}
          totalCount={allCards.length}
          className="flex-1 min-w-[240px] max-w-xl order-last md:order-none basis-full md:basis-auto"
          inputClassName="h-11 md:h-9"
        />

        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" className="h-11 md:h-9 gap-1.5" onClick={() => setScanOpen(true)}>
            <QrCode className="h-4 w-4" /> Bipar
          </Button>
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
          {canEdit && (
            <Button
              variant={selectMode ? 'default' : 'outline'}
              size="sm"
              className="h-11 md:h-9 gap-1.5"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              aria-pressed={selectMode}
            >
              <CheckSquare className="h-4 w-4" /> Selecionar
            </Button>
          )}
          {canFullscreen && (
            <Button variant="outline" size="sm" className="h-11 w-11 md:h-9 md:w-9 p-0" onClick={toggleFullscreen} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>
              {isFullscreen ? <ArrowsInSimple className="h-4 w-4" /> : <ArrowsOutSimple className="h-4 w-4" />}
            </Button>
          )}
        </div>

        {/* KPIs do quadro + relógio (painel de sala de controle). No celular
            ficam ocultos — os headers das colunas já carregam as contagens. */}
        <div className="hidden md:flex items-center gap-4 shrink-0 ml-auto font-mono text-xs">
          <span><strong className="text-sm">{kpis.ops}</strong> <span className="text-muted-foreground">OPs</span></span>
          <span><strong className="text-sm">{kpis.pares.toLocaleString('pt-BR')}</strong> <span className="text-muted-foreground">pares</span></span>
          <span className={kpis.atrasadas > 0 ? 'text-red-600' : ''}>
            <strong className="text-sm">{kpis.atrasadas}</strong> <span className={kpis.atrasadas > 0 ? '' : 'text-muted-foreground'}>atrasadas</span>
          </span>
          <span className={kpis.parciais > 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
            <strong className="text-sm">{kpis.parciais}</strong> <span className={kpis.parciais > 0 ? '' : 'text-muted-foreground'}>parciais</span>
          </span>
          <span className="ed-display text-lg tabular-nums hidden lg:inline">{clock}</span>
        </div>
      </div>

      {/* ── Barra da seleção em lote ─────────────────────────────────────── */}
      {selectMode && (
        <div className="shrink-0 border-b border-border bg-primary/5 px-3 py-2 flex items-center gap-2 flex-wrap">
          {selectedIds.size === 0 ? (
            <span className="text-xs text-muted-foreground">
              Toque nos cards pra selecionar as OPs que vão mudar de setor.
            </span>
          ) : (
            <span className="text-xs font-semibold font-mono shrink-0">
              {selectedIds.size} OP{selectedIds.size > 1 ? 's' : ''} · {selectedPares.toLocaleString('pt-BR')} pares
            </span>
          )}
          {searchActive && matches.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={() => setSelectedIds(new Set(matches.map(m => m.q.order_id)))}
            >
              Selecionar as {matches.length} encontradas
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button variant="ghost" size="sm" className="h-9 text-xs gap-1" onClick={() => setSelectedIds(new Set())}>
              <X className="h-3.5 w-3.5" /> Limpar
            </Button>
          )}
          {/* w-full no celular: com w-[180px] fixo o rótulo truncava em
              "Mover para o…", escondendo justamente o que o campo faz. */}
          <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">
            <Select value={bulkTarget} onValueChange={setBulkTarget}>
              <SelectTrigger className="h-11 md:h-9 flex-1 md:w-[180px] md:flex-none">
                <SelectValue placeholder="Mover para o setor…" />
              </SelectTrigger>
              <SelectContent>
                {columns.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              className="h-11 shrink-0 md:h-9"
              disabled={!bulkTarget || selectedIds.size === 0}
              // Botão cinza sem explicação era adivinhação: agora o title diz
              // exatamente o que falta pra habilitar.
              title={
                selectedIds.size === 0
                  ? 'Toque nos cards pra escolher quais OPs mover'
                  : !bulkTarget
                    ? 'Escolha o setor de destino'
                    : `Mover ${selectedIds.size} OP${selectedIds.size > 1 ? 's' : ''} para ${bulkTarget}`
              }
              onClick={() => setBulkOpen(true)}
            >
              Mover{selectedIds.size > 0 ? ` ${selectedIds.size}` : ''}
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
              {/* Quando TODAS as OPs achadas estão no mesmo setor, o destino é
                  dito uma vez aqui — antes cada chip repetia "→ Corte Palmilha"
                  12 vezes, enchendo a tela de ruído. */}
              <span className="text-muted-foreground shrink-0">
                {matches.length} OP{matches.length > 1 ? 's' : ''}
                {uniformMatchColumn ? <> em <strong className="text-foreground">{uniformMatchColumn}</strong></> : null}:
              </span>
              {matches.map(c => (
                <button
                  key={c.q.order_id}
                  type="button"
                  className="shrink-0 font-mono rounded-md border border-border bg-card px-2.5 py-1.5 md:px-2 md:py-0.5 hover:bg-muted/60 transition-colors"
                  onClick={() => cardEls.current.get(c.q.order_id)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })}
                >
                  <strong>{c.q.order_number}</strong>
                  {!uniformMatchColumn && <span className="text-muted-foreground"> → {c.column}</span>}
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

      {/* ── Quadro: todos os setores lado a lado ─────────────────────────── */}
      {isLoading ? (
        <div className="flex-1 flex gap-2 p-3 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="flex-1 min-w-[185px]" />)}
        </div>
      ) : allCards.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={KanbanIcon}
            title="Nenhuma OP em produção"
            description="OPs criadas a partir dos PVs entram aqui automaticamente."
          />
        </div>
      ) : visibleColumns.length === 0 ? (
        /* Filtrando e nada casou: o quadro fica vazio de propósito */
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={Funnel}
            title="Nenhuma OP encontrada"
            description={`Nada no quadro casa com "${search.trim()}". Limpe a busca ou tente outro termo.`}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex gap-2 overflow-x-auto px-3 py-3 snap-x snap-mandatory md:snap-none">
          {visibleColumns.map(sector => {
            const colAll = allCards.filter(c => c.column === sector);
            const colCards = filtering && matchedIds
              ? colAll.filter(c => matchedIds.has(c.q.order_id))
              : colAll;
            const colPares = colAll.reduce((s, c) => s + (c.columnStage?.quantity_total || c.q.quantity), 0);
            const g = gridToday.get(sector);
            return (
              /* Celular: uma coluna por swipe (85vw + snap-center); iPad/desktop:
                 colunas fluidas lado a lado como antes. */
              <div
                key={sector}
                className="flex flex-col flex-1 basis-0 min-w-[85vw] md:min-w-[185px] max-w-none md:max-w-[300px] min-h-0 snap-center md:snap-align-none"
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={e => { e.preventDefault(); handleDrop(sector); }}
              >
                <div className="shrink-0 rounded-t-md bg-muted px-2.5 py-1.5 border border-border">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider truncate">{sector}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">{colCards.length}</Badge>
                  </div>
                  {/* R2.7: MESMO número do Planejamento (v_production_schedule_grid) */}
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                    hoje: {g ? `${g.planned_pairs}/${g.capacity_pairs}` : '0'}
                    {g && g.carryover_pairs > 0 ? ` +${g.carryover_pairs}` : ''} · Σ {colPares.toLocaleString('pt-BR')} pares
                  </p>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 rounded-b-md border border-t-0 border-border bg-muted/20 p-1.5">
                  {colCards.map(card => (
                    <div
                      key={card.q.order_id}
                      ref={el => {
                        if (el) cardEls.current.set(card.q.order_id, el);
                        else cardEls.current.delete(card.q.order_id);
                      }}
                    >
                      <KanbanOpCard
                        card={card}
                        compact
                        draggable={canEdit && !selectMode}
                        dragging={dragCard?.q.order_id === card.q.order_id}
                        dimmed={viewMode === 'destacar' && !!matchedIds && !matchedIds.has(card.q.order_id)}
                        highlighted={!selectMode && !!matchedIds && matchedIds.has(card.q.order_id)}
                        selectable={selectMode}
                        selected={selectedIds.has(card.q.order_id)}
                        onToggleSelect={() => toggleSelect(card.q.order_id)}
                        onDragStart={() => setDragCard(card)}
                        onDragEnd={() => setDragCard(null)}
                        onOpen={() => setDetailStage({ card })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dropTarget && (
        <DropApontarDialog
          card={dropTarget.card}
          target={dropTarget.target}
          flowOrder={flowOrder}
          apontar={apontar}
          onClose={() => setDropTarget(null)}
        />
      )}
      {detailStage && (
        <DropApontarDialog
          card={detailStage.card}
          target={null}
          flowOrder={flowOrder}
          apontar={apontar}
          onClose={() => setDetailStage(null)}
        />
      )}
      {bulkOpen && bulkTarget && selectedCards.length > 0 && (
        <BulkMoveDialog
          cards={selectedCards}
          target={bulkTarget}
          flowOrder={flowOrder}
          apontar={apontar}
          onClose={() => { setBulkOpen(false); exitSelectMode(); }}
        />
      )}
      <QrScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onDetect={handleScan} />
    </div>
  );
}
