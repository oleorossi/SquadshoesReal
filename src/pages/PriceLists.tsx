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
      const { data, error } = await (supabase as any)
        .from('price_lists')
        .select('*, clients(razao_social)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
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
              {pl.clients?.razao_social && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cliente</span>
                  <span className="font-semibold truncate ml-2">{pl.clients.razao_social}</span>
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
