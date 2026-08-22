import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface InventorySummary {
  totalValue: number;
  activeItems: number;
  lowStockCount: number;
}

export function useInventoryStats() {
  return useQuery({
    queryKey: ['inventory-stats'],
    queryFn: async () => {
      // Chama a função SQL que processa os dados no servidor (RPC)
      // É muito mais rápido que baixar todos os produtos e somar no JS
      const { data, error } = await supabase.rpc('get_inventory_summary');
      
      if (error) throw error;
      if (!data) throw new Error('Resumo de estoque vazio — tente de novo.');
      
      return data as unknown as InventorySummary;
    },
    staleTime: 1000 * 60 * 5, // Cache de 5 minutos
  });
}
