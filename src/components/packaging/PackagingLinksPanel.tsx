import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link, Package, Stack as Layers } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';

type SoleGroup = {
  id: string;
  name: string;
  box_type_id: string | null;
  box_type_master_id: string | null;
  box_type_colmeia_id: string | null;
  box_type_fitilho_id: string | null;
  pairs_per_box_individual: number | null;
  pairs_per_box_master: number | null;
  pairs_per_box_colmeia: number | null;
  pairs_per_box_fitilho: number | null;
  box_individual: { nome: string } | null;
  box_master: { nome: string } | null;
  box_colmeia: { nome: string } | null;
  box_fitilho: { nome: string } | null;
};

type ModeKey = 'tradicional' | 'colmeia' | 'amarrado';
type ModeRow = {
  modeKey: ModeKey;
  modeLabel: string;
  modeDescription: string;
  modeIcon: typeof Layers;
  ratio?: string;
  parts: { label: string; boxName: string; pairs: number | null; pairsLabel: string }[];
};

function buildModes(g: SoleGroup): ModeRow[] {
  const modes: ModeRow[] = [];

  // Tradicional: individual + master
  if (g.box_type_id && g.box_type_master_id) {
    const pairsInd = g.pairs_per_box_individual ?? 1;
    const pairsMaster = g.pairs_per_box_master ?? 12;
    const ratio = pairsInd > 0 ? Math.round(pairsMaster / pairsInd) : null;
    modes.push({
      modeKey: 'tradicional',
      modeLabel: 'Tradicional',
      modeDescription: 'Individual dentro de master',
      modeIcon: Layers,
      ratio: ratio ? `${ratio} individuais / master` : undefined,
      parts: [
        { label: 'Individual', boxName: g.box_individual?.nome || '—', pairs: pairsInd, pairsLabel: `${pairsInd} par/caixa` },
        { label: 'Master', boxName: g.box_master?.nome || '—', pairs: pairsMaster, pairsLabel: `${pairsMaster} pares/caixa` },
      ],
    });
  }

  // Colméia
  if (g.box_type_colmeia_id) {
    const pairs = g.pairs_per_box_colmeia ?? 12;
    modes.push({
      modeKey: 'colmeia',
      modeLabel: 'Colméia',
      modeDescription: '1 caixa = N pares',
      modeIcon: Box,
      parts: [
        { label: 'Colméia', boxName: g.box_colmeia?.nome || '—', pairs, pairsLabel: `${pairs} pares/caixa` },
      ],
    });
  }

  // Amarrado: individual + fitilho
  if (g.box_type_id && g.box_type_fitilho_id) {
    const pairsInd = g.pairs_per_box_individual ?? 1;
    const pairsFit = g.pairs_per_box_fitilho ?? 12;
    modes.push({
      modeKey: 'amarrado',
      modeLabel: 'Amarrado',
      modeDescription: 'Individuais amarradas com fitilho',
      modeIcon: Link2,
      ratio: `${pairsFit} pares/amarrado`,
      parts: [
        { label: 'Individual', boxName: g.box_individual?.nome || '—', pairs: pairsInd, pairsLabel: `${pairsInd} par/caixa` },
        { label: 'Fitilho', boxName: g.box_fitilho?.nome || '—', pairs: pairsFit, pairsLabel: `${pairsFit} pares/amarrado` },
      ],
    });
  }

  return modes;
}

export default function PackagingLinksPanel() {
  const { data: groups = [], isLoading } = useQuery<SoleGroup[]>({
    queryKey: ['packaging_links_overview_by_sole'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('product_groups')
        .select('id, name, box_type_id, box_type_master_id, box_type_colmeia_id, box_type_fitilho_id, pairs_per_box_individual, pairs_per_box_master, pairs_per_box_colmeia, pairs_per_box_fitilho, box_individual:box_type_id(nome), box_master:box_type_master_id(nome), box_colmeia:box_type_colmeia_id(nome), box_fitilho:box_type_fitilho_id(nome)')
        .or('box_type_id.not.is.null,box_type_master_id.not.is.null,box_type_colmeia_id.not.is.null,box_type_fitilho_id.not.is.null')
        .order('name');
      if (error) throw error;
      return (data || []) as SoleGroup[];
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
        {groups.length === 0 ? (
          <div className="text-center py-8">
            <Package className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">
              Nenhum vínculo configurado. Vincule embalagens na aba Embalagem da Ficha Técnica — a configuração é por solado.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const modes = buildModes(g);
              return (
                <div key={g.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <Package className="h-4 w-4 text-primary shrink-0" />
                      {g.name}
                    </p>
                    {modes.length === 0 ? (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Configuração incompleta
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        {modes.length} {modes.length === 1 ? 'modo' : 'modos'}
                      </Badge>
                    )}
                  </div>

                  {modes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Slots vinculados não formam um modo completo (ex.: master sem individual).
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {modes.map(m => {
                        const Icon = m.modeIcon;
                        return (
                          <div key={m.modeKey} className="rounded border bg-muted/30 p-2">
                            <div className="flex items-center justify-between gap-1">
                              <p className="text-xs font-semibold flex items-center gap-1">
                                <Icon className="h-3.5 w-3.5 text-primary" />
                                {m.modeLabel}
                              </p>
                              {m.ratio && (
                                <span className="text-[10px] text-muted-foreground">{m.ratio}</span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground mb-1">{m.modeDescription}</p>
                            <ul className="text-[11px] space-y-0.5">
                              {m.parts.map((p, i) => (
                                <li key={i} className="flex items-center gap-1">
                                  <span className="text-muted-foreground">{p.label}:</span>
                                  <span className="font-medium truncate">{p.boxName}</span>
                                  <span className="text-muted-foreground tabular-nums">· {p.pairsLabel}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
