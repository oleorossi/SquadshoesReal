import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Warning as AlertTriangle, LinkSimple as Link2, CircleNotch as Loader2, Check,
} from '@phosphor-icons/react';
import { toast } from 'sonner';

/**
 * Componentes diretos cujo produto foi APAGADO do estoque.
 *
 * `technical_sheets.direct_components` é jsonb, não FK — o produto some e a
 * ficha fica apontando pro nada (ver mig 20261028120000). O modal de consumo só
 * avisa depois: "não resolve produto no estoque — NÃO será reservado nem
 * debitado", e o componente some do custo e da compra em silêncio.
 *
 * Recadastrar NÃO reata: produto novo nasce com ID novo. Este painel é o
 * caminho de volta — aponta o vínculo órfão pra um produto existente em todas
 * as fichas de uma vez.
 */

type OrphanRow = {
  dead_product_id: string;
  names: string[];
  sheets_count: number;
  sheet_names: string[];
  quantities: number[];
};

type PickableProduct = { id: string; name: string; color: string | null };

/** As duas RPCs não estão nos types gerados — cast local, não espalhado. */
const rpc = supabase.rpc.bind(supabase) as unknown as
  (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export default function OrphanDirectComponentsPanel() {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<string, string>>({});

  const { data: orphans = [], isLoading } = useQuery({
    queryKey: ['orphan_direct_components'],
    queryFn: async () => {
      const { data, error } = await rpc('list_orphan_direct_components');
      if (error) throw new Error(error.message);
      return (data || []) as OrphanRow[];
    },
    staleTime: 60_000,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products_for_relink'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, color, category')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as PickableProduct[];
    },
    staleTime: 60_000,
  });

  const productOptions = useMemo(
    () => products.map((p) => ({
      value: p.id,
      label: [p.name, p.color].filter(Boolean).join(' · '),
    })),
    [products],
  );

  const relink = useMutation({
    mutationFn: async (vars: { dead: string; next: string }) => {
      const { data, error } = await rpc('relink_direct_component', {
        p_dead_product_id: vars.dead,
        p_new_product_id: vars.next,
      });
      if (error) throw new Error(error.message);
      return data as { sheets_updated: number; new_product_name: string };
    },
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['orphan_direct_components'] });
      qc.invalidateQueries({ queryKey: ['technical_sheets'] });
      setPicked((prev) => {
        const next = { ...prev };
        delete next[vars.dead];
        return next;
      });
      toast.success(
        `Religado a "${res.new_product_name}" em ${res.sheets_updated} ${res.sheets_updated === 1 ? 'ficha' : 'fichas'}.`,
      );
    },
    onError: (err: any) => toast.error(`Erro ao religar: ${err.message}`),
  });

  const totalLinhas = orphans.reduce((acc, o) => acc + o.sheets_count, 0);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Procurando componentes órfãos…
      </div>
    );
  }

  if (orphans.length === 0) {
    return (
      <EmptyState
        icon={Check}
        title="Nenhum componente órfão"
        description="Toda ficha aponta pra um produto que existe no estoque."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>{orphans.length}</strong> {orphans.length === 1 ? 'produto apagado' : 'produtos apagados'} ainda
          {' '}{orphans.length === 1 ? 'é referenciado' : 'são referenciados'} por <strong>{totalLinhas}</strong>
          {' '}{totalLinhas === 1 ? 'ficha' : 'fichas'}. Esses componentes <strong>não são reservados nem debitados</strong> —
          somem do custo do par e da compra. Aponte cada um pro produto correto abaixo.
        </span>
      </div>

      {orphans.map((o) => {
        const nomeConflitante = o.names.filter(Boolean).length > 1;
        return (
          <div key={o.dead_product_id} className="rounded-md border border-border p-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm">{o.names.filter(Boolean).join(' / ') || '(sem nome)'}</span>
              <Badge variant="outline" className="text-[11px]">
                {o.sheets_count} {o.sheets_count === 1 ? 'ficha' : 'fichas'}
              </Badge>
              <Badge variant="outline" className="text-[11px]">
                {o.quantities.filter((q) => q > 0).join(' / ')} por par
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              {o.sheet_names.join(' · ')}
            </p>

            {/* O nome no jsonb é retrato do momento em que a linha foi criada,
                não identidade. Quando o mesmo ID aparece com nomes diferentes,
                religar em massa pode colocar a peça errada em parte das fichas. */}
            {nomeConflitante && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Este mesmo produto está gravado com <strong>nomes diferentes</strong> entre as fichas
                  ({o.names.filter(Boolean).join(' e ')}). O nome guardado é do momento em que a linha foi criada,
                  então <strong>confira na bancada</strong> antes de religar — pode não ser a mesma peça em todas.
                </span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 min-w-0">
                <SearchableSelect
                  value={picked[o.dead_product_id] || ''}
                  onChange={(v) => setPicked((prev) => ({ ...prev, [o.dead_product_id]: v }))}
                  options={productOptions}
                  placeholder="Escolha o produto que substitui…"
                />
              </div>
              <Button
                size="sm"
                className="h-9 gap-1.5 shrink-0"
                disabled={!picked[o.dead_product_id] || relink.isPending}
                onClick={() => relink.mutate({ dead: o.dead_product_id, next: picked[o.dead_product_id] })}
              >
                {relink.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Link2 className="h-3.5 w-3.5" />}
                Religar {o.sheets_count > 1 ? `nas ${o.sheets_count}` : ''}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
