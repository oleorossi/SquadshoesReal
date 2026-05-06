 import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
 import { supabase } from '@/integrations/supabase/client';
 import { toast } from 'sonner';
 
 export interface CostParameter {
   key: string;
   value: number;
   description: string;
   updated_at: string;
 }
 
 export function useCostParameters() {
   return useQuery({
     queryKey: ['cost_parameters'],
     queryFn: async () => {
       const { data, error } = await supabase
         .from('cost_parameters')
         .select('*');
       
       if (error) throw error;
       return data as CostParameter[];
     },
   });
 }
 
 export function useUpdateCostParameter() {
   const queryClient = useQueryClient();
   return useMutation({
     mutationFn: async ({ key, value }: { key: string; value: number }) => {
       const { error } = await supabase
         .from('cost_parameters')
         .update({ value, updated_at: new Date().toISOString() })
         .eq('key', key);
       
       if (error) throw error;
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['cost_parameters'] });
       toast.success('Parâmetro atualizado com sucesso!');
     },
     onError: (error: any) => {
       toast.error('Erro ao atualizar parâmetro: ' + error.message);
     },
   });
 }
 
 export function useSystemUnities() {
   return useQuery({
     queryKey: ['system_unities'],
     queryFn: async () => {
       // Placeholder para unidades do sistema se existirem em outra tabela futuramente
       // Por enquanto focamos no overhead solicitado explicitamente
       return [];
     }
   });
 }