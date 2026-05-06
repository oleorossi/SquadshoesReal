import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CalendarClock, AlertTriangle, Truck, Clock, ShoppingCart, Loader2, Package, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { format, addDays, isAfter, isBefore, parseISO, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

interface Projection {
  order_id: string;
  pedido_ref: string;
  sale_order_id: string;
  data_entrega_cliente: string;
  op_quantity: number;
  data_inicio_producao: string;
  material_id: string;
  material: string;
  material_group_id: string | null;
  grupo_material: string | null;
  unidade: string;
  estoque_atual: number;
  min_stock: number;
  supplier_lead_time_days: number;
  supplier_id: string | null;
  supplier_name: string | null;
  quantidade_necessaria: number;
  data_limite_compra: string;
  order_status: string;
  reference_id: string;
  referencia_nome: string;
}

function useProjections() {
  return useQuery({
    queryKey: ['purchase_projection_timeline'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_projection_timeline' as any)
        .select('*')
        .order('data_limite_compra', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Projection[];
    },
  });
}

// Group projections by material to avoid duplicates
function groupByMaterial(projections: Projection[]) {
  const map = new Map<string, {
    material_id: string;
    material: string;
    grupo_material: string | null;
    unidade: string;
    estoque_atual: number;
    supplier_name: string | null;
    supplier_lead_time_days: number;
    quantidade_necessaria: number;
    data_limite_compra: string;
    pedidos: { pedido_ref: string; referencia_nome: string; op_quantity: number }[];
  }>();

  for (const p of projections) {
    const existing = map.get(p.material_id);
    if (existing) {
      existing.quantidade_necessaria += p.quantidade_necessaria;
      existing.pedidos.push({ pedido_ref: p.pedido_ref, referencia_nome: p.referencia_nome, op_quantity: p.op_quantity });
      // Keep the earliest deadline
      if (p.data_limite_compra < existing.data_limite_compra) {
        existing.data_limite_compra = p.data_limite_compra;
      }
    } else {
      map.set(p.material_id, {
        material_id: p.material_id,
        material: p.material,
        grupo_material: p.grupo_material,
        unidade: p.unidade,
        estoque_atual: p.estoque_atual,
        supplier_name: p.supplier_name,
        supplier_lead_time_days: p.supplier_lead_time_days,
        quantidade_necessaria: p.quantidade_necessaria,
        data_limite_compra: p.data_limite_compra,
        pedidos: [{ pedido_ref: p.pedido_ref, referencia_nome: p.referencia_nome, op_quantity: p.op_quantity }],
      });
    }
  }

  return Array.from(map.values());
}

export function PurchaseTimeline() {
  const { data: projections = [], isLoading } = useProjections();
  const queryClient = useQueryClient();
  const [isApproving, setIsApproving] = useState(false);
  // Memoiza para que dependências de useMemo não recriem a cada render.
  const today = useMemo(() => startOfDay(new Date()), []);
  const in7Days = useMemo(() => addDays(today, 7), [today]);

  const grouped = useMemo(() => groupByMaterial(projections), [projections]);

  const critical = useMemo(
    () => grouped.filter(p => isBefore(parseISO(p.data_limite_compra), today)),
    [grouped, today]
  );
  const next7 = useMemo(
    () => grouped.filter(p => {
      const d = parseISO(p.data_limite_compra);
      return !isBefore(d, today) && isBefore(d, in7Days);
    }),
    [grouped, today, in7Days]
  );
  const planned = useMemo(
    () => grouped.filter(p => isAfter(parseISO(p.data_limite_compra), in7Days)),
    [grouped, in7Days]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const formatDate = (d: string) => {
    try { return format(parseISO(d), "dd/MM/yyyy", { locale: ptBR }); }
    catch { return d; }
  };

  const handleGerarOC = (materialName: string) => {
    toast.info(`Funcionalidade de OC automática para "${materialName}" será implementada em breve.`);
  };

  const handleApproveAllPending = async () => {
    setIsApproving(true);
    try {
      const { data: pendingPOs, error: fetchErr } = await supabase
        .from('purchase_orders')
        .select('id, order_number')
        .eq('status', 'pending');
      if (fetchErr) throw fetchErr;

      if (!pendingPOs || pendingPOs.length === 0) {
        toast.info('Nenhuma solicitação pendente para aprovar.');
        return;
      }

      const ids = pendingPOs.map((p) => p.id);
      const { error: updErr } = await supabase
        .from('purchase_orders')
        .update({ status: 'approved' })
        .in('id', ids);
      if (updErr) throw updErr;

      toast.success(`${pendingPOs.length} solicitação(ões) aprovada(s) com sucesso!`);
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase_projection_timeline'] });
    } catch (err: any) {
      toast.error('Erro ao aprovar solicitações: ' + (err.message || 'desconhecido'));
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-lg">Projeção de Suprimentos</CardTitle>
                <CardDescription>Cronograma de compras baseado no Lead Time dos fornecedores.</CardDescription>
              </div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="default" size="sm" disabled={isApproving || grouped.length === 0}>
                  {isApproving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                  Aprovar Todas
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Aprovar todas as solicitações pendentes?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação altera o status de todas as Ordens de Compra pendentes para <strong>Aprovado</strong>,
                    liberando-as para envio aos fornecedores. Verifique antes os fornecedores e quantidades.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleApproveAllPending}>Confirmar aprovação</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardHeader>
      </Card>


      {grouped.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Nenhuma projeção disponível. Verifique se as OPs possuem data de entrega e fichas técnicas com materiais vinculados.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* COLUMN 1: CRITICAL / OVERDUE */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
            <AlertTriangle className="h-4 w-4" />
            Comprar HOJE ({critical.length})
          </div>
          {critical.length === 0 && (
            <Card><CardContent className="py-4 text-sm text-muted-foreground text-center">Nenhum item crítico 🎉</CardContent></Card>
          )}
          {critical.map(item => (
            <Card key={item.material_id} className="border-destructive/50 bg-destructive/5">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {item.pedidos.map(p => p.pedido_ref).join(', ')}
                  </span>
                  <Badge variant="destructive">Atrasado</Badge>
                </div>
                <p className="font-medium text-sm">{item.material}</p>
                {item.grupo_material && <p className="text-xs text-muted-foreground">{item.grupo_material}</p>}
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <p className="text-muted-foreground">Qtd. Necessária</p>
                    <p className="font-semibold">{item.quantidade_necessaria.toFixed(1)} {item.unidade}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Estoque Atual</p>
                    <p className="font-semibold">{item.estoque_atual} {item.unidade}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    <Truck className="inline h-3 w-3 mr-1" />
                    {item.supplier_name || 'Sem fornecedor'} • {item.supplier_lead_time_days}d
                  </span>
                  <Button size="sm" variant="destructive" onClick={() => handleGerarOC(item.material)}>
                    <ShoppingCart className="h-3 w-3 mr-1" /> Gerar OC
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* COLUMN 2: NEXT 7 DAYS */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-amber-600 font-semibold text-sm">
            <Clock className="h-4 w-4" />
            Próximos 7 Dias ({next7.length})
          </div>
          {next7.length === 0 && (
            <Card><CardContent className="py-4 text-sm text-muted-foreground text-center">Nenhum item nesta faixa</CardContent></Card>
          )}
          {next7.map(item => (
            <Card key={item.material_id} className="border-amber-300/50 bg-amber-50/30 dark:bg-amber-950/10">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {item.pedidos.map(p => p.pedido_ref).join(', ')}
                  </span>
                  <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    {formatDate(item.data_limite_compra)}
                  </Badge>
                </div>
                <p className="font-medium text-sm">{item.material}</p>
                {item.grupo_material && <p className="text-xs text-muted-foreground">{item.grupo_material}</p>}
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <p className="text-muted-foreground">Qtd. Necessária</p>
                    <p className="font-semibold">{item.quantidade_necessaria.toFixed(1)} {item.unidade}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Prazo Fornecedor</p>
                    <p className="font-semibold">{item.supplier_lead_time_days} dias</p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  <Truck className="inline h-3 w-3 mr-1" />
                  {item.supplier_name || 'Sem fornecedor'}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* COLUMN 3: FUTURE PLANNING */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm">
            <CalendarClock className="h-4 w-4" />
            Planejamento ({planned.length})
          </div>
          {planned.length === 0 && (
            <Card><CardContent className="py-4 text-sm text-muted-foreground text-center">Nenhum item planejado</CardContent></Card>
          )}
          {planned.map(item => (
            <Card key={item.material_id} className="border-emerald-300/30">
              <CardContent className="p-4 space-y-1">
                <p className="font-medium text-sm">{item.material}</p>
                <p className="text-xs text-muted-foreground">
                  {item.quantidade_necessaria.toFixed(1)} {item.unidade} • Data Limite: {formatDate(item.data_limite_compra)}
                </p>
                <span className="text-xs text-muted-foreground">
                  <Truck className="inline h-3 w-3 mr-1" />
                  {item.supplier_name || 'Sem fornecedor'} • {item.supplier_lead_time_days}d lead time
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
