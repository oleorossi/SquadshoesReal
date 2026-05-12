import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link, Package } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';

export default function PackagingLinksPanel() {
  const { data: links = [], isLoading } = useQuery({
    queryKey: ['packaging_links_overview_by_sole'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('product_groups')
        .select('id, name, box_type_id, box_type_master_id, box_type_colmeia_id, box_type_fitilho_id, pairs_per_box_individual, pairs_per_box_master, pairs_per_box_colmeia, pairs_per_box_fitilho, box_individual:box_type_id(nome), box_master:box_type_master_id(nome), box_colmeia:box_type_colmeia_id(nome), box_fitilho:box_type_fitilho_id(nome)')
        .or('box_type_id.not.is.null,box_type_master_id.not.is.null,box_type_colmeia_id.not.is.null,box_type_fitilho_id.not.is.null')
        .order('name');
      if (error) throw error;
      const rows: any[] = [];
      (data || []).forEach((g: any) => {
        if (g.box_type_id)         rows.push({ key: g.id+'_i', soleName: g.name, type: 'individual', boxName: g.box_individual?.nome, pairs: g.pairs_per_box_individual ?? 1 });
        if (g.box_type_master_id)  rows.push({ key: g.id+'_m', soleName: g.name, type: 'master',     boxName: g.box_master?.nome,     pairs: g.pairs_per_box_master ?? 12 });
        if (g.box_type_colmeia_id) rows.push({ key: g.id+'_c', soleName: g.name, type: 'colmeia',    boxName: g.box_colmeia?.nome,    pairs: g.pairs_per_box_colmeia ?? 12 });
        if (g.box_type_fitilho_id) rows.push({ key: g.id+'_f', soleName: g.name, type: 'fitilho',    boxName: g.box_fitilho?.nome,    pairs: g.pairs_per_box_fitilho ?? 1 });
      });
      return rows;
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link className="h-5 w-5 text-primary" />
          Vínculos Solado–Embalagem
        </CardTitle>
      </CardHeader>
      <CardContent>
        {links.length === 0 ? (
          <div className="text-center py-8">
            <Package className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">
              Nenhum vínculo configurado. Vincule embalagens na aba Embalagem da Ficha Técnica — a configuração é por solado.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {links.map((l: any) => {
              return (
                <div key={l.key} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <Package className="h-4 w-4 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium">
                        {l.soleName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {l.boxName || '—'} — {l.pairs} pares/caixa
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {l.type === 'individual' ? 'Individual' : l.type === 'master' ? 'Master' : l.type === 'colmeia' ? 'Colméia' : 'Fitilho'}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
