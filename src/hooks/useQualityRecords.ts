 import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
 import { logAuditEvent } from '@/services/auditService';

export type QualityRecordInsert = {
  order_id: string;
  stage_id?: string;
  stage_name: string;
  record_type: string;
  quantity: number;
  description?: string;
  cause?: string;
  corrective_action?: string;
  severity?: 'minor' | 'major' | 'critical';
  registered_by?: string;
  can_rework?: boolean;
  cost?: number;
};

export function useQualityRecords(orderId?: string) {
  return useQuery({
    queryKey: ['quality_records', orderId],
    queryFn: async () => {
      let query = supabase
        .from('quality_records')
        .select('*')
        .order('created_at', { ascending: false });
      if (orderId) query = query.eq('order_id', orderId);
      else query = query.limit(500);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: orderId !== undefined ? !!orderId : true,
  });
}

export function useAllQualityRecords() {
  return useQuery({
    queryKey: ['quality_records'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quality_records')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateQualityRecord() {
  const qc = useQueryClient();
  return useMutation({
     mutationFn: async (record: QualityRecordInsert) => {
       if (!Number.isFinite(record.quantity) || record.quantity < 0) throw new Error('Quantidade deve ser um número não-negativo.');
       if (record.cost !== undefined && (!Number.isFinite(record.cost) || record.cost < 0)) throw new Error('Custo deve ser um número não-negativo.');
       const { data, error } = await supabase.from('quality_records').insert(record as any).select().single();
      if (error) throw error;
 
       await logAuditEvent({
         action: 'create',
         resource: 'quality_records',
         resourceId: data?.id || null,
         newData: record,
         userId: null,
         ipAddress: null,
         userAgent: navigator.userAgent,
         success: true
       });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality_records'] });
      toast.success('Registro de qualidade salvo!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useResolveQualityRecord() {
  const qc = useQueryClient();
  return useMutation({
     mutationFn: async ({ id, resolvedBy }: { id: string; resolvedBy?: string }) => {
       // Atomic claim: only update when resolved=false. If another operator
       // already resolved it, the filter matches 0 rows and PGRST116 is raised.
       const { data, error } = await supabase
         .from('quality_records')
         .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: resolvedBy || '' } as any)
         .eq('id', id)
         .eq('resolved', false)
         .select()
         .single();
      if (error) {
        if ((error as any).code === 'PGRST116') {
          throw new Error('Este registro já foi resolvido por outro usuário.');
        }
        throw error;
      }
 
       await logAuditEvent({
         action: 'resolve',
         resource: 'quality_records',
         resourceId: id,
         newData: data,
         userId: null,
         ipAddress: null,
         userAgent: navigator.userAgent,
         success: true
       });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality_records'] });
      toast.success('Registro resolvido!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
