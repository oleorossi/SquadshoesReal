import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

type StrapInfo = { id: string; label: string; color: string };
type SaleOrderItemWithStraps = {
  id: string;
  sale_order_id: string;
  reference_id: string;
  color: string | null;
  quantity: number | null;
  grade: Record<string, number> | null;
  strap_colors: any[] | null;
  created_at: string;
};

const toStraps = (item?: SaleOrderItemWithStraps | null): StrapInfo[] => {
  if (!item?.strap_colors || !Array.isArray(item.strap_colors)) return [];
  return item.strap_colors.filter((s: any) => s.label && s.color);
};

/**
 * Fetches sale_order_items with strap_colors. Lookup is by exact
 * sale_order_item_id — never by sibling color/qty/grade on the same PV.
 */
export function useOrderStraps() {
  const { data: items = [] } = useQuery({
    queryKey: ['sale_order_items_straps'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_order_items')
        .select('id, sale_order_id, reference_id, color, quantity, grade, strap_colors, created_at')
        .not('strap_colors', 'is', null);
      if (error) throw error;
      return (data || []) as SaleOrderItemWithStraps[];
    },
    staleTime: 2 * 60 * 1000,
  });

  const getStrapsForOrder = (order: any): StrapInfo[] => {
    if (!order.sale_order_id) return [];

    // Só o item exato. Fallback por cor+qty+grade pegava tira da irmã
    // (mesma PV, outra cor) e o aviamento cortava a napa errada.
    if (!order.sale_order_item_id) return [];
    return toStraps(items.find((item) => item.id === order.sale_order_item_id));
  };

  /** Returns formatted string like "Tira 1: Branca - Tira 2: Preta" */
  const getStrapsLabel = (order: any): string => {
    const straps = getStrapsForOrder(order);
    if (straps.length === 0) return '';
    return straps.map(s => `${s.label}: ${s.color}`).join(' - ');
  };

  return { getStrapsForOrder, getStrapsLabel };
}
