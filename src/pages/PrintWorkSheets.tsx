import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import PrintWorkSheetsPage from '@/components/production/PrintWorkSheetsPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, MagnifyingGlass as Search, CircleNotch as Loader2, FileText, Funnel as Filter } from '@phosphor-icons/react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { normalizeForSearch } from '@/lib/searchUtils';

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
  sale_orders?: { order_number: string; client_name: string; delivery_deadline: string | null } | null;
  technical_sheets?: { name: string; code: string | null } | null;
  /** Sequência de tiras do item de PV (ordem TIRA 1, TIRA 2, ...).
   *  Trazido via join sale_order_items pra que as fichas de operador
   *  mostrem cada tira com sua cor na ordem definida na ficha técnica. */
  sale_order_items?: { strap_colors: Array<{ id?: string; label?: string; color?: string; group_id?: string; group_name?: string }> | null } | null;
}

// Status REAIS de `orders` (OPs) no backend, conforme auditoria 2026-05:
//   Reservado · Em Produção · Finalizado
// Antes a UI listava 'Pronto' e 'Faturado' que não existem em orders
// ('Faturado' é status de sale_orders, não de orders). Remover essas opções
// mortas evita o filtro mostrar vazio e o user achar que algo sumiu.
// Default 'em_fluxo' cobre OPs ainda passíveis de impressão de ficha.
const STATUS_OPTIONS = ['Reservado', 'Em Produção', 'Finalizado'];
const EM_FLUXO = ['Reservado', 'Em Produção'];

export default function PrintWorkSheets() {
  const [statusFilter, setStatusFilter] = useState<string>('em_fluxo');
  const [pvFilter, setPvFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showPrintView, setShowPrintView] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['print_worksheets_orders', statusFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from('orders')
        // sale_orders!sale_order_id desambigua: orders tem 2 FKs pra sale_orders
        // (sale_order_id e cross_dock_sale_order_id). PostgREST não escolhe sozinho.
        .select('id, order_number, reference_id, color, quantity, grade, status, sale_order_id, sale_order_item_id, sale_orders!sale_order_id(order_number, client_name, delivery_deadline), technical_sheets:reference_id(name, code), sale_order_items!sale_order_item_id(strap_colors)')
        .order('order_number', { ascending: false })
        .limit(500);
      if (statusFilter === 'em_fluxo') {
        q = q.in('status', EM_FLUXO);
      } else if (statusFilter !== 'todos') {
        q = q.eq('status', statusFilter);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as OrderRow[];
    },
  });

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
      const tokens = search.split(',').map(t => normalizeForSearch(t)).filter(Boolean);
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
    return rows
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
        status: r.status,
        // Sequência de tiras preservando a ordem (TIRA 1, TIRA 2, ...). Vazio
        // pra modelos sem tiras. As fichas de operador (Aviamento, Colagem)
        // renderizam essa sequência pra cortador/aviamento saber qual tira
        // recebe qual cor (relevante quando o cliente pede mix de cores).
        strap_colors: Array.isArray(r.sale_order_items?.strap_colors)
          ? r.sale_order_items!.strap_colors
          : [],
      }));
  }, [rows, selectedIds]);

  if (showPrintView) {
    return (
      <PrintWorkSheetsPage
        orders={selectedOrders}
        onBack={() => setShowPrintView(false)}
      />
    );
  }

  const totalPairs = selectedOrders.reduce((s, o) => s + (o.total_pairs ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <Printer className="h-7 w-7 text-primary mt-1" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Imprimir Fichas de Produção</h1>
            <p className="text-sm text-muted-foreground">
              Selecione as OPs e escolha qual ficha gerar: por setor (Corte/Costura/Silk/Montagem/Solagem/Acabamento),
              Expedição agrupada por cliente, ou Relatório Gerencial completo do PV.
            </p>
          </div>
        </div>
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
      </div>

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
              {selectedIds.size > 0 && ` · ${selectedIds.size} selecionada${selectedIds.size === 1 ? '' : 's'} · ${totalPairs} pares`}
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 italic">
              Nenhuma OP encontrada com esse filtro.
            </p>
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
                    return (
                      <tr
                        key={r.id}
                        className={`border-t border-border/40 cursor-pointer hover:bg-muted/30 ${checked ? 'bg-primary/5' : ''}`}
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
                        <td className="p-2 font-mono font-bold">{r.order_number}</td>
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
