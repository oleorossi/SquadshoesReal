import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { mutateReadyStock, type ReadyStockOperation } from '@/lib/stockCommand';

export type ReadyStockItem = {
  id: string;
  reference_id: string;
  color: string;
  size: string;
  quantity: number;
  location: string;
  notes: string;
  created_at: string;
  updated_at: string;
  material_variant_id?: string | null;
  technical_sheets?: {
    name: string;
    code: string;
    shoe_category: string | null;
    sale_price: number;
    cost_price: number;
    colors: string | null;
    sizes: string | null;
    image_url: string | null;
    color_images: any[] | null;
    cor_predominante_id: string | null;
    brand: string | null;
  } | null;
};

type ReadyStockDeltaInput = {
  reference_id: string;
  material_variant_id?: string | null;
  color: string;
  size: string;
  quantity: number;
  expectedQuantity?: number;
  location?: string;
  notes?: string;
};

function assertReadyStockCommand(result: { success: boolean; errors?: Array<{ error: string }> }) {
  if (result.success) return;
  const code = result.errors?.[0]?.error;
  if (code === 'CONCURRENCY_ERROR') {
    throw new Error('Quantidade foi alterada por outro usuário — recarregue e tente novamente.');
  }
  throw new Error(code || 'Falha ao atualizar a pronta-entrega.');
}

async function currentReadyStockQuantity(item: ReadyStockDeltaInput): Promise<number> {
  let query = supabase
    .from('ready_stock')
    .select('quantity')
    .eq('reference_id', item.reference_id)
    .eq('color', item.color)
    .eq('size', item.size);
  query = item.material_variant_id
    ? query.eq('material_variant_id' as never, item.material_variant_id as never)
    : query.is('material_variant_id' as never, null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return Number(data?.quantity ?? 0);
}

export function useReadyStock() {
  return useQuery({
    queryKey: ['ready_stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ready_stock')
        .select('*, technical_sheets(name, code, shoe_category, sale_price, cost_price, colors, sizes, image_url, color_images, cor_predominante_id, brand)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ReadyStockItem[];
    },
    staleTime: 30_000,
    gcTime: 120_000,
  });
}

export function useUpsertReadyStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: ReadyStockDeltaInput) => {
      const expectedQuantity = item.expectedQuantity ?? await currentReadyStockQuantity(item);
      const result = await mutateReadyStock([{
        action: 'delta',
        reference_id: item.reference_id,
        material_variant_id: item.material_variant_id ?? null,
        color: item.color,
        size: item.size,
        delta: item.quantity,
        expected_quantity: expectedQuantity,
        location: item.location ?? null,
        notes: item.notes ?? null,
        reason: 'Lançamento manual em pronta-entrega',
      }]);
      assertReadyStockCommand(result);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock'] });
      toast.success('Estoque atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

type ReadyStockSetInput = ReadyStockDeltaInput & { id?: string };

export function useSetReadyStockGrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: ReadyStockSetInput[]) => {
      const operations: ReadyStockOperation[] = [];
      for (const item of items) {
        if (item.id) {
          operations.push({
            action: 'set',
            id: item.id,
            quantity: item.quantity,
            expected_quantity: item.expectedQuantity ?? await currentReadyStockQuantity(item),
            location: item.location ?? null,
            notes: item.notes ?? null,
            reason: 'Definição de grade na pronta-entrega',
          });
        } else {
          operations.push({
            action: 'delta',
            reference_id: item.reference_id,
            material_variant_id: item.material_variant_id ?? null,
            color: item.color,
            size: item.size,
            delta: item.quantity,
            expected_quantity: item.expectedQuantity ?? 0,
            location: item.location ?? null,
            notes: item.notes ?? null,
            reason: 'Definição de grade na pronta-entrega',
          });
        }
      }
      const result = await mutateReadyStock(operations);
      assertReadyStockCommand(result);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock'] });
      toast.success('Grade definida no estoque.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useBatchUpsertReadyStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: ReadyStockDeltaInput[]) => {
      const expected = await Promise.all(items.map((item) =>
        item.expectedQuantity === undefined ? currentReadyStockQuantity(item) : item.expectedQuantity
      ));
      const operations: ReadyStockOperation[] = items.map((item, index) => ({
        action: 'delta',
        reference_id: item.reference_id,
        material_variant_id: item.material_variant_id ?? null,
        color: item.color,
        size: item.size,
        delta: item.quantity,
        expected_quantity: expected[index],
        location: item.location ?? null,
        notes: item.notes ?? null,
        reason: 'Lançamento manual em lote na pronta-entrega',
      }));
      const result = await mutateReadyStock(operations);
      assertReadyStockCommand(result);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock'] });
      toast.success('Lançamento em lote concluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateReadyStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, quantity, location, notes, expectedQuantity }: {
      id: string;
      quantity: number;
      location?: string;
      notes?: string;
      expectedQuantity?: number;
    }) => {
      let expected = expectedQuantity;
      if (expected === undefined) {
        const { data, error } = await supabase.from('ready_stock').select('quantity').eq('id', id).single();
        if (error) throw error;
        expected = Number(data.quantity);
      }
      const result = await mutateReadyStock([{
        action: 'set', id, quantity, expected_quantity: expected,
        location: location ?? null, notes: notes ?? null,
        reason: 'Edição manual da pronta-entrega',
      }]);
      assertReadyStockCommand(result);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock'] });
      toast.success('Quantidade atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteReadyStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | { id: string; expectedQuantity?: number }) => {
      const id = typeof input === 'string' ? input : input.id;
      let expected = typeof input === 'string' ? undefined : input.expectedQuantity;
      if (expected === undefined) {
        const { data, error } = await supabase.from('ready_stock').select('quantity').eq('id', id).single();
        if (error) throw error;
        expected = Number(data.quantity);
      }
      const result = await mutateReadyStock([{
        action: 'delete', id, expected_quantity: expected,
        reason: 'Remoção manual da pronta-entrega',
      }]);
      assertReadyStockCommand(result);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock'] });
      toast.success('Item removido!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useBatchDeleteReadyStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: Array<{ id: string; expectedQuantity?: number }>) => {
      if (items.length === 0) return;
      const expected = await Promise.all(items.map(async (item) => {
        if (item.expectedQuantity !== undefined) return item.expectedQuantity;
        const { data, error } = await supabase
          .from('ready_stock')
          .select('quantity')
          .eq('id', item.id)
          .single();
        if (error) throw error;
        return Number(data.quantity);
      }));
      const result = await mutateReadyStock(items.map((item, index) => ({
        action: 'delete' as const,
        id: item.id,
        expected_quantity: expected[index],
        reason: 'Remocao manual em lote da pronta-entrega',
      })));
      assertReadyStockCommand(result);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ready_stock'] });
      toast.success('Itens removidos!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
