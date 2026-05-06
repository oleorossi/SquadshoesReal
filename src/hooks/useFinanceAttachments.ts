import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type FinanceAttachment = {
  id: string;
  account_type: 'payable' | 'receivable';
  account_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
};

export function useFinanceAttachments(accountType: 'payable' | 'receivable', accountId: string | null) {
  return useQuery({
    queryKey: ['finance_attachments', accountType, accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('finance_attachments')
        .select('*')
        .eq('account_type', accountType)
        .eq('account_id', accountId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as FinanceAttachment[];
    },
  });
}

export function useUploadFinanceAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountType, accountId, file }: { accountType: 'payable' | 'receivable'; accountId: string; file: File }) => {
      const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain', 'text/csv'];
      if (!ALLOWED_TYPES.includes(file.type)) throw new Error('Tipo de arquivo não permitido. Use PDF, imagem, Word, Excel ou texto.');
      if (file.size > 10 * 1024 * 1024) throw new Error('Arquivo deve ter no máximo 10MB.');
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const path = `${accountType}/${accountId}/${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from('finance-attachments')
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: { user } } = await supabase.auth.getUser();

      const { error: dbError } = await supabase.from('finance_attachments').insert({
        account_type: accountType,
        account_id: accountId,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: user?.id || null,
      } as any);
      if (dbError) {
        // Remove the already-uploaded file to avoid orphaned storage objects
        await supabase.storage.from('finance-attachments').remove([path]);
        throw dbError;
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['finance_attachments', vars.accountType, vars.accountId] });
      toast.success('Comprovante anexado!');
    },
    onError: (e: Error) => toast.error(`Erro ao anexar: ${e.message}`),
  });
}

export function useDeleteFinanceAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (attachment: FinanceAttachment) => {
      // DB row first — re-fetch file_path from the deleted row to prevent IDOR:
      // don't trust the client-supplied attachment.file_path since a malicious
      // caller could pass a different path to delete arbitrary blobs in storage.
      const { data: deleted, error } = await supabase
        .from('finance_attachments')
        .delete()
        .eq('id', attachment.id)
        .select('file_path');
      if (error) throw error;
      if (!deleted || deleted.length === 0) throw new Error('Anexo não encontrado ou sem permissão.');
      const authoritativePath = (deleted[0] as any).file_path as string;
      const { error: storageErr } = await supabase.storage
        .from('finance-attachments')
        .remove([authoritativePath]);
      if (storageErr) console.warn('Storage cleanup failed (orphan blob):', storageErr.message);
    },
    onSuccess: (_, att) => {
      qc.invalidateQueries({ queryKey: ['finance_attachments', att.account_type, att.account_id] });
      toast.success('Anexo removido!');
    },
    onError: (e: Error) => toast.error(`Erro: ${e.message}`),
  });
}
