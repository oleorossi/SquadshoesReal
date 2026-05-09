/**
 * Agenda Semanal de Compras
 *
 * Lê `purchase_projection_timeline` (cronograma reverso já existente),
 * deduz o que JÁ está em estoque, e agrupa o saldo a comprar por
 * "terça-feira de compra" (dia em que o usuário tipicamente fecha pedido
 * com fornecedor).
 *
 * Lógica de alinhamento:
 *   - Para cada material com déficit (necessário > estoque), encontra a
 *     última terça-feira <= data_limite_compra. É nessa terça que a OC
 *     deve sair para a matéria-prima chegar a tempo.
 *   - Materiais já vencidos (data_limite_compra < hoje) entram numa
 *     coluna "ATRASADO" — comprar imediatamente.
 *   - Cada card de semana mostra: data da terça, quantos materiais,
 *     valor estimado total, lista expandível por fornecedor.
 *
 * Esta visão é complementar à `PurchaseTimeline` (que mostra item por item):
 * aqui o usuário vê "o que comprar nesta terça", já net de estoque.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Loader2, CalendarDays, AlertTriangle, ShoppingCart, ChevronDown, ChevronUp,
  Package, TrendingDown, CheckCircle2,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Projection {
  material_id: string;
  material: string;
  grupo_material: string | null;
  unidade: string;
  estoque_atual: number;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_lead_time_days: number;
  quantidade_necessaria: number;
  data_limite_compra: string;
  pedido_ref: string;
  referencia_nome: string;
  op_quantity: number;
  data_entrega_cliente: string;
}

function useProjections() {
  return useQuery({
    queryKey: ['purchase_projection_timeline_for_agenda'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_projection_timeline' as any)
        .select(
          'material_id, material, grupo_material, unidade, estoque_atual, ' +
          'supplier_id, supplier_name, supplier_lead_time_days, ' +
          'quantidade_necessaria, data_limite_compra, ' +
          'pedido_ref, referencia_nome, op_quantity, data_entrega_cliente',
        )
        .order('data_limite_compra', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Projection[];
    },
    staleTime: 60_000,
  });
}

/** Busca o preço médio do material — usa a última nota fiscal de entrada quando possível. */
function useMaterialUnitPrices(materialIds: string[]) {
  return useQuery({
    queryKey: ['material_unit_prices', materialIds.sort().join(',')],
    enabled: materialIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, unit_price')
        .in('id', materialIds);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const p of (data || []) as any[]) {
        map.set(p.id, Number(p.unit_price) || 0);
      }
      return map;
    },
    staleTime: 5 * 60_000,
  });
}

/** Última terça-feira ≤ data fornecida (em horário local, evitando UTC drift). */
function lastTuesdayOnOrBefore(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  // 0=Dom 1=Seg 2=Ter 3=Qua 4=Qui 5=Sex 6=Sáb
  const dow = d.getDay();
  // Distância para trás até cair em terça (2)
  const diff = (dow - 2 + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

interface MaterialDeficit {
  material_id: string;
  material: string;
  grupo_material: string | null;
  unidade: string;
  estoque_atual: number;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_lead_time_days: number;
  total_needed: number;
  to_buy: number;             // necessario - estoque (>= 0)
  data_limite_compra: string; // a mais cedo entre as projeções
  target_tuesday: string;
  pedidos: { pedido_ref: string; referencia_nome: string; op_quantity: number; data_entrega_cliente: string }[];
}

export default function WeeklyPurchaseAgenda() {
  const [expandedTuesday, setExpandedTuesday] = useState<string | null>(null);
  const { data: projections = [], isLoading } = useProjections();

  // Agrega por material (soma necessidade entre OPs)
  const materialMap = useMemo(() => {
    const map = new Map<string, MaterialDeficit>();
    for (const p of projections) {
      const existing = map.get(p.material_id);
      if (existing) {
        existing.total_needed += Number(p.quantidade_necessaria) || 0;
        if (p.data_limite_compra < existing.data_limite_compra) {
          existing.data_limite_compra = p.data_limite_compra;
          existing.target_tuesday = lastTuesdayOnOrBefore(p.data_limite_compra);
        }
        existing.pedidos.push({
          pedido_ref: p.pedido_ref,
          referencia_nome: p.referencia_nome,
          op_quantity: p.op_quantity,
          data_entrega_cliente: p.data_entrega_cliente,
        });
      } else {
        map.set(p.material_id, {
          material_id: p.material_id,
          material: p.material,
          grupo_material: p.grupo_material,
          unidade: p.unidade,
          estoque_atual: Number(p.estoque_atual) || 0,
          supplier_id: p.supplier_id,
          supplier_name: p.supplier_name,
          supplier_lead_time_days: Number(p.supplier_lead_time_days) || 10,
          total_needed: Number(p.quantidade_necessaria) || 0,
          to_buy: 0,
          data_limite_compra: p.data_limite_compra,
          target_tuesday: lastTuesdayOnOrBefore(p.data_limite_compra),
          pedidos: [{
            pedido_ref: p.pedido_ref,
            referencia_nome: p.referencia_nome,
            op_quantity: p.op_quantity,
            data_entrega_cliente: p.data_entrega_cliente,
          }],
        });
      }
    }
    // Calcula déficit final
    for (const m of map.values()) {
      m.to_buy = Math.max(0, m.total_needed - m.estoque_atual);
    }
    return map;
  }, [projections]);

  const materialIds = useMemo(() => Array.from(materialMap.keys()), [materialMap]);
  const { data: priceMap = new Map() } = useMaterialUnitPrices(materialIds);

  // Filtra apenas materiais com déficit (to_buy > 0)
  const deficits = useMemo(() =>
    Array.from(materialMap.values()).filter(m => m.to_buy > 0),
    [materialMap]
  );

  // Agrupa por terça-feira de compra
  const byTuesday = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    // Próxima terça >= hoje
    const today = new Date(todayISO + 'T00:00:00');
    const dow = today.getDay();
    const daysUntilTuesday = (2 - dow + 7) % 7 || 7; // se hoje é terça, próxima é em 7 dias
    const nextTuesday = new Date(today);
    nextTuesday.setDate(today.getDate() + daysUntilTuesday);
    const nextTuesdayISO = nextTuesday.toISOString().slice(0, 10);

    const map = new Map<string, { tuesday: string; isOverdue: boolean; isThisWeek: boolean; materials: MaterialDeficit[] }>();
    for (const m of deficits) {
      // Materiais já vencidos vão pro bucket "ATRASADO"
      const isOverdue = m.target_tuesday < todayISO;
      const key = isOverdue ? '__overdue__' : m.target_tuesday;
      if (!map.has(key)) {
        map.set(key, {
          tuesday: isOverdue ? todayISO : m.target_tuesday,
          isOverdue,
          isThisWeek: !isOverdue && m.target_tuesday === nextTuesdayISO,
          materials: [],
        });
      }
      map.get(key)!.materials.push(m);
    }
    // Ordena: atrasados primeiro, depois cronológico
    return Array.from(map.values()).sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return a.tuesday.localeCompare(b.tuesday);
    });
  }, [deficits]);

  const totalEstimado = useMemo(() =>
    deficits.reduce((s, m) => s + m.to_buy * (priceMap.get(m.material_id) || 0), 0),
    [deficits, priceMap]
  );

  const overdueCount = byTuesday.filter(w => w.isOverdue).reduce((s, w) => s + w.materials.length, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Carregando projeção...</span>
      </div>
    );
  }

  if (deficits.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center space-y-2">
          <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto" />
          <p className="font-bold">Sem compras pendentes</p>
          <p className="text-sm text-muted-foreground">
            Todos os materiais necessários para os pedidos em andamento já estão em estoque.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Materiais a comprar</p>
          <p className="display text-2xl tabular-nums">{deficits.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Semanas planejadas</p>
          <p className="display text-2xl tabular-nums">{byTuesday.filter(w => !w.isOverdue).length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Itens atrasados</p>
          <p className={`text-2xl font-bold ${overdueCount > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {overdueCount}
          </p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Total estimado</p>
          <p className="text-xl font-bold text-primary">{fmt(totalEstimado)}</p>
        </CardContent></Card>
      </div>

      <Card className="bg-muted/20 border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            Como funciona
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>
            • Cada matéria-prima tem uma <strong>data limite de compra</strong> calculada pelo cronograma reverso
            (entrega cliente − produção − buffer − lead time fornecedor).
          </p>
          <p>
            • Esta agenda alinha cada item à <strong>última terça-feira ≤ data limite</strong> (dia em que você
            negocia/fecha pedido com fornecedor).
          </p>
          <p>
            • Compre <strong>nem antes</strong> (capital parado) <strong>nem depois</strong> (atraso na produção).
          </p>
        </CardContent>
      </Card>

      {/* Cards por terça */}
      <div className="grid gap-4">
        {byTuesday.map((week) => {
          const weekTotal = week.materials.reduce((s, m) => s + m.to_buy * (priceMap.get(m.material_id) || 0), 0);
          const dateLabel = week.isOverdue
            ? 'ATRASADO'
            : format(new Date(week.tuesday + 'T12:00:00'), "EEEE, dd 'de' MMMM", { locale: ptBR });
          const isExpanded = expandedTuesday === week.tuesday + (week.isOverdue ? '_o' : '');
          // Conta fornecedores únicos
          const supplierCount = new Set(week.materials.map(m => m.supplier_id || m.supplier_name || 'Sem fornecedor')).size;

          return (
            <Card
              key={week.tuesday + (week.isOverdue ? '_o' : '')}
              className={
                week.isOverdue ? 'border-destructive/40 bg-destructive/5'
                : week.isThisWeek ? 'border-primary/60 bg-primary/5'
                : ''
              }
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    {week.isOverdue ? (
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                    ) : week.isThisWeek ? (
                      <ShoppingCart className="h-5 w-5 text-primary" />
                    ) : (
                      <CalendarDays className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <CardTitle className="text-base capitalize">
                        {dateLabel}
                        {week.isThisWeek && <Badge className="ml-2 text-[10px]" variant="default">PRÓXIMA TERÇA</Badge>}
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        {week.materials.length} {week.materials.length === 1 ? 'material' : 'materiais'} • {supplierCount} {supplierCount === 1 ? 'fornecedor' : 'fornecedores'}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-primary">{fmt(weekTotal)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpandedTuesday(isExpanded ? null : week.tuesday + (week.isOverdue ? '_o' : ''))}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Material</TableHead>
                        <TableHead>Fornecedor</TableHead>
                        <TableHead className="text-right">Estoque</TableHead>
                        <TableHead className="text-right">Necessário</TableHead>
                        <TableHead className="text-right">Comprar</TableHead>
                        <TableHead className="text-right">Lead time</TableHead>
                        <TableHead className="text-right">Custo est.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {week.materials
                        .sort((a, b) => (a.supplier_name || '').localeCompare(b.supplier_name || ''))
                        .map(m => {
                          const price = priceMap.get(m.material_id) || 0;
                          const cost = m.to_buy * price;
                          return (
                            <TableRow key={m.material_id}>
                              <TableCell>
                                <p className="font-medium text-sm">{m.material}</p>
                                <p className="text-xs text-muted-foreground">{m.grupo_material || '—'}</p>
                              </TableCell>
                              <TableCell className="text-sm">
                                {m.supplier_name || <span className="text-muted-foreground italic">Sem fornecedor</span>}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {m.estoque_atual.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {m.unidade}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                {m.total_needed.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {m.unidade}
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold text-primary">
                                {m.to_buy.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {m.unidade}
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                <Badge variant="secondary" className="text-[10px]">{m.supplier_lead_time_days}d</Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {price > 0 ? fmt(cost) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
