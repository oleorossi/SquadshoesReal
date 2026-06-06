import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type LowStockAlert = {
  product_id: string;
  product_name: string;
  sku: string | null;
  category: string | null;
  unit: string | null;
  group_name: string | null;
  quantity: number;
  min_stock: number;
  deficit: number;
  type: 'product';
};

export type LowStockBySize = {
  product_id: string;
  product_name: string;
  sku: string | null;
  group_name: string | null;
  size: string;
  quantity: number;
  min_stock: number;
  deficit: number;
  type: 'sole_size';
};

export type LowStockData = {
  products: LowStockAlert[];
  soleSizes: LowStockBySize[];
};

/**
 * Lista todos os produtos cujo estoque está abaixo do `min_stock` configurado
 * e, para solados (que possuem `stock_grade`/`min_stock_grade`), apresenta
 * também os déficits por numeração.
 */
export function useLowStockAlerts() {
  return useQuery<LowStockData>({
    queryKey: ['low-stock-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, category, unit, group_id, quantity, min_stock, stock_grade, min_stock_grade, product_groups!products_group_id_fkey(name)')
        .or('min_stock.gt.0,min_stock_grade.not.is.null')
        .limit(5000);
      if (error) throw error;

      const products: LowStockAlert[] = [];
      const soleSizes: LowStockBySize[] = [];

      for (const p of (data ?? []) as any[]) {
        const groupName = p?.product_groups?.name ?? null;
        const qty = Number(p.quantity ?? 0);
        const min = Number(p.min_stock ?? 0);
        if (min > 0 && qty < min) {
          products.push({
            product_id: p.id,
            product_name: p.name,
            sku: p.sku ?? null,
            category: p.category ?? null,
            unit: p.unit ?? null,
            group_name: groupName,
            quantity: qty,
            min_stock: min,
            deficit: min - qty,
            type: 'product',
          });
        }

        const stockGrade = (p.stock_grade ?? {}) as Record<string, number>;
        const minGrade = (p.min_stock_grade ?? {}) as Record<string, number>;
        if (minGrade && typeof minGrade === 'object') {
          for (const [size, mv] of Object.entries(minGrade)) {
            const minSize = Number(mv) || 0;
            if (minSize <= 0) continue;
            const cur = Number(stockGrade?.[size] ?? 0);
            if (cur < minSize) {
              soleSizes.push({
                product_id: p.id,
                product_name: p.name,
                sku: p.sku ?? null,
                group_name: groupName,
                size,
                quantity: cur,
                min_stock: minSize,
                deficit: minSize - cur,
                type: 'sole_size',
              });
            }
          }
        }
      }

      products.sort((a, b) => b.deficit - a.deficit);
      soleSizes.sort(
        (a, b) => b.deficit - a.deficit || a.product_name.localeCompare(b.product_name),
      );

      return { products, soleSizes };
    },
    staleTime: 60_000,
  });
}