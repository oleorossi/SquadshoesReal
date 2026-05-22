import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type GroupingStrategy =
  | 'sole_color'
  | 'ref_color'
  | 'sole_only'
  | 'color_only'
  | 'client'
  | 'none';

export interface SectorGroupingConfigRow {
  sector: string;
  strategy: GroupingStrategy;
  notes: string | null;
}

/**
 * Defaults usados quando a tabela ainda não foi carregada (offline/loading)
 * ou quando um setor novo ainda não está cadastrado em sector_grouping_config.
 * Mantêm o comportamento histórico do sistema — zero risco de regressão.
 */
const DEFAULTS: Readonly<Record<string, GroupingStrategy>> = {
  'Corte Palmilha': 'sole_only',
  'Corte Forração': 'sole_color',
  'Corte Cabedal':  'sole_color',
  'Silk':           'ref_color',
  'Costura':        'sole_color',
  'Aviamento':      'sole_color',
  'Montagem':       'ref_color',
  'Colagem':        'ref_color',
  'Solagem':        'color_only',
  'Acabamento':     'ref_color',
  'Expedição':      'client',
};

/**
 * Lê sector_grouping_config do Supabase com fallback pros defaults.
 *
 * Política de cache: 5min (raramente muda; admin altera via SQL/UI quando
 * a operação evolui — não precisa ser tempo real).
 */
export const useSectorGroupingConfig = () => {
  const query = useQuery({
    queryKey: ['sector-grouping-config'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SectorGroupingConfigRow[]> => {
      const { data, error } = await supabase
        .from('sector_grouping_config' as any)
        .select('sector, strategy, notes');
      if (error) {
        console.warn('[useSectorGroupingConfig] fallback to defaults:', error.message);
        return [];
      }
      return (data as any[]) ?? [];
    },
  });

  const getStrategy = (sector: string): GroupingStrategy => {
    const row = query.data?.find(r => r.sector === sector);
    return row?.strategy ?? DEFAULTS[sector] ?? 'ref_color';
  };

  const getSectorsByStrategy = (strategy: GroupingStrategy): string[] => {
    const fromDb = (query.data ?? [])
      .filter(r => r.strategy === strategy)
      .map(r => r.sector);
    if (fromDb.length > 0) return fromDb;
    // Fallback aos defaults quando a query ainda não retornou.
    return Object.entries(DEFAULTS)
      .filter(([_, s]) => s === strategy)
      .map(([sector]) => sector);
  };

  return {
    ...query,
    getStrategy,
    getSectorsByStrategy,
  };
};
