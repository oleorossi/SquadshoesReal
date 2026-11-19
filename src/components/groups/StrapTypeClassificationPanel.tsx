import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleNotch as Loader2, Scissors } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useGroups } from '@/hooks/useGroups';
import { useProducts } from '@/hooks/useProducts';
import { supabase } from '@/integrations/supabase/client';
import { classifyStrapGroups } from '@/lib/strapTypeClassification';

/**
 * Lista tiras sem tipo ou incoerentes. O botão grava só as inequívocas
 * (strass sem origem e com SKU). O restante o dono classifica no grupo.
 */
export default function StrapTypeClassificationPanel() {
  const { data: groups = [], isLoading: groupsLoading } = useGroups();
  const { data: products = [], isLoading: productsLoading } = useProducts();
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState(false);

  const { auto, pending } = useMemo(
    () => classifyStrapGroups(groups, products),
    [groups, products],
  );

  const applyAuto = async () => {
    if (auto.length === 0 || applying) return;
    setApplying(true);
    try {
      for (const row of auto) {
        const { error } = await supabase
          .from('product_groups')
          .update({ is_artisanal_strap: true, strap_origin: 'comprar_pronto' })
          .eq('id', row.groupId);
        if (error) throw error;
      }
      await queryClient.invalidateQueries({ queryKey: ['product_groups'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(
        auto.length === 1
          ? '1 tira classificada como comprada pronta.'
          : `${auto.length} tiras classificadas como comprada pronta.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível classificar.');
    } finally {
      setApplying(false);
    }
  };

  if (groupsLoading || productsLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Lendo grupos de tira…
      </div>
    );
  }

  if (auto.length === 0 && pending.length === 0) return null;

  return (
    <section className="space-y-3 border border-border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <Scissors className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Tipo da tira</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Comprada pronta usa o SKU do grupo. Artesanal pede napa e rendimento.
              Só o strass sem origem e com SKU entra sozinho. O resto você classifica no grupo.
            </p>
          </div>
        </div>
        <Button type="button" size="sm" disabled={auto.length === 0 || applying} onClick={applyAuto}>
          {applying ? 'Classificando…' : `Classificar ${auto.length} inequívoca${auto.length === 1 ? '' : 's'}`}
        </Button>
      </div>
      {auto.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Comprada pronta, se você confirmar ({auto.length})
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {auto.map((row) => (
              <li key={row.groupId}>{row.name} · {row.skuCount} SKU{row.skuCount === 1 ? '' : 's'}</li>
            ))}
          </ul>
        </div>
      )}
      {pending.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pendentes ({pending.length})
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {pending.map((row) => (
              <li key={row.groupId}>
                <span className="font-medium">{row.name}</span>
                <span className="text-muted-foreground"> — {row.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
