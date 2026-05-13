import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type SectorKey = 'costura' | 'mesa' | 'corte_palmilha' | 'corte_forracao';

export interface ContributingOrder {
  order_id: string;
  order_number: string;
  sale_order_id: string | null;
  sheet_name: string | null;
  color: string | null;
  quantity: number;
  planned_delivery: string;
  pairs_per_day: number;
}

export interface SectorBottleneck {
  sector: SectorKey;
  week_start: string; // ISO date (Monday)
  iso_year: number;
  iso_week: number;
  ops_count: number;
  total_pairs_planned: number;
  total_capacity_week: number;
  utilization_pct: number;
  is_bottleneck: boolean;
  severity: 'ok' | 'warning' | 'critical';
  contributing_orders: ContributingOrder[];
}

export const SECTOR_LABEL: Record<SectorKey, string> = {
  costura: 'Costura',
  mesa: 'Aviamento',
  corte_palmilha: 'Corte Palmilha',
  corte_forracao: 'Corte Forração',
};

export function useSectorBottlenecks() {
  return useQuery({
    queryKey: ['v_sector_bottlenecks'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_sector_bottlenecks')
        .select('*')
        .order('week_start', { ascending: true })
        .order('sector', { ascending: true });
      if (error) throw error;
      return (data || []) as SectorBottleneck[];
    },
    staleTime: 60_000,
  });
}

// Apenas os gargalos REAIS (is_bottleneck=true), ordenados por severidade
export function useActiveBottlenecks() {
  const all = useSectorBottlenecks();
  const data = (all.data || []).filter(b => b.is_bottleneck).sort((a, b) => {
    const sev = { critical: 0, warning: 1, ok: 2 };
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
    return a.week_start.localeCompare(b.week_start);
  });
  return { ...all, data };
}

// Criar OS terceirizada a partir de um gargalo específico
export interface CreateServiceOrderForBottleneckInput {
  contractor_id: string;
  order_id: string;
  sale_order_id: string | null;
  target_sector: SectorKey;
  bottleneck_week: string; // ISO date
  quantity: number;
  unit_price: number;
  description?: string;
  notes?: string;
}

export function useCreateServiceOrderForBottleneck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateServiceOrderForBottleneckInput) => {
      const total = (input.quantity || 0) * (input.unit_price || 0);
      // service_date provisório = hoje; quoted_deadline ainda não definido (vem na resposta da costureira)
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await (supabase as any)
        .from('service_orders')
        .insert({
          contractor_id: input.contractor_id,
          order_id: input.order_id,
          sale_order_id: input.sale_order_id,
          target_sector: input.target_sector,
          bottleneck_week: input.bottleneck_week,
          quantity: input.quantity,
          unit_price: input.unit_price,
          total_value: total,
          service_date: today,
          status: 'pending_quote',
          description: input.description || `Cobertura de gargalo em ${SECTOR_LABEL[input.target_sector]} — semana ${input.bottleneck_week}`,
          notes: input.notes ?? null,
          order_number: `OS-GARG-${Date.now()}`,
        })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['v_sector_bottlenecks'] });
      toast.success('Ordem de serviço criada. Aguardando confirmação de prazo pela contratada.');
    },
    onError: (err: any) => {
      toast.error(`Falha ao criar OS: ${err.message || 'erro desconhecido'}`);
    },
  });
}

// Confirmar prazo prometido pela contratada → destrava OP pra Montagem
export function useConfirmServiceOrderQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ service_order_id, quoted_deadline, unit_price }: {
      service_order_id: string;
      quoted_deadline: string;
      unit_price?: number;
    }) => {
      const patch: any = {
        status: 'quoted',
        quoted_at: new Date().toISOString(),
        quoted_deadline,
      };
      if (typeof unit_price === 'number') {
        patch.unit_price = unit_price;
      }
      const { error } = await (supabase as any)
        .from('service_orders')
        .update(patch)
        .eq('id', service_order_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      toast.success('Prazo confirmado. A OP pode avançar pra Montagem.');
    },
    onError: (err: any) => {
      toast.error(`Falha ao confirmar prazo: ${err.message}`);
    },
  });
}
