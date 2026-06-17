import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { PmgBoundary } from '@/lib/aviamentoSizeRanges';

// Padrão GLOBAL das faixas P/M/G do Aviamento, reutilizado por todas as fichas.
// Guardado em system_settings.key='aviamento_pmg_default' como JSON (value é
// string JSON, igual aos demais settings). Define uma vez ("Salvar como padrão"
// na aba Range Aviamento), todas as referências herdam; override por ficha em
// technical_sheets.aviamento_size_ranges. Segmento PRÓPRIO — não toca no padrão
// das facas de Corte Cabedal. (Pedido user 2026-06-17.)

const KEY = 'aviamento_pmg_default';

function parseBoundaries(raw: unknown): PmgBoundary[] | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!Array.isArray(v)) return null;
  const out: PmgBoundary[] = [];
  for (const item of v as any[]) {
    if (!item || typeof item.label !== 'string') continue;
    out.push({
      label: String(item.label),
      upTo: item.upTo == null ? null : String(item.upTo),
    });
  }
  return out.length > 0 ? out : null;
}

export function useAviamentoPmgDefault() {
  return useQuery({
    queryKey: ['aviamento_pmg_default'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PmgBoundary[] | null> => {
      const { data, error } = await (supabase as any)
        .from('system_settings')
        .select('value')
        .eq('key', KEY)
        .maybeSingle();
      if (error) throw error;
      return parseBoundaries((data as any)?.value);
    },
  });
}

export function useSaveAviamentoPmgDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (boundaries: PmgBoundary[]) => {
      const { error } = await (supabase as any)
        .from('system_settings')
        .upsert(
          { key: KEY, value: JSON.stringify(boundaries), updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aviamento_pmg_default'] });
      toast.success('Padrão de faixas do Aviamento salvo — novas fichas e as sem cadastro próprio vão herdar.');
    },
    onError: (e: Error) => toast.error(`Erro ao salvar padrão: ${e.message}`),
  });
}
