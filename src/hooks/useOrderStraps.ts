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

const normalizeText = (value: unknown) =>
  String(value ?? '').trim().toUpperCase().normalize('NFC');

const normalizeGrade = (grade: unknown) => {
  if (!grade || typeof grade !== 'object') return '';
  return Object.entries(grade as Record<string, number>)
    .map(([size, qty]) => [size, Number(qty) || 0] as const)
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([size, qty]) => `${size}:${qty}`)
    .join('|');
};

const toStraps = (item?: SaleOrderItemWithStraps | null): StrapInfo[] => {
  if (!item?.strap_colors || !Array.isArray(item.strap_colors)) return [];
  return item.strap_colors.filter((s: any) => s.label && s.color);
};

/**
 * Fetches sale_order_items with strap_colors for all orders that have a sale_order_id.
 * Returns a lookup function that first uses the exact sale_order_item_id from the OP,
 * then falls back to the best match by pedido + referência + cor + quantidade + grade.
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

    if (order.sale_order_item_id) {
      const itemById = items.find((item) => item.id === order.sale_order_item_id);
      const exactStraps = toStraps(itemById);
      if (exactStraps.length > 0) return exactStraps;
    }

    const orderColor = normalizeText(order.color);
    const orderQty = Number(order.quantity) || 0;
    const orderGrade = normalizeGrade(order.grade);

    const candidates = items.filter(
      (item) =>
        item.sale_order_id === order.sale_order_id &&
        item.reference_id === order.reference_id &&
        normalizeText(item.color) === orderColor,
    );

    if (candidates.length === 0) return [];

    const bestMatch = [...candidates].sort((a, b) => {
      const aQtyScore = Number(a.quantity || 0) === orderQty ? 0 : 1;
      const bQtyScore = Number(b.quantity || 0) === orderQty ? 0 : 1;
      if (aQtyScore !== bQtyScore) return aQtyScore - bQtyScore;

      const aGradeScore = normalizeGrade(a.grade) === orderGrade ? 0 : 1;
      const bGradeScore = normalizeGrade(b.grade) === orderGrade ? 0 : 1;
      if (aGradeScore !== bGradeScore) return aGradeScore - bGradeScore;

      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })[0];

    return toStraps(bestMatch);
  };

  /** Returns formatted string like "Tira 1: Branca - Tira 2: Preta" */
  const getStrapsLabel = (order: any): string => {
    const straps = getStrapsForOrder(order);
    if (straps.length === 0) return '';
    return straps.map(s => `${s.label}: ${s.color}`).join(' - ');
  };

  return { getStrapsForOrder, getStrapsLabel };
}
