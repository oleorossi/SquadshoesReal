import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type ReadyStockInquiry = {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  notes: string | null;
  items: unknown;
  total_pairs: number;
  created_at: string;
};

export function useReadyStockPublicLink() {
  return useQuery({
    queryKey: ['ready_stock_public_link'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ensure_ready_stock_public_link' as never);
      if (error) throw error;
      return data as { token: string; active: boolean };
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useRotateReadyStockPublicLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('rotate_ready_stock_public_link' as never);
      if (error) throw error;
      return data as { token: string; active: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock_public_link'] });
      toast.success('Link da vitrine renovado.');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useReadyStockInquiries() {
  return useQuery({
    queryKey: ['ready_stock_inquiries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ready_stock_inquiries' as never)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ReadyStockInquiry[];
    },
    staleTime: 15_000,
  });
}

export function useUpdateReadyStockInquiryStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('ready_stock_inquiries' as never)
        .update({ status, updated_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ready_stock_inquiries'] }),
    onError: (err: Error) => toast.error(err.message),
  });
}

export async function fetchPublicReadyStock(token: string) {
  const { data, error } = await supabase.rpc('get_public_ready_stock' as never, { p_token: token } as never);
  if (error) throw error;
  return data as { ok: boolean; error?: string; items?: any[] };
}

export async function submitPublicReadyStockInquiry(input: {
  token: string;
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  notes?: string;
  items: Array<Record<string, unknown>>;
}) {
  const { data, error } = await supabase.rpc('submit_public_ready_stock_inquiry' as never, {
    p_token: input.token,
    p_customer_name: input.customer_name,
    p_customer_phone: input.customer_phone ?? null,
    p_customer_email: input.customer_email ?? null,
    p_notes: input.notes ?? null,
    p_items: input.items,
  } as never);
  if (error) throw error;
  return data as { ok: boolean; error?: string; id?: string; total_pairs?: number };
}
