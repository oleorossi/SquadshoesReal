import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { searchMatchesAny } from '@/lib/searchUtils';

export interface PaginatedProductsParams {
  search?: string;
  groupId?: string;
  supplierId?: string;
  status?: string;
  category?: string;
  /** Categoria a EXCLUIR. Usado em /estoque (Materiais) pra omitir Solado —
   *  gestão de solado vive em /solados (SolesHub). Comparação case-insensitive. */
  excludeCategory?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}

export function usePaginatedProducts(params: PaginatedProductsParams = {}) {
  const { search = '', groupId = 'all', supplierId = 'all', status = 'all', category = 'all', excludeCategory, page = 1, limit = 12 } = params;

  return useQuery({
    queryKey: ['products', 'paginated', search, groupId, supplierId, status, category, excludeCategory || '', page, limit],
    queryFn: async () => {
      // Fetch products and in-production quantities in parallel
      const [productsResult, inProdResult] = await Promise.all([
        // consumption_unit incluído (2026-05-31) pelo mesmo motivo de useProducts:
        // callers podem ler product.product_groups?.consumption_unit (UoM canônica
        // de BOM) pra preencher consumo no estoque/ficha.
        supabase.from('products').select('*, product_groups!products_group_id_fkey(name, consumption_unit)'),
        supabase.rpc('get_in_production_stock' as any),
      ]);

      if (productsResult.error) throw productsResult.error;

      // Build productId → in_production_quantity lookup
      const inProdMap: Record<string, number> = {};
      if (!inProdResult.error && inProdResult.data) {
        for (const row of inProdResult.data as Array<{ product_id: string; in_production_quantity: number }>) {
          inProdMap[row.product_id] = Number(row.in_production_quantity) || 0;
        }
      }

      const data = productsResult.data;

       let filtered = (data || []).map(p => ({
          ...p,
          quantity: Number(p.quantity) || 0,
          min_stock: Number(p.min_stock) || 1, // Default min_stock to 1 if not set
          max_stock: Number(p.max_stock) || Infinity,
           group_name: (p.product_groups as any)?.name || '',
          in_production_quantity: inProdMap[p.id] || 0,
         }));

      // 1. Text Search — normalizeForSearch ignora acento/caixa/espaço
      // (ex.: "tamara" casa "TÂMARA", "sp10" casa "SP 10").
      if (search) {
        filtered = filtered.filter(p =>
          searchMatchesAny(search, p.name, p.sku, p.color, p.technical_name, p.group_name)
        );
      }

      // 2. Group

      // 3. Group
      if (groupId && groupId !== 'all') {
        if (groupId === 'none') {
          filtered = filtered.filter(p => !p.group_id);
        } else {
          filtered = filtered.filter(p => p.group_id === groupId);
        }
      }

      // 3b. Category (fallback quando o defaultGroupName do chip não casa com nenhum
      // grupo do DB — ex.: chips "Cabedal", "Forro", "Químicos" não têm grupo com
      // mesmo nome, mas existem produtos com products.category = "Cabedal" etc.)
      if (category && category !== 'all') {
        const cat = category.toLowerCase();
        filtered = filtered.filter((p: any) => (p.category || '').toLowerCase() === cat);
      }

      // 3c. ExcludeCategory (PR 2026-05-23): /estoque deve omitir Solado.
      // Filter de MaterialsTab.tsx:158 era inútil (agia em `products`, não
      // em `paginatedProducts` que vai pra UI). Agora filtra na fonte.
      if (excludeCategory) {
        const exc = excludeCategory.toLowerCase();
        filtered = filtered.filter((p: any) => (p.category || '').toLowerCase() !== exc);
      }

      // 4. Supplier
      if (supplierId && supplierId !== 'all') {
        if (supplierId === 'none') {
          filtered = filtered.filter(p => !p.supplier_id);
        } else {
          filtered = filtered.filter(p => p.supplier_id === supplierId);
        }
      }

      // 5. Status Filter (The missing piece)
      if (status && status !== 'all') {
        filtered = filtered.filter(p => {
          const ratio = p.quantity / p.min_stock;
          if (status === 'critical') return ratio <= 0.5;
          if (status === 'low') return ratio <= 1.0;
          if (status === 'overstock' && p.max_stock !== Infinity) return p.quantity > p.max_stock;
          return true;
        });
      }

      // Sort by updated_at desc
      filtered.sort((a, b) => {
        const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return dateB - dateA;
      });

      const total = filtered.length;
      const totalPages = Math.ceil(total / limit);
      
      // Slice for pagination
      const from = (page - 1) * limit;
      const to = from + limit;
      const pagedItems = filtered.slice(from, to);

      return {
        items: pagedItems,
        total,
        page,
        totalPages: totalPages || 1,
      } as PaginatedResult<typeof data[0]>;
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
