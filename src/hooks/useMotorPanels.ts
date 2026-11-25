/**
 * Leituras do menu "Motor de produção" (/motor). Só leitura: o plano vem de
 * v_production_motor_plan, o Ateliê de atelier_jobs_expected_dates() e das
 * reservas marcadas como atelier_prep (20270101054700/054800).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MotorPlanRow {
  order_key: string;
  order_id: string | null;
  order_number: string | null;
  sale_order_id: string | null;
  sale_order_number: string | null;
  reference_code: string | null;
  color: string | null;
  pairs: number | null;
  is_virtual: boolean;
  item_class: 'complexo' | 'simples' | null;
  billing_anchor: string | null;
  billing_week: string | null;
  is_urgent: boolean;
  pv_progress: number | null;
  motor_position: number;
  earliest_start: string | null;
  cabedal_expected_return: string | null;
  material_eta: string | null;
  wait_reason: string | null;
  projected_completion: string | null;
  days_vs_billing: number | null;
  computed_at: string | null;
}

export function useMotorPlan() {
  return useQuery({
    queryKey: ['motor', 'plan'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_production_motor_plan' as never)
        .select('*')
        .order('motor_position', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as MotorPlanRow[];
    },
    staleTime: 30_000,
  });
}

export interface MotorAtelierJob {
  job_id: string;
  sale_order_id: string | null;
  sale_order_item_id: string | null;
  sector: string;
  prep_business_days: number | null;
  target_start: string | null;
  kit_material_eta: string | null;
  planned_send: string | null;
  expected_return: string | null;
  capacity_pushed: boolean;
  returned: boolean;
  pv: string | null;
  color: string | null;
  reference: string | null;
}

export interface MotorAtelierReservation {
  id: string;
  pv: string | null;
  material: string;
  reserved: number;
  short: number;
  unit: string | null;
}

export function useMotorAtelier() {
  return useQuery({
    queryKey: ['motor', 'atelier'],
    queryFn: async () => {
      const { data: jobs, error } = await supabase.rpc('atelier_jobs_expected_dates' as never);
      if (error) throw error;
      const rows = ((jobs ?? []) as unknown as Omit<MotorAtelierJob, 'pv' | 'color' | 'reference'>[]);
      const soIds = [...new Set(rows.map((r) => r.sale_order_id).filter(Boolean))] as string[];
      const itemIds = [...new Set(rows.map((r) => r.sale_order_item_id).filter(Boolean))] as string[];

      const [pvs, items, reservations] = await Promise.all([
        soIds.length
          ? supabase.from('sale_orders').select('id, order_number').in('id', soIds)
          : Promise.resolve({ data: [], error: null }),
        itemIds.length
          ? supabase.from('sale_order_items').select('id, color, technical_sheets(code, name)').in('id', itemIds)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('material_reservations' as never)
          .select('id, quantity_reserved, quantity_short, status, products!material_reservations_product_id_fkey(name, color, unit), sale_orders!material_reservations_sale_order_id_fkey(order_number)')
          .eq('metadata->>kind', 'atelier_prep')
          .in('status', ['reserved'])
          .limit(500),
      ]);
      if (pvs.error) throw pvs.error;
      if (items.error) throw items.error;
      if (reservations.error) throw reservations.error;

      const pvById = new Map(((pvs.data ?? []) as Array<{ id: string; order_number: string }>).map((p) => [p.id, p.order_number]));
      const itemById = new Map(((items.data ?? []) as unknown as Array<{ id: string; color: string | null; technical_sheets: { code: string | null; name: string | null } | null }>)
        .map((i) => [i.id, i]));

      const jobsOut: MotorAtelierJob[] = rows.map((r) => {
        const item = r.sale_order_item_id ? itemById.get(r.sale_order_item_id) : undefined;
        return {
          ...r,
          pv: r.sale_order_id ? pvById.get(r.sale_order_id) ?? null : null,
          color: item?.color ?? null,
          reference: item?.technical_sheets?.code || item?.technical_sheets?.name || null,
        };
      });
      const resOut: MotorAtelierReservation[] = ((reservations.data ?? []) as unknown as Array<{
        id: string; quantity_reserved: number | null; quantity_short: number | null;
        products: { name: string; color: string | null; unit: string | null } | null;
        sale_orders: { order_number: string } | null;
      }>).map((r) => ({
        id: r.id,
        pv: r.sale_orders?.order_number ?? null,
        material: [r.products?.name, r.products?.color].filter(Boolean).join(' ') || '—',
        reserved: Number(r.quantity_reserved) || 0,
        short: Number(r.quantity_short) || 0,
        unit: r.products?.unit ?? null,
      }));
      return { jobs: jobsOut, reservations: resOut };
    },
    staleTime: 30_000,
  });
}
