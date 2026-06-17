import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { FacaBoundary } from '@/lib/knifeFacas';

// Padrão GLOBAL de facas de Corte Cabedal (faixas P/M/G), reutilizado por todas
// as fichas. Guardado em system_settings.key='knife_facas_default' como JSON
// (mesmo padrão de armazenamento dos outros settings — value é string JSON).
// Pedido user 2026-06-16: define uma vez ("Salvar como padrão" na ficha), todas
// as referências herdam; override por ficha em technical_sheets.knife_size_ranges.

const KEY = 'knife_facas_default';

function parseBoundaries(raw: unknown): FacaBoundary[] | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!Array.isArray(v)) return null;
  const out: FacaBoundary[] = [];
  for (const item of v as any[]) {
    if (!item || typeof item.label !== 'string') continue;
    out.push({
      label: String(item.label),
      upTo: item.upTo == null ? null : String(item.upTo),
      code: item.code ? String(item.code) : undefined,
    });
  }
  return out.length > 0 ? out : null;
}

export function useKnifeFacasDefault() {
  return useQuery({
    queryKey: ['knife_facas_default'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<FacaBoundary[] | null> => {
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

export function useSaveKnifeFacasDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (boundaries: FacaBoundary[]) => {
      const { error } = await (supabase as any)
        .from('system_settings')
        .upsert(
          { key: KEY, value: JSON.stringify(boundaries), updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knife_facas_default'] });
      toast.success('Padrão de facas salvo — novas fichas e as sem cadastro próprio vão herdar.');
    },
    onError: (e: Error) => toast.error(`Erro ao salvar padrão: ${e.message}`),
  });
}
