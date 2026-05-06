import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MaterialNeedItem {
  material_name: string;
  current_stock: number;
  total_needed: number;
  missing_qty: number;
  unit: string;
}

export interface MaterialNeedGroup {
  group_name: string;
  items: MaterialNeedItem[];
}

export function useMaterialNeedsReport() {
  return useQuery({
    queryKey: ['material-needs-report'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('report_material_needs_by_group')
        .select('*');

      if (error) throw error;

      // Group data by group_name
      const grouped = data.reduce((acc: Record<string, MaterialNeedItem[]>, item: any) => {
        if (!acc[item.group_name]) {
          acc[item.group_name] = [];
        }
        acc[item.group_name].push({
          material_name: item.material_name,
          current_stock: item.current_stock,
          total_needed: item.total_needed,
          missing_qty: item.missing_qty,
          unit: item.unit,
        });
        return acc;
      }, {});

      return Object.entries(grouped).map(([group_name, items]) => ({
        group_name,
        items,
      })) as MaterialNeedGroup[];
    },
  });
}
