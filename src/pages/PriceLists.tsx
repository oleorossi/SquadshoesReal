import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, DollarSign, Calendar, Tag } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function PriceLists() {
  const { data: lists = [], isLoading } = useQuery({
    queryKey: ['price_lists'],
    queryFn: async () => {
      // Sem embed de clients pra evitar 300 do PostgREST quando o relacionamento
      // ainda não foi exposto. Fazemos lookup do nome do cliente em fetch separado
      // se houver client_id.
      const { data, error } = await (supabase as any)
        .from('price_lists')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const clientIds = [...new Set((data || []).map((p: any) => p.client_id).filter(Boolean))];
      if (clientIds.length === 0) return (data || []).map((p: any) => ({ ...p, client_name: null }));

      const { data: clients } = await (supabase as any)
        .from('clients')
        .select('id, razao_social')
        .in('id', clientIds);
      const clientMap = new Map((clients || []).map((c: any) => [c.id, c.razao_social]));
      return (data || []).map((p: any) => ({ ...p, client_name: clientMap.get(p.client_id) ?? null }));
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tabelas de Preço</h1>
          <p className="text-sm text-muted-foreground">
            Preços por canal, região, cliente e vigência
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => toast.info('Editor avançado em breve')}>
          <Plus className="h-4 w-4" /> Nova Tabela
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!isLoading && lists.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <DollarSign className="h-10 w-10 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Nenhuma tabela de preço cadastrada</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {lists.map((pl: any) => (
          <Card key={pl.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Tag className="h-4 w-4 text-primary" />
                  {pl.name}
                </CardTitle>
                <Badge variant={pl.active ? 'default' : 'secondary'} className="text-[10px]">
                  {pl.active ? 'Ativa' : 'Inativa'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Canal</span>
                <span className="font-semibold capitalize">{pl.channel}</span>
              </div>
              {pl.region_uf && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Região</span>
                  <span className="font-mono font-semibold">{pl.region_uf}</span>
                </div>
              )}
              {pl.client_name && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cliente</span>
                  <span className="font-semibold truncate ml-2">{pl.client_name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Vigência
                </span>
                <span className="font-mono">
                  {format(new Date(pl.valid_from), 'dd/MM/yy')}
                  {pl.valid_to ? ` → ${format(new Date(pl.valid_to), 'dd/MM/yy')}` : ' →'}
                </span>
              </div>
              {pl.is_promotional && (
                <Badge variant="outline" className="text-[9px] mt-1">PROMOCIONAL</Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
