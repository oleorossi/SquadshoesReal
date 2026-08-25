import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { forceDeleteProductCommand } from '@/services/purchaseOrderCommandService';
import { ProductFormData } from '@/types/inventory';
import { toast } from 'sonner';
import { sanitizeUuidFields } from '@/lib/utils';
import { SECTOR_OPTIONS } from '@/lib/categoryFromGroup';
import { z } from 'zod';
import {
  createProductWithStock,
  createProductsWithStock,
  type CreateProductWithStockInput,
} from '@/lib/stockCommand';

export const ProductSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(255),
  sku: z.string().min(1, "SKU é obrigatório"),
  quantity: z.number().min(0, "Quantidade deve ser positiva"),
  unit_price: z.number().min(0, "Preço deve ser zero ou positivo"),
  category: z.string().optional(),
  color: z.string().optional(),
  min_stock: z.number().optional(),
  max_stock: z.number().optional(),
  unit: z.string().optional(),
  location: z.string().optional(),
  group_id: z.string().nullable().optional(),
  active: z.boolean().optional(),
  calculation_method: z.enum(['weight', 'meter', 'unit']).optional(),
  is_chemical: z.boolean().optional(),
  sole_material: z.string().nullable().optional(),
  heel_height: z.number().nullable().optional(),
  is_standard_sole_item: z.boolean().optional(),
  purchase_multiple: z.number().min(0, "Múltiplo deve ser zero ou positivo").optional(),
  supplier_id: z.string().uuid().nullable().optional(),
  supplier_color_code: z.string().nullable().optional(),
}).passthrough().superRefine((product, ctx) => {
  const code = product.supplier_color_code?.trim() || null;
  if (code && !product.supplier_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['supplier_color_code'],
      message: 'Código da cor do fornecedor exige um fornecedor selecionado',
    });
  }
});

/** Normalização única usada nas bordas de INSERT/UPDATE. Campo ausente em um
 * patch continua ausente; string vazia vira NULL e código sem fornecedor é
 * rejeitado antes de chegar ao CHECK do banco. */
export function normalizeProductSupplierColor<T extends {
  supplier_id?: string | null;
  supplier_color_code?: string | null;
}>(data: T): T {
  if (!Object.prototype.hasOwnProperty.call(data, 'supplier_color_code')) return data;
  const supplierColorCode = data.supplier_color_code?.trim() || null;
  // Em UPDATE parcial, supplier_id ausente significa "preserve o existente";
  // só rejeitamos quando o próprio payload o remove explicitamente. O CHECK e
  // o trigger do banco validam o estado final sob concorrência.
  if (supplierColorCode
      && Object.prototype.hasOwnProperty.call(data, 'supplier_id')
      && !data.supplier_id) {
    throw new Error('Selecione o fornecedor antes de informar o código da cor');
  }
  return { ...data, supplier_color_code: supplierColorCode };
}

export function stripProductPhysicalFields<T extends Record<string, unknown>>(data: T) {
  const {
    quantity,
    current_stock,
    reserved_stock,
    stock_grade,
    blocked_qty,
    quarantine_qty,
    ...metadata
  } = data;
  return {
    metadata,
    physical: { quantity, current_stock, reserved_stock, stock_grade, blocked_qty, quarantine_qty },
  };
}


export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const PAGE = 1000;
      // Get total count first so we can fetch all pages in parallel.
      const { count, error: countError } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true });
      if (countError) throw countError;
      const total = count ?? 0;
      if (total === 0) return [];
      const pages = Math.ceil(total / PAGE);
      const all: any[] = [];
      // Fetch in batches of 5 concurrent requests to avoid overwhelming the API
      for (let batch = 0; batch < pages; batch += 5) {
        const batchPages = Array.from({ length: Math.min(5, pages - batch) }, (_, i) => batch + i);
        const results = await Promise.all(batchPages.map(i =>
          supabase
            .from('products')
            // consumption_unit incluído (2026-05-31): TechnicalReferencePanel
            // lê product.product_groups?.consumption_unit ao adicionar material
            // ao BOM. Sem ele cai pro fallback product.unit (estoque, ex: 'un'/
            // 'rolo'), gerando consumo na unidade errada.
            // package_weight_kg incluído (F5-03, 2026-07): AddToStockDialog e
            // o lançamento em lote do Suppliers convertem NF→estoque via
            // convertNfToStockUnit; sem o peso da embalagem do grupo a
            // Prioridade 5 (pacote→massa) bloqueava mesmo com peso cadastrado.
            .select('*, product_groups!products_group_id_fkey(name, consumption_unit, purchase_multiple, package_weight_kg)')
            .order('updated_at', { ascending: false })
            .range(i * PAGE, (i + 1) * PAGE - 1),
        ));
        for (const { data, error } of results) {
          if (error) throw error;
          if (data) all.push(...data);
        }
      }
      return all;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useAddProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (form: ProductFormData) => {
      const normalized = normalizeProductSupplierColor(form);
      const sanitized = {
        ...sanitizeUuidFields(normalized),
        max_stock: form.max_stock ?? 0,
      } as ProductFormData;
      const product: CreateProductWithStockInput = {
        ...sanitized,
        quantity: Number(sanitized.quantity ?? 0),
        reason: 'Cadastro manual de produto com saldo/grade inicial',
      };
      const result = await createProductWithStock(product);
      if (!result.success || !result.product_id) {
        throw new Error(result.errors?.[0]?.error || 'Falha ao cadastrar produto');
      }
      const { data, error } = await supabase
        .from('products')
        .select()
        .eq('id', result.product_id)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Produto adicionado com sucesso!');
    },
    onError: (err: Error) => toast.error(`Erro ao adicionar: ${err.message}`),
  });
}

// Extrai o nome base do material (sem a última palavra que geralmente é cor/variação)
// Regra: só agrupa quando o nome tem um separador claro (":" ou " - ") OU 3+ palavras.
// Itens com 2 palavras (ex.: "COLA FORTE", "COLA PVC") são tratados como produtos
// distintos, NÃO como variantes uns dos outros.
export function getBaseName(name: string): string {
  const colonIdx = name.lastIndexOf(':');
  if (colonIdx > 0) return name.substring(0, colonIdx).trim();
  const dashIdx = name.lastIndexOf(' - ');
  if (dashIdx > 0) return name.substring(0, dashIdx).trim();
  const words = name.trim().split(/\s+/);
  // Need at least 3 words to safely derive a base by stripping the last token.
  // With 2 words ("COLA FORTE"), the last word IS the differentiator, not a variant.
  if (words.length < 3) return '';
  return words.slice(0, -1).join(' ');
}

const SYNC_FIELDS = [
  'category', 'unit', 'group_id', 'location',
  'dimensions_length', 'dimensions_width', 'dimensions_thickness', 'dimensions_unit',
  'unit_price', 'min_stock', 'max_stock',
] as const;

export type SyncInfo = {
  siblingNames: string[];
  siblingIds: string[];
  changedFields: Record<string, any>;
};

export async function checkSiblings(
  id: string,
  data: ProductFormData,
  previousData: ProductFormData
): Promise<SyncInfo | null> {
  const hasChanges = SYNC_FIELDS.some(f => data[f] !== previousData[f]);
  if (!hasChanges || !data.name) return null;

  const baseName = getBaseName(data.name);
  if (!baseName) return null; // Single-word name, no siblings to sync
  // Filter at DB level by base name prefix (avoids full-table scan).
  // Escape ILIKE special chars in baseName so names with % or _ don't break the pattern.
  const escaped = baseName.replace(/[%_\\]/g, c => `\\${c}`);
  const { data: siblings } = await supabase
    .from('products')
    .select('id, name')
    .neq('id', id)
    .ilike('name', `${escaped}%`);

  if (!siblings?.length) return null;

  const matching = siblings.filter(p => getBaseName(p.name) === baseName);
  if (!matching.length) return null;

  const changedFields: Record<string, any> = {};
  for (const field of SYNC_FIELDS) {
    if (data[field] !== previousData[field]) {
      changedFields[field] = data[field];
    }
  }

  return {
    siblingNames: matching.map(p => p.name),
    siblingIds: matching.map(p => p.id),
    changedFields,
  };
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ProductFormData }) => {
      // Strip quantity and stock_grade from the plain UPDATE — they must go
      // through the adjust_stock RPC (with stock_movements audit row and
      // concurrency control). A direct write races with debit RPCs and bypasses
      // the audit trail; same guard applied to usePackaging (audit-37 [3]).
      const normalized = normalizeProductSupplierColor(data);
      const { metadata: safeData, physical } = stripProductPhysicalFields(normalized);
      const { min_stock_grade: _ignoredMinStockGrade, ...metadata } = safeData;
      if (physical.quantity !== undefined || physical.stock_grade !== undefined || physical.reserved_stock !== undefined) {
        // Surface a developer warning; the stock adjustment page is the correct path.
        console.warn('[useUpdateProduct] physical stock fields stripped — use the canonical stock command.');
      }
      const { error } = await supabase
        .from('products')
        .update(sanitizeUuidFields(metadata) as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Produto atualizado com sucesso!');
    },
    onError: (err: Error) => toast.error(`Erro ao atualizar: ${err.message}`),
  });
}

/**
 * Define (ou limpa) o grupo de um conjunto de produtos de uma vez.
 * - mover item → group_id = grupo destino
 * - remover do grupo → group_id = null
 * - adicionar ao grupo → group_id = grupo alvo
 * Usado pela gestão de itens por grupo (página Grupos).
 */
export function useSetProductsGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, group_id }: { ids: string[]; group_id: string | null }) => {
      if (!ids.length) return { count: 0 };
      const { error } = await supabase.from('products').update({ group_id }).in('id', ids);
      if (error) throw error;
      return { count: ids.length };
    },
    onSuccess: ({ count }) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product_groups'] });
      if (count) toast.success(`${count} ${count === 1 ? 'item atualizado' : 'itens atualizados'}.`);
    },
    onError: (err: Error) => toast.error(`Erro ao mover itens: ${err.message}`),
  });
}

/**
 * Aplica um MESMO preço/custo unitário (unit_price) a vários produtos de uma
 * vez. Usado pela gestão de itens por grupo (página Grupos) pra corrigir o
 * custo de vários itens do grupo num clique. Só mexe em unit_price — NÃO toca
 * quantity/stock, então não dispara trigger de estoque/OC automática.
 */
export function useBulkSetProductPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, unit_price }: { ids: string[]; unit_price: number }) => {
      if (!ids.length) return { count: 0 };
      const { error } = await supabase.from('products').update({ unit_price }).in('id', ids);
      if (error) throw error;
      return { count: ids.length };
    },
    onSuccess: ({ count }) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      if (count) toast.success(`Preço aplicado em ${count} ${count === 1 ? 'item' : 'itens'}.`);
    },
    onError: (err: Error) => toast.error(`Erro ao aplicar preço: ${err.message}`),
  });
}

export function useSyncSiblings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ siblingIds, changedFields }: { siblingIds: string[]; changedFields: Record<string, string | null> }) => {
      const { error } = await supabase
        .from('products')
        .update(sanitizeUuidFields(changedFields) as any)
        .in('id', siblingIds);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`${vars.siblingIds.length} ${vars.siblingIds.length === 1 ? 'material similar atualizado' : 'materiais similares atualizados'}`);
    },
    onError: (err: Error) => toast.error(`Erro ao sincronizar: ${err.message}`),
  });
}

export interface ProductLinksSummary {
  sheet_materials: number;
  reservations: number;
  purchase_items: number;
  stock_movements: number;
  /** Fichas que levam o produto como COMPONENTE DIRETO (jsonb, sem FK). */
  direct_components: number;
  hasAny: boolean;
}

interface ForceDeleteProductSummary {
  product_name: string;
  sheet_materials_count: number;
  reservations_count: number;
  purchase_items_count: number;
  stock_movements_count: number;
  direct_components_count: number;
}

/** Conta vínculos antes de excluir — útil pra mostrar resumo no AlertDialog. */
export async function fetchProductLinks(id: string): Promise<ProductLinksSummary> {
  const [
    { count: smCount, error: e1 },
    { count: resCount, error: e2 },
    { count: poiCount, error: e3 },
    { count: movCount, error: e4 },
    { count: dcCount, error: e5 },
  ] = await Promise.all([
    supabase.from('sheet_materials').select('id', { count: 'exact', head: true }).eq('product_id', id),
    supabase.from('material_reservations').select('id', { count: 'exact', head: true })
      .eq('product_id', id).in('status', ['reserved', 'partially_consumed']),
    supabase.from('purchase_order_items').select('id', { count: 'exact', head: true }).eq('product_id', id),
    supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('product_id', id),
    // direct_components é jsonb DENTRO de technical_sheets — não há FK, então o
    // DELETE não falha e sem esta contagem o produto era apagado sem nenhum
    // aviso, deixando a ficha apontando pro nada (bug 31/07/2026: 25 linhas
    // mortas em 24 fichas, 5.400 corações somem do custo e da compra do PV).
    supabase.from('technical_sheets').select('id', { count: 'exact', head: true })
      .contains('direct_components', [{ product_id: id }]),
  ]);
  if (e1 || e2 || e3 || e4 || e5) throw new Error('Erro ao verificar vínculos do produto.');
  const sheet_materials = smCount ?? 0;
  const reservations = resCount ?? 0;
  const purchase_items = poiCount ?? 0;
  const stock_movements = movCount ?? 0;
  const direct_components = dcCount ?? 0;
  return {
    sheet_materials, reservations, purchase_items, stock_movements, direct_components,
    hasAny: sheet_materials > 0 || reservations > 0 || purchase_items > 0
      || stock_movements > 0 || direct_components > 0,
  };
}

/**
 * Excluir produto.
 *   • `deleteProduct.mutate(id)` — comportamento padrão (bloqueia se há vínculos)
 *   • `deleteProduct.mutate({ id, force: true })` — exclusão forçada via RPC
 *     `force_delete_product`. Apaga BOMs/reservas/OCs/movimentações junto.
 *     Use APENAS via dialog de confirmação dupla — perde histórico.
 */
export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | { id: string; force?: boolean }) => {
      const id = typeof input === 'string' ? input : input.id;
      const force = typeof input === 'string' ? false : Boolean(input.force);

      if (force) {
        const { data: product, error: productError } = await supabase
          .from('products')
          .select('updated_at')
          .eq('id', id)
          .single();
        if (productError) throw productError;
        const summary = await forceDeleteProductCommand({
          productId: id,
          expectedUpdatedAt: product.updated_at,
        });
        return { force: true, summary: summary as unknown as ForceDeleteProductSummary };
      }

      const links = await fetchProductLinks(id);
      if (links.hasAny) {
        const msgs: string[] = [];
        if (links.sheet_materials > 0) msgs.push(`${links.sheet_materials} ${links.sheet_materials === 1 ? 'ficha técnica' : 'fichas técnicas'}`);
        if (links.reservations > 0)    msgs.push(`${links.reservations} ${links.reservations === 1 ? 'reserva ativa' : 'reservas ativas'}`);
        if (links.purchase_items > 0)  msgs.push(`${links.purchase_items} ${links.purchase_items === 1 ? 'item' : 'itens'} de OC`);
        if (links.stock_movements > 0) msgs.push(`${links.stock_movements} ${links.stock_movements === 1 ? 'movimentação' : 'movimentações'} de estoque`);
        if (links.direct_components > 0) msgs.push(`${links.direct_components} ${links.direct_components === 1 ? 'ficha que leva ele como componente' : 'fichas que levam ele como componente'}`);
        // Lança erro que carrega flag `_canForce` — UI pode interceptar e mostrar
        // dialog de exclusão forçada em vez do toast genérico.
        const err: any = new Error(`Produto vinculado a ${msgs.join(', ')}. Desative-o em vez de excluir.`);
        err._canForce = true;
        err._productId = id;
        err._links = links;
        throw err;
      }
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      return { force: false };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['sheet_materials'] });
      queryClient.invalidateQueries({ queryKey: ['material_reservations'] });
      if (result?.force && result.summary) {
        const s = result.summary;
        const parts = [];
        if (s.sheet_materials_count > 0) parts.push(`${s.sheet_materials_count} BOM`);
        if (s.reservations_count > 0)    parts.push(`${s.reservations_count} reserva(s)`);
        if (s.purchase_items_count > 0)  parts.push(`${s.purchase_items_count} OC`);
        if (s.stock_movements_count > 0) parts.push(`${s.stock_movements_count} movimentação(ões)`);
        if (s.direct_components_count > 0) parts.push(`${s.direct_components_count} ficha(s) de componente`);
        toast.success(`Produto "${s.product_name}" excluído. Removidos: ${parts.join(', ') || 'nenhum vínculo'}.`);
      } else {
        toast.success('Produto excluído com sucesso!');
      }
    },
    onError: (err: any) => {
      // Não mostra toast genérico quando o caller vai abrir um dialog de force —
      // a flag _canForce sinaliza que a UI tratará via componente próprio.
      if (!err?._canForce) toast.error(`Erro ao excluir: ${err.message}`);
    },
  });
}

export function useBatchAddProducts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: ProductFormData[]) => {
      const split = items.map((item) => {
        const normalized = normalizeProductSupplierColor(item);
        return sanitizeUuidFields(normalized) as ProductFormData;
      });
      const result = await createProductsWithStock(split.map((item) => ({
        ...item,
        quantity: Number(item.quantity ?? 0),
        reason: 'Cadastro manual em lote com saldo/grade inicial',
      })));
      if (!result.success) {
        throw new Error(result.errors?.[0]?.error || 'Falha ao cadastrar produtos em lote');
      }
      const ids = (result.results ?? [])
        .map((row) => row.product_id)
        .filter((id): id is string => typeof id === 'string');
      if (ids.length !== split.length) {
        throw new Error('Comando de estoque retornou lote de produtos incompleto');
      }
      const { data, error } = await supabase
        .from('products')
        .select()
        .in('id', ids);
      if (error) throw error;
      const byId = new Map((data || []).map((product) => [product.id, product]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`${data.length} itens criados com sucesso!`);
    },
    onError: (err: Error) => toast.error(`Erro ao criar itens: ${err.message}`),
  });
}

export function useAutoGroupProducts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (products: { id: string; name: string; group_id: string | null }[]) => {
      // Group products by base name
      const baseGroups = new Map<string, typeof products>();
      for (const p of products) {
        const base = getBaseName(p.name);
        if (!base) continue;
        const arr = baseGroups.get(base) || [];
        arr.push(p);
        baseGroups.set(base, arr);
      }

      // Only consider groups with 2+ items
      const toGroup = Array.from(baseGroups.entries()).filter(([, items]) => items.length >= 2);
      if (toGroup.length === 0) return { created: 0, assigned: 0 };

      // Fetch existing groups
      const { data: existingGroups } = await supabase.from('product_groups').select('id, name');
      const groupMap = new Map<string, string>();
      (existingGroups || []).forEach(g => groupMap.set(g.name.toUpperCase(), g.id));

      let created = 0;
      let assigned = 0;

      for (const [baseName, items] of toGroup) {
        const upperBase = baseName.toUpperCase();
        let groupId = groupMap.get(upperBase);

        // Create group if it doesn't exist. Setor é obrigatório desde
        // 20260901140000 — deriva da categoria dos itens (fallback 'Componente').
        if (!groupId) {
          const itemCat = (items as any[]).find(p => p?.category)?.category;
          const sector = SECTOR_OPTIONS.some(o => o.value === itemCat) ? itemCat : 'Componente';
          const { data: newGroup, error } = await supabase
            .from('product_groups')
            .insert({ name: baseName, description: `Agrupamento automático: ${items.length} variações`, sector })
            .select()
            .single();
          if (error) continue;
          groupId = newGroup.id;
          groupMap.set(upperBase, groupId);
          created++;
        }

        // Assign group to products that don't have one
        const unassigned = items.filter(p => !p.group_id || p.group_id !== groupId);
        if (unassigned.length > 0) {
          const { error } = await supabase
            .from('products')
            .update({ group_id: groupId })
            .in('id', unassigned.map(p => p.id));
          if (!error) assigned += unassigned.length;
        }
      }

      return { created, assigned };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product_groups'] });
      if (result.created === 0 && result.assigned === 0) {
        toast.info('Nenhum agrupamento necessário — todos os itens já estão agrupados ou são únicos.');
      } else {
        toast.success(`${result.created} ${result.created === 1 ? 'grupo criado' : 'grupos criados'}, ${result.assigned} ${result.assigned === 1 ? 'item agrupado' : 'itens agrupados'}!`);
      }
    },
    onError: (err: Error) => toast.error(`Erro ao agrupar: ${err.message}`),
  });
}

/** Find the group_id for a product name based on existing products' base names */
export async function findGroupForProduct(productName: string): Promise<string | null> {
  const baseName = getBaseName(productName);
  if (!baseName) return null;

  // Find a product with the same base name that already has a group
  const { data: siblings } = await supabase
    .from('products')
    .select('group_id, name')
    .not('group_id', 'is', null)
    .limit(500);

  if (!siblings?.length) return null;
  const match = siblings.find(p => getBaseName(p.name) === baseName);
  return match?.group_id || null;
}
