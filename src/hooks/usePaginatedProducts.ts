import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { searchNormOrFilter } from '@/lib/searchUtils';
import { fetchPage, PAGE_SIZE, type PageResult } from '@/lib/pagination';

/**
 * Listagem de produtos — busca, filtro e paginação NO BANCO (2026-08-03).
 *
 * ## O que mudou
 *
 * Este hook se chamava "paginated" mas baixava a tabela inteira e fatiava em
 * JS. Isso trazia dois defeitos:
 *
 * 1. **Teto silencioso de 1.000 linhas.** `select *` sem `.range()` é cortado
 *    pelo PostgREST sem erro e sem aviso. Com 199 produtos ainda cabia, mas o
 *    filtro rodava sobre "o que coube", não sobre a tabela.
 * 2. **Todo filtro era client-side** — inclusive os que dependem de campo
 *    derivado (nome do grupo, status de estoque).
 *
 * Agora lê `v_products_list` (migration `20261112120000`), que expõe os campos
 * derivados pro banco poder filtrar: `group_name`, `search_all`, `is_critical`,
 * `is_low`, `is_overstock`, `is_zerada`, `is_falta`, `category_norm`.
 *
 * ⚠ Buscar por nome de GRUPO só funciona por causa da view: `products.search_norm`
 * é coluna gerada e não alcança tabela vizinha. Medido no banco — o termo
 * "COMPONENTES DIVERSOS" acha 8 produtos pela view e 0 pela coluna gerada.
 */

export interface PaginatedProductsParams {
  search?: string;
  groupId?: string;
  supplierId?: string;
  status?: string;
  category?: string;
  /** Categoria a EXCLUIR. Usado em /estoque (Materiais) pra omitir Solado —
   *  gestão de solado vive em /solados (SolesHub). Comparação case-insensitive. */
  excludeCategory?: string;
  /** Chip "esconder zeradas": remove saldo <= 0. */
  hideZeradas?: boolean;
  /** Chip "só com falta": mantém só reserva acima do saldo. Vence `hideZeradas`. */
  onlyFalta?: boolean;
  /** Critério de ordenação. Precisa ser server-side: ordenar na tela ordenaria
   *  só as 50 linhas da página. Ver SORT_COLUMNS. */
  sortKey?: string | null;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/**
 * `v_products_list` não existe em `integrations/supabase/types.ts` (arquivo
 * GERADO — não se edita à mão, e regenerar traria 1,1 MB de diff não
 * relacionado). Mesmo caminho já usado neste projeto pra RPC fora dos tipos,
 * ex.: `supabase.rpc('get_in_production_stock' as any)`.
 */
const productsList = () => supabase.from('v_products_list' as any);

/**
 * Chave de ordenação da UI → coluna de `v_products_list`.
 *
 * `total_value`, `est_pairs` e `status` eram calculados em JS; viraram coluna na
 * view justamente pra poderem ordenar o conjunto INTEIRO. Sem isso, "materiais
 * de maior valor" listava o maior *da página atual*.
 */
const SORT_COLUMNS: Record<string, string> = {
  sku: 'sku',
  name: 'name',
  category: 'category',
  quantity: 'quantity',
  unit_price: 'unit_price',
  total_value: 'total_value',
  est_pairs: 'est_pairs',
  status: 'status_rank',
};

export type PaginatedProductsResult = PageResult<any> & {
  /** Contagens dos chips, sobre o conjunto filtrado INTEIRO — não sobre a página. */
  zeradasCount: number;
  faltaCount: number;
};

/** Aplica os filtros comuns a query de listagem e a query de contagem. */
function applyFilters(
  query: any,
  { search, groupId, supplierId, status, category, excludeCategory }: PaginatedProductsParams,
) {
  let q = query;

  if (groupId && groupId !== 'all') {
    q = groupId === 'none' ? q.is('group_id', null) : q.eq('group_id', groupId);
  }

  if (supplierId && supplierId !== 'all') {
    q = supplierId === 'none' ? q.is('supplier_id', null) : q.eq('supplier_id', supplierId);
  }

  // `category_norm` é COALESCE(...,'') na view — nunca nula. Por isso `.neq`
  // mantém produto sem categoria na lista, igual ao `(p.category || '')` do TS.
  if (category && category !== 'all') q = q.eq('category_norm', category.toLowerCase());
  if (excludeCategory) q = q.neq('category_norm', excludeCategory.toLowerCase());

  // 'critical' é subconjunto de 'low' — mesma semântica do filtro antigo.
  if (status === 'critical') q = q.eq('is_critical', true);
  else if (status === 'low') q = q.eq('is_low', true);
  else if (status === 'overstock') q = q.eq('is_overstock', true);

  // searchNormOrFilter devolve '' quando a busca normaliza pra vazio; passar
  // string vazia pro .or() vira `or=()` = 400 no PostgREST.
  const orFilter = searchNormOrFilter(search, 'search_all');
  if (orFilter) q = q.or(orFilter);

  return q;
}

/** Filtros dos chips — separados porque as contagens são feitas SEM eles. */
function applyChipFilters(query: any, { hideZeradas, onlyFalta }: PaginatedProductsParams) {
  // "Só com falta" TEM QUE vencer o "esconder zeradas": das cores em falta a
  // maioria tem saldo 0, então aplicar o esconde antes esvaziava justamente o
  // que o chip promete mostrar (o contador dizia 51 e a lista vinha vazia).
  if (onlyFalta) return query.eq('is_falta', true);
  if (hideZeradas) return query.eq('is_zerada', false);
  return query;
}

export function usePaginatedProducts(params: PaginatedProductsParams = {}) {
  const {
    search = '', groupId = 'all', supplierId = 'all', status = 'all',
    category = 'all', excludeCategory, hideZeradas = false, onlyFalta = false,
    sortKey = null, sortDir = 'asc', page = 1, limit = PAGE_SIZE,
  } = params;

  const sortColumn = sortKey ? SORT_COLUMNS[sortKey] : null;

  const filters: PaginatedProductsParams = {
    search, groupId, supplierId, status, category, excludeCategory, hideZeradas, onlyFalta,
  };

  return useQuery<PaginatedProductsResult>({
    queryKey: [
      'products', 'paginated', search, groupId, supplierId, status,
      category, excludeCategory || '', hideZeradas, onlyFalta,
      sortColumn || '', sortDir, page, limit,
    ],
    // Sem isto a tabela pisca vazia a cada troca de página.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const countZeradas = productsList()
        .select('id', { count: 'exact', head: true })
        .eq('is_zerada', true);
      const countFalta = productsList()
        .select('id', { count: 'exact', head: true })
        .eq('is_falta', true);

      const [result, zeradas, falta] = await Promise.all([
        fetchPage<any>(
          (from, to) =>
            applyChipFilters(
              applyFilters(
                productsList().select('*', { count: 'exact' }),
                filters,
              ),
              filters,
            )
              // Ordenação escolhida na tela; sem ela, o padrão histórico
              // (mais recém-atualizado primeiro).
              .order(sortColumn ?? 'updated_at', {
                ascending: sortColumn ? sortDir === 'asc' : false,
                nullsFirst: false,
              })
              // Desempate determinístico: sem 2ª chave, linhas com o mesmo
              // valor na coluna de ordenação podem repetir ou sumir entre
              // páginas.
              .order('id', { ascending: true })
              .range(from, to),
          { page, pageSize: limit },
        ),
        // Contagens dos chips ignoram os chips (senão "esconder zeradas"
        // zeraria o próprio contador), mas respeitam os demais filtros.
        applyFilters(countZeradas, filters),
        applyFilters(countFalta, filters),
      ]);

      if (zeradas.error) throw zeradas.error;
      if (falta.error) throw falta.error;

      return {
        ...result,
        items: result.items.map((p: any) => ({
          ...p,
          quantity: Number(p.quantity) || 0,
          min_stock: Number(p.min_stock) || 0,
          max_stock: Number(p.max_stock) || Infinity,
          in_production_quantity: Number(p.in_production_quantity) || 0,
          // Callers leem `product.product_groups?.consumption_unit` (UoM canônica
          // de BOM). A view devolve os campos achatados; remontamos o objeto
          // aninhado pra não quebrar quem já consome esse shape.
          product_groups: p.group_id
            ? { name: p.group_name, consumption_unit: p.group_consumption_unit }
            : null,
        })),
        zeradasCount: zeradas.count ?? 0,
        faltaCount: falta.count ?? 0,
      };
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
