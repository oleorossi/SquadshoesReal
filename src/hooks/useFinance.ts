import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { sanitizeUuidFields } from '@/lib/utils';
import { invalidateFinanceDerivedQueries } from '@/lib/financeQueryInvalidation';

export type AccountPayable = {
  id: string;
  description: string;
  supplier_id: string | null;
  invoice_id: string | null;
  purchase_order_id?: string | null;
  category: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  status: string;
  payment_date: string | null;
  payment_method: string | null;
  bank_name: string | null;
  barcode: string | null;
  boleto_number: string | null;
  installment_number: number;
  total_installments: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  suppliers?: { name: string; cnpj?: string | null } | null;
};
