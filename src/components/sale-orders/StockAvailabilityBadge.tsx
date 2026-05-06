import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PackageCheck, AlertTriangle, Loader2 } from 'lucide-react';

interface Props {
  referenceId: string;
  quantity: number;
  color: string;
}

export default function StockAvailabilityBadge({ referenceId, quantity, color }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['stock_check_inline', referenceId, quantity, color],
    enabled: !!referenceId && quantity > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('check_stock_availability', {
        p_reference_id: referenceId,
        p_order_quantity: quantity,
        p_color: color || '',
      } as any);
      if (error) throw error;
      return data as Array<{
        product_id: string;
        product_name: string;
        required: number;
        available: number;
        sufficient: boolean;
      }>;
    },
    staleTime: 30_000,
    gcTime: 60_000,
  });

  if (!referenceId || quantity <= 0) return null;
  if (isLoading) return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
  if (!data) return null;

  const shortages = data.filter(m => !m.sufficient);
  const allOk = shortages.length === 0;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={allOk ? 'secondary' : 'destructive'}
            className={`text-[9px] h-4 px-1.5 gap-0.5 cursor-default ${allOk ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' : ''}`}
          >
            {allOk ? (
              <><PackageCheck className="h-2.5 w-2.5" /> Estoque OK</>
            ) : (
              <><AlertTriangle className="h-2.5 w-2.5" /> {shortages.length} falta(s)</>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          {allOk ? (
            <p className="text-xs">Todos os {data.length} materiais disponíveis em estoque.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-xs font-bold">Materiais em falta:</p>
              {shortages.slice(0, 5).map((s, i) => (
                <p key={i} className="text-xs">
                  {s.product_name}: <span className="font-mono">{s.available.toFixed(1)}</span> / <span className="font-mono">{s.required.toFixed(1)}</span>
                </p>
              ))}
              {shortages.length > 5 && <p className="text-xs text-muted-foreground">+{shortages.length - 5} mais...</p>}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
