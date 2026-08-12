 import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
 import { logAuditEvent } from '@/services/auditService';

export function useQualityInspections(lotId?: string) {
  return useQuery({
    queryKey: ['quality_inspections', lotId],
    queryFn: async () => {
       const query = supabase
         .from('quality_inspections' as any)
         .select('*, orders(order_number), quality_checklists(name)')
         .order('created_at', { ascending: false });
      
      // Since lot_tracking isn't directly linked in the table schema we saw, 
      // but lot_tracking has IDs. Usually, inspections might be linked to orders or lots.
      // For now, let's fetch all and limit.
      const { data, error } = await query.limit(500);
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateQualityInspection() {
  const qc = useQueryClient();
  return useMutation({
     mutationFn: async (inspection: any) => {
       const { data, error } = await supabase.from('quality_inspections').insert(inspection).select().single();
      if (error) throw error;
 
       await logAuditEvent({
         action: 'create',
         resource: 'quality_inspections',
         resourceId: data?.id || null,
         newData: inspection,
         userId: null,
         ipAddress: null,
         userAgent: navigator.userAgent,
         success: true
       });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality_inspections'] });
      toast.success('Inspeção de qualidade registrada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useQualityChecklists() {
  return useQuery({
    queryKey: ['quality_checklists'],
    queryFn: async () => {
       const { data, error } = await (supabase
         .from('quality_checklists' as any)
         .select('*'));
      if (error) throw error;
      return data;
    },
  });
}
