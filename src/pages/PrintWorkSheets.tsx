import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrderLotsBatch } from '@/hooks/useOrderLots';
import PrintWorkSheetsPage, { SECTORS } from '@/components/production/PrintWorkSheetsPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, MagnifyingGlass as Search, CircleNotch as Loader2, FileText, Funnel as Filter, Baby, Warning as AlertTriangle } from '@phosphor-icons/react';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { printOperatorFichasFromRows } from '@/lib/printOperatorFichas';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { normalizeForSearch } from '@/lib/searchUtils';
import { SALE_ORDER_STATUS } from '@/lib/saleOrderStateMachine';

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
  sale_order_items?: { strap_colors: Array<{ id?: string; label?: string; color?: string; group_id?: string; group_name?: string }> | null; material_variant_id?: string | null } | null;
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

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['print_worksheets_orders', statusFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from('orders')
        // sale_orders!sale_order_id desambigua: orders tem 2 FKs pra sale_orders
        // (sale_order_id e cross_dock_sale_order_id). PostgREST não escolhe sozinho.
        .select('id, order_number, reference_id, color, quantity, grade, status, sale_order_id, sale_order_item_id, sale_orders!sale_order_id(order_number, client_name, delivery_deadline, status), technical_sheets:reference_id(name, code), sale_order_items!sale_order_item_id(strap_colors, material_variant_id)')
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
      return ((data || []) as unknown as OrderRow[])
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
      // separadores de refinamento AND: vírgula OU "/" (ex.: "stx / alcineu")
      const tokens = search.split(/[,/]/).map(t => normalizeForSearch(t)).filter(Boolean);
      result = result.filter(r => {
        const hay = normalizeForSearch([
          r.order_number,
          r.color,
          r.technical_sheets?.name,
          r.technical_sheets?.code,
          r.sale_orders?.order_number,
          r.sale_orders?.client_name,
        ].filter(Boolean).join(' '));
        return tokens.every(t => hay.includes(t));
      });
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
      />
    );
  }

  const totalPairs = selectedOrders.reduce((s, o) => s + (o.total_pairs ?? 0), 0);

  return (
    <div className="space-y-4">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · IMPRESSÃO"
        title="Imprimir Fichas de Produção"
        description="Selecione as OPs e escolha qual ficha gerar: por setor (Corte/Costura/Silk/Montagem/Solagem/Acabamento), Expedição agrupada por cliente, ou Relatório Gerencial completo do PV."
        actions={
        <div className="flex items-center gap-2 flex-wrap">
          {/* Atalho "Selecionar tudo e imprimir": marca TODAS as OPs filtradas
              + abre a tela de print em 1 clique. Pedido do user 18/05/2026.
              Respeita filtros ativos (status + busca), só seleciona o que
              está visível na lista filtrada. */}
          <Button
            variant="outline"
            disabled={filtered.length === 0}
            onClick={() => {
              setSelectedIds(new Set(filtered.map(r => r.id)));
              setShowPrintView(true);
            }}
            className="gap-2"
            title="Marca todas as OPs filtradas e abre direto a tela de impressão"
          >
            <FileText className="h-4 w-4" />
            Selecionar tudo e imprimir ({filtered.length})
          </Button>
          {/* Ficha de Operador (Corte Forração/Aviamento/Montagem) das OPs selecionadas —
              gera direto o A4: N fichas repetidas por fornada de 12 pares, 2 vias cada.
              Pula setor que a referência não tem na ficha técnica. */}
          <Button
            variant="outline"
            disabled={selectedOrders.length === 0}
            onClick={async () => {
              try { await printOperatorFichasFromRows(selectedOrders); }
              catch (err: any) { toast.error(err?.message || 'Falha ao gerar fichas de operador.'); }
            }}
            className="gap-2"
            title="Gera as fichas de operador (Corte Forração / Aviamento / Montagem) das OPs selecionadas — N fichas por fornada de 12 pares, 2 vias; pula setor que a referência não tem"
          >
            <Printer className="h-4 w-4" />
            Ficha de Operador ({selectedOrders.length})
          </Button>
          <Button
            disabled={selectedOrders.length === 0}
            onClick={() => setShowPrintView(true)}
            className="gap-2"
            title="Abre a tela com os setores das fichas — você marca/desmarca quais entram no arquivo final"
          >
            <FileText className="h-4 w-4" />
            Gerar fichas ({selectedOrders.length} OP{selectedOrders.length === 1 ? '' : 's'})
          </Button>
        </div>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" /> Filtros e seleção
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 h-9"
                placeholder="Buscar por OP, PV, cliente, referência, cor…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                // Auto-limpa selectedIds (mesmo motivo do pvFilter): evita
                // OPs fantasmas de status anterior contaminarem o batch.
                setSelectedIds(new Set());
              }}
            >
              <SelectTrigger className="w-52 h-9">
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
              <SelectTrigger className="w-44 h-9" title="Filtra OPs por PV — evita contaminar batch com OPs de outros PVs">
                <SelectValue placeholder="Por PV" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os PVs</SelectItem>
                {pvOptions.map(pv => <SelectItem key={pv} value={pv}>{pv}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground ml-2">
              {filtered.length} OP{filtered.length === 1 ? '' : 's'} encontrada{filtered.length === 1 ? '' : 's'}
              {/* Conta a seleção VISÍVEL (selectedOrders já está escopado a
                  `filtered`), não selectedIds.size — que pode carregar seleções
                  de buscas anteriores escondidas pelo filtro atual. */}
              {selectedOrders.length > 0 && ` · ${selectedOrders.length} selecionada${selectedOrders.length === 1 ? '' : 's'} · ${totalPairs} pares`}
            </div>
          </div>

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
            <EmptyState
              size="sm"
              icon={FileText}
              title="Nenhuma OP encontrada"
              description="Ajuste os filtros de status, PV ou a busca para encontrar OPs."
            />
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
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
                        className={`border-t border-border/40 cursor-pointer ${
                          checked
                            ? 'bg-primary/5 hover:bg-primary/10'
                            // Linha infantil com fundo rosa-claro — mesmo padrão
                            // visual da lista de Pedidos de Venda.
                            : inf
                              ? 'bg-pink-500/[0.06] hover:bg-pink-500/[0.11]'
                              : 'hover:bg-muted/30'
                        }`}
                        onClick={() => toggleOne(r.id)}
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
                        <td className="p-2 text-right font-mono">{r.quantity}</td>
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
          )}
        </CardContent>
      </Card>

      <Card className="bg-muted/30 border-border/50">
        <CardContent className="p-3 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Fichas disponíveis no print:</p>
          <ul className="list-disc ml-4 space-y-0.5">
            <li><strong>Por setor</strong>: Corte Palmilha · Corte Forração · Costura · Aviamento · Silk · Colagem · Montagem · Solagem · Acabamento</li>
            <li><strong>Expedição</strong>: 1 ficha por cliente, agrupando todas as OPs do mesmo CNPJ</li>
            <li><strong>Relatório Gerencial</strong>: 1 ficha A4 por PV com KPIs, status por setor, tabela de custos e margens</li>
          </ul>
          <p className="mt-2">
            Após gerar, use Ctrl+P (ou Cmd+P) para imprimir; o layout é otimizado para A4.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
