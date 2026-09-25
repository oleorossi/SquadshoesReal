import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { computeDublagemFaceQuantities } from '@/lib/dublagemDemand';

interface Props {
  upperGroupId: string | null | undefined;
  pvColor: string;
  pairs: number;
  upperConsumptionDm2PerPair: number;
  dublagemMode: 'internal' | 'external' | null | undefined;
  onModeChange: (mode: 'internal' | 'external' | null) => void;
  glueName?: string | null;
  gluePricePerM?: number | null;
}

interface LayerRow {
  component_group_id: string | null;
  is_color_source: boolean;
  component_label?: string | null;
  role?: string | null;
  display_order?: number | null;
}

interface FaceSheetRow {
  id: string;
  group_id: string | null;
  product_id?: string | null;
  dimensions_width?: number | null;
  dimensions_length?: number | null;
  dimensions_unit?: string | null;
}

/**
 * Toggle interna/externa + preview dm²/m das faces.
 * Visível só quando o cabedal resolvido tem product_group_layers (≥2).
 */
export default function SaleOrderItemDublagemControls({
  upperGroupId,
  pvColor,
  pairs,
  upperConsumptionDm2PerPair,
  dublagemMode,
  onModeChange,
  glueName,
  gluePricePerM,
}: Props) {
  const layersQuery = useQuery({
    queryKey: ['product_group_layers', upperGroupId, 'pv-dublagem'],
    enabled: !!upperGroupId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('product_group_layers')
        .select('component_group_id,is_color_source,component_label,role,display_order')
        .eq('composite_group_id', upperGroupId)
        .order('display_order');
      if (error) throw error;
      return (data || []) as LayerRow[];
    },
  });

  const isComposite = (layersQuery.data?.length || 0) >= 2;

  const sheetsQuery = useQuery({
    queryKey: [
      'dublagem-face-sheets',
      upperGroupId,
      layersQuery.data?.map((l) => l.component_group_id).join(','),
    ],
    enabled: isComposite,
    queryFn: async () => {
      const groupIds = (layersQuery.data || [])
        .map((l) => l.component_group_id)
        .filter((id): id is string => !!id);
      if (groupIds.length === 0) return { external: null, internal: null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('component_sheets')
        .select('id,group_id,product_id,dimensions_width,dimensions_length,dimensions_unit')
        .in('group_id', groupIds);
      if (error) throw error;
      const sheets = (data || []) as FaceSheetRow[];
      const extGroup = (layersQuery.data || []).find((l) => l.is_color_source)?.component_group_id;
      const intGroup = (layersQuery.data || []).find((l) => !l.is_color_source)?.component_group_id;
      const pick = (gid: string | null | undefined) =>
        sheets.find((s) => s.group_id === gid) || null;
      return { external: pick(extGroup), internal: pick(intGroup) };
    },
  });

  const preview = useMemo(() => {
    const dm2 = Math.max(0, Number(upperConsumptionDm2PerPair) || 0) * Math.max(0, Number(pairs) || 0);
    return computeDublagemFaceQuantities({
      upperDm2Total: dm2,
      pvColor,
      externalSheet: sheetsQuery.data?.external || null,
      internalSheet: sheetsQuery.data?.internal || null,
    });
  }, [upperConsumptionDm2PerPair, pairs, pvColor, sheetsQuery.data]);

  if (!upperGroupId || layersQuery.isLoading) return null;
  if (!isComposite) return null;

  return (
    <div className="md:col-span-12 space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label className="text-xs font-bold uppercase text-muted-foreground">Dublagem</Label>
          <p className="text-[11px] text-muted-foreground">
            Faces (napa + Massa Box). Cola herdada da ficha
            {glueName
              ? `: ${glueName}${gluePricePerM != null ? ` · ${Number(gluePricePerM).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/m` : ''}`
              : ' (não cadastrada)'}
            .
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            className={`h-8 rounded-md px-3 text-xs font-medium border ${
              dublagemMode === 'internal'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-foreground border-border hover:bg-muted/40'
            }`}
            onClick={() => onModeChange(dublagemMode === 'internal' ? null : 'internal')}
          >
            Interna
          </button>
          <button
            type="button"
            className={`h-8 rounded-md px-3 text-xs font-medium border ${
              dublagemMode === 'external'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-foreground border-border hover:bg-muted/40'
            }`}
            onClick={() => onModeChange(dublagemMode === 'external' ? null : 'external')}
          >
            Externa
          </button>
        </div>
      </div>

      {dublagemMode && (
        <div className="grid gap-2 sm:grid-cols-2">
          {preview.map((face) => (
            <div key={face.face} className="rounded-md border bg-card px-3 py-2 text-xs">
              <p className="font-semibold uppercase tracking-wide text-muted-foreground">
                {face.face === 'external' ? 'Face externa (cor PV)' : 'Massa Box'}
              </p>
              <p className="mt-1">
                Cor <strong>{face.color || '—'}</strong>
              </p>
              <p className="tabular-nums">
                {face.dm2.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} dm²
                {' · '}
                {face.widthMissing
                  ? `${face.linearM.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} (sem largura)`
                  : `${face.linearM.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m`}
              </p>
            </div>
          ))}
        </div>
      )}

      {!dublagemMode && (
        <p className="text-[11px] text-muted-foreground">
          Sem modo = legado (compra/debita o SKU acabado). Interna reserva as faces; externa força compra das faces.
        </p>
      )}
    </div>
  );
}
