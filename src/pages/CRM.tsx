import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, Phone, Mail, MessageSquare, Calendar, Cake, AlertCircle, Repeat } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

const CHANNEL_ICONS: Record<string, any> = {
  ligacao: Phone, email: Mail, whatsapp: MessageSquare, sms: MessageSquare,
  visita: Calendar, reuniao: Calendar, feira: Calendar, outro: Calendar,
};

export default function CRM() {
  const { data: interactions = [] } = useQuery({
    queryKey: ['crm_interactions'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('crm_interactions')
        .select('*, clients(razao_social)')
        .order('completed_at', { ascending: false })
        .limit(50);
      return data || [];
    },
  });

  const { data: inactive = [] } = useQuery({
    queryKey: ['crm_inactive'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('v_crm_inactive_clients').select('*').limit(30);
      return data || [];
    },
  });

  const { data: birthdays = [] } = useQuery({
    queryKey: ['crm_birthdays'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('v_crm_birthdays_month').select('*');
      return data || [];
    },
  });

  const { data: repurchase = [] } = useQuery({
    queryKey: ['crm_repurchase'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('v_crm_expected_repurchase')
        .select('*')
        .order('days_until_expected', { ascending: true })
        .limit(30);
      return data || [];
    },
  });

  const { data: nps = [] } = useQuery({
    queryKey: ['crm_nps'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('crm_nps_responses').select('*, clients(razao_social)')
        .order('responded_at', { ascending: false }).limit(30);
      return data || [];
    },
  });

  const npsScore = nps.length > 0
    ? Math.round(
        (((nps.filter((n: any) => n.category === 'promotor').length / nps.length) * 100) -
         ((nps.filter((n: any) => n.category === 'detrator').length / nps.length) * 100))
      )
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CRM</h1>
          <p className="text-sm text-muted-foreground">Histórico, campanhas, recompra prevista, NPS</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => toast.info('Nova interação em breve')}>
          <Plus className="h-4 w-4" /> Nova Interação
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Interações 30d</p>
            <p className="text-2xl font-bold tracking-tight">{interactions.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Inativos &gt;90d</p>
            <p className="text-2xl font-bold tracking-tight text-amber-600">{inactive.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Aniversariantes</p>
            <p className="text-2xl font-bold tracking-tight">{birthdays.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">NPS Score</p>
            <p className={`text-2xl font-bold tracking-tight ${
              npsScore >= 70 ? 'text-emerald-600' : npsScore >= 30 ? 'text-amber-600' : 'text-destructive'
            }`}>{npsScore}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="interactions">
        <TabsList>
          <TabsTrigger value="interactions">Interações</TabsTrigger>
          <TabsTrigger value="inactive">Inativos</TabsTrigger>
          <TabsTrigger value="birthdays">Aniversariantes</TabsTrigger>
          <TabsTrigger value="repurchase">Recompra Prevista</TabsTrigger>
          <TabsTrigger value="nps">NPS</TabsTrigger>
        </TabsList>

        <TabsContent value="interactions">
          <Card>
            <CardContent className="p-0">
              {interactions.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">Sem interações registradas</p>
              ) : (
                <div className="divide-y">
                  {interactions.map((i: any) => {
                    const Icon = CHANNEL_ICONS[i.interaction_type] || Calendar;
                    return (
                      <div key={i.id} className="p-3 flex items-start gap-3 text-sm">
                        <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{i.subject}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {i.clients?.razao_social || '—'} · {format(new Date(i.completed_at), 'dd/MM HH:mm', { locale: ptBR })}
                          </p>
                          {i.notes && <p className="text-xs mt-1 text-muted-foreground">{i.notes}</p>}
                        </div>
                        {i.outcome && <Badge variant="outline" className="text-[10px] capitalize">{i.outcome}</Badge>}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inactive">
          <Card>
            <CardContent className="p-0">
              {inactive.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">Nenhum cliente inativo &gt;90 dias</p>
              ) : (
                <div className="divide-y">
                  {inactive.map((c: any) => (
                    <div key={c.client_id} className="p-3 flex items-center gap-3 text-sm">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{c.razao_social}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.total_orders} pedido(s) · último em {c.last_order_date ? format(new Date(c.last_order_date), 'dd/MM/yyyy') : '—'}
                        </p>
                      </div>
                      <Badge variant="outline">{c.days_inactive}d inativo</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="birthdays">
          <Card>
            <CardContent className="p-0">
              {birthdays.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">Sem aniversariantes este mês</p>
              ) : (
                <div className="divide-y">
                  {birthdays.map((b: any) => (
                    <div key={b.client_id} className="p-3 flex items-center gap-3 text-sm">
                      <Cake className="h-4 w-4 text-pink-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{b.razao_social}</p>
                        {b.nome_fantasia && <p className="text-xs text-muted-foreground truncate">{b.nome_fantasia}</p>}
                      </div>
                      <Badge>Dia {b.day_of_month}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="repurchase">
          <Card>
            <CardContent className="p-0">
              {repurchase.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">Sem dados de recompra (precisa &ge; 2 pedidos por cliente)</p>
              ) : (
                <div className="divide-y">
                  {repurchase.map((r: any) => (
                    <div key={r.client_id} className="p-3 flex items-center gap-3 text-sm">
                      <Repeat className={`h-4 w-4 shrink-0 ${
                        r.days_until_expected <= 0 ? 'text-destructive' :
                        r.days_until_expected <= 14 ? 'text-amber-500' : 'text-emerald-500'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{r.razao_social}</p>
                        <p className="text-xs text-muted-foreground">
                          Ciclo médio {r.avg_cycle_days}d · esperado em {format(new Date(r.expected_repurchase_date), 'dd/MM/yyyy')}
                        </p>
                      </div>
                      <Badge variant={r.days_until_expected <= 0 ? 'destructive' : 'outline'}>
                        {r.days_until_expected <= 0 ? `${-r.days_until_expected}d atraso` : `em ${r.days_until_expected}d`}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nps">
          <Card>
            <CardContent className="p-0">
              {nps.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">Nenhuma resposta NPS coletada ainda</p>
              ) : (
                <div className="divide-y">
                  {nps.map((n: any) => (
                    <div key={n.id} className="p-3 flex items-center gap-3 text-sm">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                        n.category === 'promotor' ? 'bg-emerald-100 text-emerald-700' :
                        n.category === 'neutro' ? 'bg-amber-100 text-amber-700' :
                        'bg-destructive/10 text-destructive'
                      }`}>{n.score}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{n.clients?.razao_social || '—'}</p>
                        {n.feedback && <p className="text-xs text-muted-foreground italic">"{n.feedback}"</p>}
                      </div>
                      <Badge variant="outline" className="capitalize">{n.category}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
