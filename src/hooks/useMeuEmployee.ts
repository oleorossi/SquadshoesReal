import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface MeuEmployee {
  id: string;
  name: string;
  payment_type: string;
  valor_par_medio: number | null;
  valor_par_dificil: number | null;
  department: string | null;
  active: boolean;
  user_id: string | null;
}

/** Funcionário vinculado ao login atual (employees.user_id = auth.uid()). */
export function useMeuEmployee() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['meu-employee', user?.id],
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async (): Promise<MeuEmployee | null> => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, payment_type, valor_par_medio, valor_par_dificil, department, active, user_id')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as MeuEmployee | null) ?? null;
    },
  });
}
