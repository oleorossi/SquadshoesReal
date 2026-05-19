import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CompanySettings {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string | null;
  cpf: string | null;
  cei: string | null;
  caepf: string | null;
  cno: string | null;
  endereco: string | null;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** Singleton — empresa default. Retorna null durante loading. */
export function useCompanySettings() {
  return useQuery<CompanySettings | null>({
    queryKey: ['company_settings'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('company_settings')
        .select('*')
        .eq('is_default', true)
        .maybeSingle();
      if (error) throw error;
      return data as CompanySettings | null;
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpdateCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: Partial<CompanySettings> & { id: string }) => {
      const { id, ...patch } = form;
      const { error } = await (supabase as any)
        .from('company_settings')
        .update(patch)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company_settings'] });
      toast.success('Dados da empresa atualizados');
    },
    onError: (err: any) => toast.error(`Falha ao salvar: ${err.message}`),
  });
}

/** Valida CPF/CNPJ por máscara — algoritmo de dígito verificador fica pro futuro. */
export function isValidCNPJ(cnpj: string | null | undefined): boolean {
  if (!cnpj) return false;
  return /^\d{14}$/.test(cnpj.replace(/\D/g, ''));
}
export function isValidCPF(cpf: string | null | undefined): boolean {
  if (!cpf) return false;
  return /^\d{11}$/.test(cpf.replace(/\D/g, ''));
}
