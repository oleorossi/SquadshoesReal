import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrderLotsBatch } from '@/hooks/useOrderLots';
import PrintWorkSheetsPage, { SECTORS } from '@/components/production/PrintWorkSheetsPage';
import { Card, CardContent } from '@/components/ui/card';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, MagnifyingGlass as Search, CircleNotch as Loader2, FileText, Funnel as Filter, Baby, Warning as AlertTriangle, Cards, ArrowRight, Stack } from '@phosphor-icons/react';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { printOperatorFichasFromRows } from '@/lib/printOperatorFichas';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SALE_ORDER_STATUS } from '@/lib/saleOrderStateMachine';
import { filterOperationalOperatorOrders } from '@/lib/operatorPrintEligibility';

interface OrderRow {
  id: string;
  order_number: string;
  reference_id: string | null;
  color: string | null;
  quantity: number;
  grade: Record<string, number> | null;
  status: string;
  sale_order_id: string | null;
  sale_order_item_id?: string | null;
  sale_orders?: { order_number: string; client_name: string; delivery_deadline: string | null; status: string } | null;
  technical_sheets?: { name: string; code: string | null } | null;
  /** Sequência de tiras do item de PV (ordem TIRA 1, TIRA 2, ...) + variante
   *  de material. Trazidos via join sale_order_items pra que as fichas de
   *  operador mostrem cada tira com sua cor e calculem o consumo com os
   *  materiais DA VARIANTE escolhida no PV. */
  sale_order_items?: {
    strap_colors: Array<{ id?: string; label?: string; color?: string; group_id?: string; group_name?: string }> | null;
    material_variant_id?: string | null;
    production_excluded_at: string | null;
  } | null;
}

// Status REAIS de `orders` (OPs) no backend, conforme auditoria 2026-05:
//   Reservado · Em Produção · Finalizado
// Antes a UI listava 'Pronto' e 'Faturado' que não existem em orders
// ('Faturado' é status de sale_orders, não de orders). Remover essas opções
// mortas evita o filtro mostrar vazio e o user achar que algo sumiu.
// Default 'em_fluxo' cobre OPs ainda passíveis de impressão de ficha.
const STATUS_OPTIONS = ['Reservado', 'Em Produção', 'Finalizado'];
const EM_FLUXO = ['Reservado', 'Em Produção'];

// PVs que NÃO entraram em produção (pré-produção) ou foram cancelados. As OPs
// desses PVs NÃO devem aparecer na impressão de fichas de PRODUÇÃO, mesmo a OP
// estando 'Reservado' — a página filtrava só por status da OP e ignorava o PV,
// deixando vazar OP de PV Cancelado/Aprovado (user 2026-06-18). Exclude-list:
// qualquer status de produção-ou-depois (Em Produção/Faturado/Expedido/...)
// entra por padrão.
const HIDDEN_PV_STATUSES = new Set<string>([
  SALE_ORDER_STATUS.RASCUNHO,
  SALE_ORDER_STATUS.PENDENTE,
  SALE_ORDER_STATUS.APROVADO,
  SALE_ORDER_STATUS.CANCELADO,
]);

// Faixa etária por NUMERAÇÃO da grade (< 33 = infantil) — mesma regra
// canônica do filtro de faixa da tela de print e dos selos das fichas
// (shoe_category traz o ESTILO, raramente "Infantil"). Numeração conjugada
// ("32/33") conta nas duas faixas. Grade mista → os dois badges aparecem.
function rowSizeBands(grade: Record<string, number> | null): { inf: boolean; ad: boolean } {
  let inf = false, ad = false;
  for (const [size, qty] of Object.entries(grade || {})) {
    if (!(Number(qty) > 0)) continue;
    for (const part of String(size).split('/')) {
      const n = parseInt(part, 10);
      if (!Number.isNaN(n)) { if (n < 33) inf = true; else ad = true; }
    }
  }
  return { inf, ad };
}

export default function PrintWorkSheets() {
  // Deep-link da bulk bar de /ordens: "Imprimir fichas" navega pra cá com
  // ?orderIds=a,b,c. Antes o parâmetro era silenciosamente descartado — o
  // usuário caía com seleção VAZIA e imprimia outro conjunto sem perceber.
  // Pré-seleciona as OPs e abre o status em 'todos' (OP Finalizada do link
  // não pode sumir da lista, senão cai fora do lote sem aviso).
  const [searchParams] = useSearchParams();
  const deepLinkIds = useMemo(() => {
    const raw = searchParams.get('orderIds');
    return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
  }, [searchParams]);
  // Deep-link `?sectors=Silk,Montagem` (6º passe, 2026-06-12): os botões
  // "Fichas Operador" das páginas de setor (Silk/Montagem/Corte/Solagem)
  // navegam pra cá em vez do popup legado de fichas por setor (lib removida)
  // — assim TODOS os caminhos de impressão passam pelo modelo v7 (TallyBox
  // em todo setor). Nomes inválidos são descartados; sem param = todos.
  const deepLinkSectors = useMemo(() => {
    const raw = searchParams.get('sectors');
    if (!raw) return null;
    const valid = new Set<string>(SECTORS);
    const list = raw.split(',').map(s => s.trim()).filter(s => valid.has(s));
    return list.length > 0 ? new Set(list) : null;
  }, [searchParams]);
  const [statusFilter, setStatusFilter] = useState<string>(deepLinkIds.length > 0 ? 'todos' : 'em_fluxo');
  const [pvFilter, setPvFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(deepLinkIds));
  const [showPrintView, setShowPrintView] = useState(false);
  // Atalho "Cartões de lote": entra na tela de impressão JÁ em modo cartão, mas
  // ainda passando pelo preview (o dono escolheu isso em vez de imprimir direto
  // — uma tiragem pode sair com dezenas de cartões e os setores ainda não foram
  // escolhidos neste ponto).
  const [openAsCartao, setOpenAsCartao] = useState(false);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['print_worksheets_orders', statusFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from('orders')
        // sale_orders!sale_order_id desambigua: orders tem 2 FKs pra sale_orders
        // (sale_order_id e cross_dock_sale_order_id). PostgREST não escolhe sozinho.
        .select('id, order_number, reference_id, color, quantity, grade, status, sale_order_id, sale_order_item_id, sale_orders!sale_order_id(order_number, client_name, delivery_deadline, status), technical_sheets:reference_id(name, code), sale_order_items!sale_order_item_id(strap_colors, material_variant_id, production_excluded_at)')
        .order('order_number', { ascending: false })
        .limit(500);
      if (statusFilter === 'em_fluxo') {
        q = q.in('status', EM_FLUXO);
      } else if (statusFilter !== 'todos') {
        q = q.eq('status', statusFilter);
      }
      const { data, error } = await q;
      if (error) throw error;
      // Esconde OPs cujo PV não está em produção (Cancelado/Rascunho/Pendente/
      // Aprovado) — é ficha de PRODUÇÃO, então só PV que entrou em produção.
      // Mantém OP sem PV (manual) e PV em produção/faturado/expedido/finalizado.
      return filterOperationalOperatorOrders((data || []) as unknown as OrderRow[])
        .filter(r => !HIDDEN_PV_STATUSES.has((r.sale_orders?.status ?? '').trim()));
    },
  });

  // Lots por OP (PR 2026-05-27): se OP tem split, mostra badge "N lotes" na
  // linha pra user saber que marcar essa OP imprime N fichas, não 1.
  const orderIdsForLots = useMemo(() => rows.map(r => r.id), [rows]);
  const { data: lotsMap } = useOrderLotsBatch(orderIdsForLots);

  // Lista de PVs distintos pra alimentar o dropdown "Filtrar por PV".
  // Adicionado 2026-05-26 pra prevenir contaminação acidental — quando user
  // imprime PV-A mas marca OP de PV-B sem perceber, Corte Forração agrega
  // todas as cores numa só ficha. Filtro por PV ataca o problema na origem.
  const pvOptions = useMemo(() => {
    const set = new Map<string, string>(); // pv_number -> sample sale_order_id
    for (const r of rows) {
      const num = r.sale_orders?.order_number;
      if (num && !set.has(num)) set.set(num, r.sale_order_id || '');
    }
    return Array.from(set.keys()).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }, [rows]);

  const filtered = useMemo(() => {
    let result = rows;
    if (pvFilter !== 'all') {
      result = result.filter(r => r.sale_orders?.order_number === pvFilter);
    }
    if (search.trim()) {
      // espaço/"/" = refinamento AND (ex.: "stx alcineu")
      result = result.filter(r => searchMatchesAllTerms(
        search,
        r.order_number,
        r.color,
        r.technical_sheets?.name,
        r.technical_sheets?.code,
        r.sale_orders?.order_number,
        r.sale_orders?.client_name,
      ));
    }
    return result;
  }, [rows, search, pvFilter]);

  const allFilteredIds = useMemo(() => new Set(filtered.map(r => r.id)), [filtered]);
  const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const id of allFilteredIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const id of allFilteredIds) next.add(id);
        return next;
      });
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Mapeia rows selecionadas pro formato esperado pelo PrintWorkSheetsPage
  // Inclui `id` (alias de op_id) pq OperatorWorkSheet e ManagementReport leem
  // order.id; sem isso, OperatorWorkSheet quebrava com .id.split('-') no
  // 'Imprimir tudo' e as queries de order_stages/order_costs ficavam vazias.
  const selectedOrders = useMemo(() => {
    // CRÍTICO: deriva de `filtered`, NÃO de `rows`. `selectedIds` PERSISTE entre
    // buscas — o campo de busca não limpa a seleção (só os filtros de status/PV
    // limpam). Se derivasse de `rows` (até 500 OPs carregadas), uma OP marcada
    // numa busca ANTERIOR e agora ESCONDIDA pela busca atual continuava entrando
    // no lote: "Gerar fichas" puxava OPs de vários pedidos que o usuário não vê
    // mais (bug 2026-06-24: buscou "ELIANE", 1 OP visível marcada, mas o lote
    // saía com 3 OPs / 2388 pares — os 2208 pares extras eram seleções antigas
    // invisíveis). Escopar à lista filtrada garante: só gera o que está VISÍVEL
    // e marcado — coerente com o header "selecionar todas" e o toggleAll, que já
    // operam sobre `filtered`/`allFilteredIds`.
    return filtered
      .filter(r => selectedIds.has(r.id))
      .map(r => ({
        id: r.id,
        op_id: r.id,
        op_number: r.order_number,
        reference_id: r.reference_id,
        reference_name: r.technical_sheets?.name ?? '',
        reference_code: r.technical_sheets?.code ?? '',
        color: r.color ?? '',
        total_pairs: r.quantity,
        grid: r.grade ?? {},
        due_date: r.sale_orders?.delivery_deadline ?? null,
        client_name: r.sale_orders?.client_name ?? '',
        sale_order_number: r.sale_orders?.order_number ?? '',
        sale_order_id: r.sale_order_id,
        // Necessário pro Relatório Gerencial casar custo item-a-item: 2 itens
        // do mesmo PV com mesma ref+cor (grade infantil + adulta) têm custos
        // distintos em order_costs — sem o id o match por ref+cor duplicava
        // o custo de um e zerava o do outro.
        sale_order_item_id: r.sale_order_item_id ?? null,
        status: r.status,
        // Sequência de tiras preservando a ordem (TIRA 1, TIRA 2, ...). Vazio
        // pra modelos sem tiras. As fichas de operador (Aviamento, Colagem)
        // renderizam essa sequência pra cortador/aviamento saber qual tira
        // recebe qual cor (relevante quando o cliente pede mix de cores).
        strap_colors: Array.isArray(r.sale_order_items?.strap_colors)
          ? r.sale_order_items!.strap_colors
          : [],
        // Variante de material do item do PV — o consumo das fichas de operador
        // resolve os materiais (cabedal/forro/palmilha/solado/BOM) pela variante.
        material_variant_id: r.sale_order_items?.material_variant_id ?? null,
      }));
  }, [filtered, selectedIds]);

  if (showPrintView) {
    return (
      <PrintWorkSheetsPage
        orders={selectedOrders}
        onBack={() => setShowPrintView(false)}
        initialSectors={deepLinkSectors ?? undefined}
        initialCartao={openAsCartao}
      />
    );
  }

  const totalPairs = selectedOrders.reduce((s, o) => s + (o.total_pairs ?? 0), 0);
  const selectedLotCount = selectedOrders.reduce((total, order) => {
    const lots = lotsMap?.get(order.id);
    return total + Math.max(1, lots?.length ?? 1);
  }, 0);

  const openPreview = (asCartao: boolean) => {
    setOpenAsCartao(asCartao);
    setShowPrintView(true);
  };

  const printQuickOperatorSheets = async () => {
    try {
      await printOperatorFichasFromRows(selectedOrders);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar fichas de operador.');
    }
  };

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <EditorialPageHeader
        sectionNumber="01"
        sectionLabel="PRODUÇÃO · CHÃO DE FÁBRICA"
        title="Fichas de operador"
        description="Monte um lote confiável, confira a rota dos setores e só então emita as fichas que acompanham a produção."
        meta={<span>{filtered.length} OP{filtered.length === 1 ? '' : 's'} NO RECORTE ATUAL</span>}
      />

      {/* Dossiê de emissão: torna a sequência selecionar → conferir → emitir
          explícita e separa a impressão rápida legada do fluxo principal. */}
      <Card className="overflow-hidden border-border/70 shadow-sm">
        <div className="h-1 bg-primary" aria-hidden="true" />
        <CardContent className="p-0">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
            <div className="p-5 sm:p-6 lg:border-r lg:border-border/70">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">LOTE DE IMPRESSÃO</p>
                  <h2 className="mt-1 text-xl font-bold tracking-tight">Manifesto da seleção</h2>
                  <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                    O lote abaixo é exatamente o que seguirá para a conferência por setor.
                  </p>
                </div>
                <Stack className="h-7 w-7 shrink-0 text-primary" weight="duotone" aria-hidden="true" />
              </div>

              <ol className="grid grid-cols-3" aria-label="Etapas da emissão">
                {[
                  ['01', 'Selecionar OPs'],
                  ['02', 'Conferir setores'],
                  ['03', 'Emitir PDF'],
                ].map(([number, label], index) => {
                  const reached = index === 0 || selectedOrders.length > 0;
                  return (
                    <li key={number} className="relative min-w-0 pr-2">
                      {index < 2 && (
                        <span className={`absolute left-7 right-0 top-3 h-px ${reached ? 'bg-primary/50' : 'bg-border'}`} aria-hidden="true" />
                      )}
                      <span className={`relative z-10 inline-flex h-6 min-w-6 items-center justify-center border px-1 font-mono text-[10px] font-bold ${reached ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'}`}>
                        {number}
                      </span>
                      <span className={`mt-2 block text-[11px] font-semibold leading-tight sm:text-xs ${reached ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="flex flex-col justify-between bg-muted/25 p-5 sm:p-6">
              <dl className="grid grid-cols-3 divide-x divide-border">
                <div className="pr-3">
                  <dt className="eyebrow">OPS</dt>
                  <dd className="mt-1 font-display text-3xl leading-none">{selectedOrders.length}</dd>
                </div>
                <div className="px-3">
                  <dt className="eyebrow">PARES</dt>
                  <dd className="mt-1 font-display text-3xl leading-none">{totalPairs.toLocaleString('pt-BR')}</dd>
                </div>
                <div className="pl-3">
                  <dt className="eyebrow">LOTES</dt>
                  <dd className="mt-1 font-display text-3xl leading-none">{selectedLotCount}</dd>
                </div>
              </dl>

              <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <Button
                  disabled={selectedOrders.length === 0}
                  onClick={() => openPreview(false)}
                  className="gap-2 sm:col-span-2 lg:col-span-1 xl:col-span-2"
                  title="Revise setores e conteúdo antes de emitir o PDF"
                >
                  Revisar e gerar fichas
                  <ArrowRight className="h-4 w-4" weight="bold" />
                </Button>
                <Button
                  variant="outline"
                  disabled={selectedOrders.length === 0}
                  onClick={() => openPreview(true)}
                  className="gap-2"
                  title="Prévia de cartões recortáveis por lote de setor"
                >
                  <Cards className="h-4 w-4" /> Cartões de lote
                </Button>
                <Button
                  variant="ghost"
                  disabled={selectedOrders.length === 0}
                  onClick={printQuickOperatorSheets}
                  className="gap-2 text-muted-foreground"
                  title="Impressão direta do modelo legado: Corte Forração, Aviamento e Montagem; duas vias por fornada"
                >
                  <Printer className="h-4 w-4" /> Rápida · 2 vias
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="flex items-center gap-2 xl:min-w-40">
              <span className="flex h-8 w-8 items-center justify-center border border-primary/25 bg-primary/10 text-primary">
                <Filter className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-bold">Selecionar OPs</p>
                <p className="text-[11px] text-muted-foreground">Refine antes de marcar</p>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap">
            <SearchInput
              className="min-w-[220px] flex-1"
              inputClassName="h-9"
              value={search}
              onChange={setSearch}
              placeholder="Buscar por OP, PV, cliente, referência, cor…"
              resultCount={filtered.length}
              totalCount={rows.length}
            />
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                // Auto-limpa selectedIds (mesmo motivo do pvFilter): evita
                // OPs fantasmas de status anterior contaminarem o batch.
                setSelectedIds(new Set());
              }}
            >
              <SelectTrigger className="h-9 w-full sm:w-52">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="em_fluxo">Em fluxo (Reservado + Em Produção)</SelectItem>
                <SelectItem value="todos">Todos os status</SelectItem>
                {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value={pvFilter}
              onValueChange={(v) => {
                setPvFilter(v);
                // Auto-limpa seleção pra evitar carregar OPs de PV anterior
                // que ficariam "fantasmas" no batch ao trocar de filtro.
                setSelectedIds(new Set());
              }}
            >
              <SelectTrigger className="h-9 w-full sm:w-44" title="Filtra OPs por PV — evita contaminar batch com OPs de outros PVs">
                <SelectValue placeholder="Por PV" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os PVs</SelectItem>
                {pvOptions.map(pv => <SelectItem key={pv} value={pv}>{pv}</SelectItem>)}
              </SelectContent>
            </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filtered.length === 0}
              onClick={toggleAll}
              className="shrink-0"
            >
              {allSelected ? 'Desmarcar visíveis' : `Marcar visíveis (${filtered.length})`}
            </Button>
          </div>

          <div className="flex items-center justify-between border-y border-border/60 py-2 text-xs text-muted-foreground">
            <span>{filtered.length} encontrada{filtered.length === 1 ? '' : 's'}</span>
            <span className="font-mono font-semibold text-foreground">
              {selectedOrders.length} selecionada{selectedOrders.length === 1 ? '' : 's'} · {totalPairs.toLocaleString('pt-BR')} pares
            </span>
          </div>

          {selectedOrders.length > 0 && (
            <div className="sticky top-16 z-30 flex items-center justify-between gap-3 border border-primary/30 bg-background/95 p-3 shadow-md backdrop-blur md:hidden">
              <div>
                <p className="font-mono text-xs font-bold">{selectedOrders.length} OP · {totalPairs.toLocaleString('pt-BR')} pares</p>
                <p className="text-[10px] text-muted-foreground">Pronto para conferir setores</p>
              </div>
              <Button size="sm" onClick={() => openPreview(false)} className="gap-2">
                Revisar <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            // Erro ≠ lista vazia: antes o erro de rede caía no empty state
            // ("Nenhuma OP encontrada") e o usuário achava que não havia OPs.
            <EmptyState
              size="sm"
              icon={AlertTriangle}
              title="Erro ao carregar as OPs"
              description="Verifique a conexão e tente novamente."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Tentar novamente
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            search.trim() ? (
              <EmptyState
                size="sm"
                icon={Search}
                title={`Nenhum resultado para "${search}"`}
                action={
                  <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                    Limpar busca
                  </Button>
                }
              />
            ) : (
              <EmptyState
                size="sm"
                icon={FileText}
                title="Nenhuma OP produtiva encontrada"
                description="OPs canceladas e itens retirados da produção continuam no histórico, mas não aparecem para impressão. Ajuste os filtros para procurar outras OPs."
              />
            )
          ) : (
            <>
            <div className="hidden overflow-hidden border md:block">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Selecionar todas"
                      />
                    </th>
                    <th className="text-left p-2">OP</th>
                    <th className="text-left p-2">PV / Cliente</th>
                    <th className="text-left p-2">Referência</th>
                    <th className="text-left p-2">Cor</th>
                    <th className="text-right p-2">Pares</th>
                    <th className="text-left p-2">Entrega</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const checked = selectedIds.has(r.id);
                    const { inf, ad } = rowSizeBands(r.grade);
                    return (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        aria-selected={checked}
                        className={`cursor-pointer border-t border-l-4 border-border/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                          checked
                            ? 'border-l-primary bg-primary/5 hover:bg-primary/10'
                            // Linha infantil com fundo rosa-claro — mesmo padrão
                            // visual da lista de Pedidos de Venda.
                            : inf
                              ? 'border-l-transparent bg-pink-500/[0.06] hover:bg-pink-500/[0.11]'
                              : 'border-l-transparent hover:bg-muted/30'
                        }`}
                        onClick={() => toggleOne(r.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleOne(r.id);
                          }
                        }}
                      >
                        <td className="p-2">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleOne(r.id)}
                            onClick={e => e.stopPropagation()}
                            aria-label={`Selecionar OP ${r.order_number}`}
                          />
                        </td>
                        <td className="p-2 font-mono font-bold">
                          {r.order_number}
                          {(() => {
                            const lots = lotsMap?.get(r.id);
                            if (!lots || lots.length <= 1) return null;
                            return (
                              <Badge
                                variant="outline"
                                className="ml-1.5 h-5 text-[9px] font-mono border-amber-600/50 text-amber-700 bg-amber-500/5"
                                title={`OP splitada em ${lots.length} lotes — marcar imprime todos`}
                              >
                                {lots.length} lotes
                              </Badge>
                            );
                          })()}
                          {/* Faixa por numeração — visual igual ao badge Infantil
                              dos Pedidos de Venda; grade mista mostra os dois. */}
                          {inf && (
                            <Badge
                              variant="outline"
                              className="ml-1.5 h-4 pl-1 pr-1.5 text-[10px] uppercase font-bold bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/40 gap-0.5"
                              title="Grade com numeração infantil (abaixo do 33)"
                            >
                              <Baby className="h-3 w-3" weight="fill" /> Infantil
                            </Badge>
                          )}
                          {ad && (
                            <Badge
                              variant="outline"
                              className="ml-1.5 h-4 px-1.5 text-[10px] uppercase font-bold bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30"
                              title="Grade com numeração adulta (33 ou acima)"
                            >
                              Adulto
                            </Badge>
                          )}
                        </td>
                        <td className="p-2">
                          <p className="font-medium">{r.sale_orders?.order_number || '—'}</p>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                            {r.sale_orders?.client_name || '—'}
                          </p>
                        </td>
                        <td className="p-2">
                          <p className="font-medium truncate max-w-[180px]">
                            {r.technical_sheets?.name || '—'}
                          </p>
                          {r.technical_sheets?.code && (
                            <p className="text-[10px] text-muted-foreground font-mono">
                              {r.technical_sheets.code}
                            </p>
                          )}
                        </td>
                        <td className="p-2">{r.color || '—'}</td>
                        <td className="p-2 text-right font-mono text-sm font-bold tabular-nums">{r.quantity}</td>
                        <td className="p-2">
                          {r.sale_orders?.delivery_deadline
                            ? format(parseISO(r.sale_orders.delivery_deadline), 'dd/MM/yyyy', { locale: ptBR })
                            : '—'}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-2 md:hidden">
              {filtered.map(r => {
                const checked = selectedIds.has(r.id);
                const { inf, ad } = rowSizeBands(r.grade);
                const lots = lotsMap?.get(r.id);
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={checked}
                    onClick={() => toggleOne(r.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleOne(r.id);
                      }
                    }}
                    className={`border-l-4 p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${checked ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleOne(r.id)}
                        onClick={event => event.stopPropagation()}
                        aria-label={`Selecionar OP ${r.order_number}`}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-sm font-bold">OP {r.order_number}</p>
                            <p className="mt-0.5 truncate text-sm font-medium">{r.technical_sheets?.name || 'Sem referência'}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-display text-2xl leading-none">{r.quantity}</p>
                            <p className="eyebrow mt-1">PARES</p>
                          </div>
                        </div>
                        <p className="mt-2 truncate text-xs text-muted-foreground">
                          PV {r.sale_orders?.order_number || '—'} · {r.sale_orders?.client_name || 'Sem cliente'}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                          {lots && lots.length > 1 && <Badge variant="outline" className="text-[10px]">{lots.length} lotes</Badge>}
                          {inf && <Badge variant="outline" className="gap-1 text-[10px]"><Baby className="h-3 w-3" weight="fill" /> Infantil</Badge>}
                          {ad && <Badge variant="outline" className="text-[10px]">Adulto</Badge>}
                          {r.color && <span className="ml-auto truncate text-[11px] text-muted-foreground">{r.color}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-px overflow-hidden border bg-border text-xs sm:grid-cols-3">
        <div className="bg-card p-3"><strong className="block text-foreground">Fichas por setor</strong><span className="text-muted-foreground">Da preparação à expedição, seguindo a rota real.</span></div>
        <div className="bg-card p-3"><strong className="block text-foreground">Expedição consolidada</strong><span className="text-muted-foreground">Uma ficha por cliente e CNPJ.</span></div>
        <div className="bg-card p-3"><strong className="block text-foreground">Relatório gerencial</strong><span className="text-muted-foreground">Resumo de PV, custos, margens e andamento.</span></div>
      </div>

    </div>
  );
}
