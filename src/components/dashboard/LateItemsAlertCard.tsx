import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Warning as AlertTriangle, Truck, Buildings as Briefcase } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface LatePO {
  id: string;
  order_number: string;
  supplier_name: string;
  promised_date: string;
  days_late: number;
}

interface LateOS {
  id: string;
  order_number: string;
  contractor_name: string;
  quoted_deadline: string;
  days_late: number;
}

/**
 * Card de alerta unificado de atrasos: agrega OCs vencidas (compra de matéria-prima)
 * e OSs terceirizadas em atraso (produção externa). Pensado pra ficar no Dashboard
 * principal ou no PCPDashboard como widget de "fogo no telhado".
 *
 * Limites: mostra até 5 mais antigas de cada tipo; link "ver todos" leva pra
 * /comprar e /terceirizados respectivamente. Cards inteiros viram link clicável.
 */
export function LateItemsAlertCard() {
  // Memoizado: today calculado uma vez no mount evita que query keys mudem
  // a cada render (queryKey ['late-pos-alert', today] precisa ser estável).
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const todayMs = useMemo(() => new Date(today + 'T12:00:00').getTime(), [today]);

  const { data: latePOs = [] } = useQuery({
    queryKey: ['late-pos-alert', today],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('id, order_number, supplier_name, promised_date')
        .lt('promised_date', today)
        .not('status', 'in', '("received","cancelled","receiving")')
        .order('promised_date', { ascending: true })
        .limit(5);
      if (error) throw error;
      return ((data || []) as any[]).map((p) => ({
        ...p,
        days_late: Math.max(0, Math.floor((todayMs - new Date(p.promised_date + 'T12:00:00').getTime()) / 86_400_000)),
      })) as LatePO[];
    },
  });

  // OSs vencidas: por quoted_deadline (caminho normal) OU por created_at velho
  // sem deadline (OS criada sem service_date — invisível ao filtro padrão).
  const { data: lateOSs = [] } = useQuery({
    queryKey: ['late-os-alert', today],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const tenDaysAgo = new Date(todayMs - 10 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await (supabase as any)
        .from('service_orders')
        .select('id, order_number, quoted_deadline, created_at, contractors(name)')
        .or(`quoted_deadline.lt.${today},and(quoted_deadline.is.null,created_at.lt.${tenDaysAgo})`)
        .not('status', 'in', '("received","Concluído","concluido","Cancelado","cancelled","cancelado")')
        .order('quoted_deadline', { ascending: true, nullsFirst: false })
        .limit(5);
      if (error) throw error;
      return ((data || []) as any[]).map((o) => {
        const reference = o.quoted_deadline || o.created_at;
        return {
          id: o.id,
          order_number: o.order_number,
          contractor_name: o.contractors?.name || 'Sem contratada',
          quoted_deadline: o.quoted_deadline || o.created_at,
          days_late: Math.max(0, Math.floor((todayMs - new Date(reference.slice(0, 10) + 'T12:00:00').getTime()) / 86_400_000)),
        };
      }) as LateOS[];
    },
  });

  const totalLate = latePOs.length + lateOSs.length;
  if (totalLate === 0) return null;

  return (
    <Card className="p-4 border-2 border-destructive/40 bg-destructive/5">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
        <h3 className="font-bold text-sm text-destructive">Itens em Atraso</h3>
        <Badge variant="destructive" className="ml-auto">{totalLate}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {latePOs.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              <Truck className="h-3 w-3" /> Ordens de Compra ({latePOs.length})
            </div>
            {latePOs.map((po) => (
              <Link
                key={po.id}
                to="/comprar"
                className="block p-2 rounded border border-destructive/20 bg-card hover:bg-destructive/10 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold">{po.order_number}</span>
                  <span className={cn(
                    'text-xs font-mono',
                    po.days_late > 7 ? 'text-destructive font-bold' : 'text-destructive/80',
                  )}>
                    {po.days_late}d
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{po.supplier_name}</div>
              </Link>
            ))}
            {latePOs.length === 5 && (
              <Link to="/comprar" className="block text-[10px] text-center text-muted-foreground hover:text-destructive pt-1">
                ver todas →
              </Link>
            )}
          </div>
        )}

        {lateOSs.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              <Briefcase className="h-3 w-3" /> OSs Terceirizadas ({lateOSs.length})
            </div>
            {lateOSs.map((os) => (
              <Link
                key={os.id}
                to="/terceirizados"
                className="block p-2 rounded border border-destructive/20 bg-card hover:bg-destructive/10 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold">{os.order_number}</span>
                  <span className={cn(
                    'text-xs font-mono',
                    os.days_late > 7 ? 'text-destructive font-bold' : 'text-destructive/80',
                  )}>
                    {os.days_late}d
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{os.contractor_name}</div>
              </Link>
            ))}
            {lateOSs.length === 5 && (
              <Link to="/terceirizados" className="block text-[10px] text-center text-muted-foreground hover:text-destructive pt-1">
                ver todas →
              </Link>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
