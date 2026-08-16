import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type Supplier = {
  id: string;
  name: string;
  trade_name: string;
  cnpj: string;
  ie: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  payment_terms: string;
  lead_time_days: number;
  notes: string;
  active: boolean;
  is_own_manufacturing: boolean;
  // Métricas de performance — calculadas automaticamente quando OCs são recebidas
  // (trigger tg_refresh_supplier_lead_time_stats em purchase_orders, mig 2026-05-29)
  avg_lead_time_days?: number | null;
  on_time_rate?: number | null;
  last_purchase_date?: string | null;
  // Cadastrais adicionais (existiam no DB, agora expostos no form)
  min_order_quantity?: number;
  supplier_category?: 'materia_prima' | 'servico' | 'embalagem' | 'outro' | null;
  homologation_status?: 'ativo' | 'em_homologacao' | 'bloqueado' | null;
  certifications?: string | null;
  quality_rating?: number | null;
  delivery_rating?: number | null;
  price_rating?: number | null;
  service_rating?: number | null;
  created_at: string;
  updated_at: string;
};

export type Invoice = {
  id: string;
  supplier_id: string | null;
  invoice_number: string;
  invoice_series: string;
  invoice_key: string;
  issue_date: string | null;
  total_value: number;
  freight_value: number;
  discount_value: number;
  notes: string;
  xml_data: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type InvoiceItem = {
  id: string;
  invoice_id: string;
  product_code: string;
  product_name: string;
  ncm: string;
  cfop: string;
  unit: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  discount: number;
  product_id: string | null;
  added_to_stock: boolean;
  created_at: string;
};

// ─── Suppliers ───
export function useSuppliers(enabled = true) {
  return useQuery({
    queryKey: ['suppliers'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('*').order('name');
      if (error) throw error;
      return data as Supplier[];
    },
  });
}

export function useAddSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: Partial<Supplier> & { name: string }) => {
      const { data, error } = await supabase.from('suppliers').insert(form).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); toast.success('Fornecedor cadastrado!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Supplier> }) => {
      const { error } = await supabase.from('suppliers').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); toast.success('Fornecedor atualizado!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const [poRes, lotRes, prodRes] = await Promise.all([
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('supplier_id', id),
        supabase.from('lot_tracking').select('id', { count: 'exact', head: true }).eq('supplier_id', id),
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('supplier_id', id),
      ]);
      if (poRes.error) throw new Error(`Falha ao verificar OCs: ${poRes.error.message}`);
      if (lotRes.error) throw new Error(`Falha ao verificar lotes: ${lotRes.error.message}`);
      if (prodRes.error) throw new Error(`Falha ao verificar produtos: ${prodRes.error.message}`);
      const blockers: string[] = [];
      if ((poRes.count ?? 0) > 0) blockers.push(`${poRes.count} ${poRes.count === 1 ? 'ordem de compra' : 'ordens de compra'}`);
      if ((lotRes.count ?? 0) > 0) blockers.push(`${lotRes.count} ${lotRes.count === 1 ? 'registro de lote' : 'registros de lote'}`);
      if ((prodRes.count ?? 0) > 0) blockers.push(`${prodRes.count} ${prodRes.count === 1 ? 'produto' : 'produtos'}`);
      if (blockers.length > 0) throw new Error(`Não é possível excluir: fornecedor possui ${blockers.join(' e ')} vinculados. Inative o cadastro em vez de excluir.`);
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); toast.success('Fornecedor removido!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ─── Invoices ───
export function useInvoices(supplierId?: string) {
  return useQuery({
    queryKey: ['invoices', supplierId],
    queryFn: async () => {
      let q = supabase.from('invoices').select('*').order('created_at', { ascending: false });
      if (supplierId) q = q.eq('supplier_id', supplierId);
      const { data, error } = await q;
      if (error) throw error;
      return data as Invoice[];
    },
  });
}

export function useAddInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: Partial<Invoice>) => {
      const { data, error } = await supabase.from('invoices').insert(form).select().single();
      if (error) throw error;
      return data as Invoice;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); toast.success('Nota fiscal importada!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('invoices').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); toast.success('Nota removida!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ─── Invoice Items ───
export function useInvoiceItems(invoiceId?: string) {
  return useQuery({
    queryKey: ['invoice_items', invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId!).order('product_name');
      if (error) throw error;
      return data as InvoiceItem[];
    },
  });
}

export function useAddInvoiceItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: (Partial<InvoiceItem> & { invoice_id: string })[]) => {
      const { data, error } = await supabase.from('invoice_items').insert(items).select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoice_items'] }); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateInvoiceItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InvoiceItem> }) => {
      const { error } = await supabase.from('invoice_items').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoice_items'] }); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ─── Price history ───
export type PriceHistoryEntry = {
  product_id: string;
  product_name: string;
  product_code: string;
  unit_price: number;
  quantity: number;
  unit: string;
  supplier_id: string | null;
  supplier_name: string | null;
  invoice_number: string;
  issue_date: string;
  invoice_id: string;
};

export type ProductPriceSummary = {
  product_id: string;
  product_name: string;
  supplier_id: string | null;
  supplier_name: string | null;
  purchase_count: number;
  min_price: number;
  max_price: number;
  avg_price: number;
  latest_price: number;
  previous_price: number | null;
  last_purchased: string | null;
};

export function useSupplierPriceHistory(supplierId: string) {
  return useQuery({
    queryKey: ['supplier_price_history', supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_supplier_price_history' as any)
        .select('*')
        .eq('supplier_id', supplierId)
        .order('issue_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as unknown as PriceHistoryEntry[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useProductPriceSummary(supplierId?: string) {
  return useQuery({
    queryKey: ['product_price_summary', supplierId],
    queryFn: async () => {
      let q = supabase.from('v_product_price_summary' as any).select('*');
      if (supplierId) q = q.eq('supplier_id', supplierId);
      const { data, error } = await q.order('last_purchased', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ProductPriceSummary[];
    },
    staleTime: 5 * 60_000,
  });
}
