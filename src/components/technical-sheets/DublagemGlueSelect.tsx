import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  compositeGroupId: string;
  value: string | null;
  onChange: (glueId: string | null) => void;
}

const NONE = '__none__';

/** Select da cola padrão da ficha quando o cabedal é grupo composto. */
export default function DublagemGlueSelect({ compositeGroupId, value, onChange }: Props) {
  const layersQuery = useQuery({
    queryKey: ['product_group_layers', compositeGroupId, 'dublagem-gate'],
    enabled: !!compositeGroupId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('product_group_layers')
        .select('id')
        .eq('composite_group_id', compositeGroupId);
      if (error) throw error;
      return data || [];
    },
  });

  const gluesQuery = useQuery({
    queryKey: ['product_group_dublagem_glues', compositeGroupId, 'active'],
    enabled: !!compositeGroupId && (layersQuery.data?.length || 0) >= 2,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('product_group_dublagem_glues')
        .select('id,name,price_per_m')
        .eq('composite_group_id', compositeGroupId)
        .eq('is_active', true)
        .order('display_order')
        .order('name');
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string; price_per_m: number }>;
    },
  });

  if ((layersQuery.data?.length || 0) < 2) return null;

  return (
    <div className="space-y-1.5 pt-2 border-t border-border/40">
      <Label className="text-xs">Cola padrão de dublagem</Label>
      <Select
        value={value || NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
      >
        <SelectTrigger className="h-9">
          <SelectValue placeholder="Sem cola (só faces)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Sem cola cadastrada</SelectItem>
          {(gluesQuery.data || []).map((glue) => (
            <SelectItem key={glue.id} value={glue.id}>
              {glue.name}
              {' · '}
              {Number(glue.price_per_m).toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              })}
              /m
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        O item do PV herda esta cola (somente leitura). Preço entra só no custeio.
      </p>
    </div>
  );
}
