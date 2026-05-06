import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useBomVersions(sheetId: string | null) {
  return useQuery({
    queryKey: ['bom_versions', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bom_versions')
        .select('*')
        .eq('sheet_id', sheetId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateBomVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sheetId, versionNumber, description, snapshot, materialsSnapshot, operationsSnapshot, createdBy
    }: {
      sheetId: string; versionNumber: string; description: string;
      snapshot: any; materialsSnapshot: any; operationsSnapshot: any; createdBy: string;
    }) => {
      const { data, error } = await supabase
        .from('bom_versions')
        .insert({
          sheet_id: sheetId,
          version_number: versionNumber,
          description,
          snapshot,
          materials_snapshot: materialsSnapshot,
          operations_snapshot: operationsSnapshot,
          status: 'draft',
          created_by: createdBy,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bom_versions'] });
      toast.success('Versão criada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateBomVersionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, approvedBy }: { id: string; status: string; approvedBy?: string }) => {
      const updateData: any = { status };
      if (status === 'approved' && approvedBy) {
        updateData.approved_by = approvedBy;
        updateData.approved_at = new Date().toISOString();
      }
      // Predecessor-status guard: prevent out-of-order or concurrent transitions.
      const predecessorMap: Record<string, string> = {
        pending_approval: 'draft',
        approved: 'pending_approval',
        rejected: 'pending_approval',
      };
      let q = supabase.from('bom_versions').update(updateData).eq('id', id);
      if (predecessorMap[status]) q = (q as any).eq('status', predecessorMap[status]);
      const { data: rows, error } = await (q as any).select('id');
      if (error) throw error;
      if (!rows || rows.length === 0) throw new Error('Versão já foi processada ou status incompatível. Recarregue e tente novamente.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bom_versions'] });
      toast.success('Status da versão atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
