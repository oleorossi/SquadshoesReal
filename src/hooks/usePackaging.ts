import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { IndividualPackaging } from '@/types/packaging';

/**
 * Números do topo da tela de Embalagens.
 *
 * Reordenado em 02/08/2026 (R3 do sistema de telas): o trilho responde
 * "preciso agir?" ANTES de "o que tem aqui?", então as PENDÊNCIAS vêm primeiro
 * e os totais informativos depois. Foi a cegueira a esses números que deixou a
 * embalagem passar meses sem debitar sem ninguém perceber.
 */
export interface PackagingStats {
  // ── pendências (o que exige ação) ──
  /** Caixas ativas com estoque <= mínimo (mínimo > 0). */
  low_stock_alerts: number;
  /** Caixas ativas com unit_price 0/nulo — zeram o custo de embalagem no custeio. */
  boxes_without_price: number;
  /** Caixas sem tara (empty_weight_kg) — peso bruto da NF-e sai errado. */
  boxes_without_tare: number;
  /** Grupos de solado sem NENHUM dos 3 modos montado — PV entra e não debita. */
  soles_without_packaging: number;
  // ── totais (informativo) ──
  total_boxes: number;
  total_units: number;
}

export function usePackagingStats() {
  return useQuery<PackagingStats>({
    queryKey: ['packagingStats'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('box_types')
        .select('id, quantity, min_stock, unit_price, empty_weight_kg, active')
        .eq('active', true);
      if (error) throw error;
      const boxes = (data ?? []) as Array<{
        quantity: number | null; min_stock: number | null;
        unit_price: number | null; empty_weight_kg: number | null;
      }>;

      // Prontidão dos 3 modos por modelo de solado — a view nasceu com a
      // migration 20261110120000, junto com a fonte única no solado.
      const { data: soles, error: solesErr } = await (supabase as any)
        .from('v_solados_sem_embalagem')
        .select('modo_tradicional_ok, modo_amarrado_ok, modo_colmeia_ok');
      if (solesErr) throw new Error(`Falha ao ler prontidão de embalagem dos solados: ${solesErr.message}`);

      const semNenhumModo = ((soles ?? []) as Array<Record<string, boolean>>)
        .filter(s => !s.modo_tradicional_ok && !s.modo_amarrado_ok && !s.modo_colmeia_ok).length;

      return {
        low_stock_alerts: boxes.filter(b =>
          Number(b.min_stock || 0) > 0 && Number(b.quantity || 0) <= Number(b.min_stock || 0)).length,
        boxes_without_price: boxes.filter(b => !(Number(b.unit_price || 0) > 0)).length,
        boxes_without_tare: boxes.filter(b => !(Number(b.empty_weight_kg || 0) > 0)).length,
        soles_without_packaging: semNenhumModo,
        total_boxes: boxes.length,
        total_units: boxes.reduce((s, b) => s + Number(b.quantity || 0), 0),
      };
    },
    staleTime: 2 * 60_000,
  });
}

function boxToIndividualPackaging(box: any): IndividualPackaging {
  const l = Number(box.comprimento_cm) || 0;
  const w = Number(box.largura_cm) || 0;
  const h = Number(box.altura_cm) || 0;
  return {
    id: box.id,
    product_name: box.nome ?? '',
    product_reference: box.nome ?? '',
    internal_code: box.id?.slice(0, 8) ?? '',
    packaging_type: box.interno ? 'individual' : 'master',
    material: 'cardboard',
    dimensions: { length: l, width: w, height: h, volume: l * w * h, weight: Number(box.peso_kg) || 0 },
    unit_cost: Number(box.unit_price) || 0,
    current_stock: Number(box.quantity) || 0,
    minimum_stock: Number(box.min_stock) || 0,
    supplier_name: box.suppliers?.name ?? null,
    notes: null,
    is_active: box.active ?? true,
  };
}

export function useIndividualPackaging(filters?: {
  packaging_type?: string;
  material?: string;
  is_active?: boolean;
}) {
  return useQuery<IndividualPackaging[]>({
    queryKey: ['individualPackaging', filters],
    queryFn: async () => {
      let q = supabase.from('box_types').select('*, suppliers:supplier_id(id, name)').order('nome');
      if (filters?.is_active !== undefined) q = q.eq('active', filters.is_active);
      if (filters?.packaging_type === 'individual') q = q.eq('interno', true);
      if (filters?.packaging_type === 'master') q = q.eq('interno', false);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map(boxToIndividualPackaging);
    },
  });
}

export function useCreateIndividualPackaging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<IndividualPackaging, 'id'>) => {
      const { error } = await supabase.from('box_types').insert({
        nome: data.product_name,
        comprimento_cm: data.dimensions.length,
        largura_cm: data.dimensions.width,
        altura_cm: data.dimensions.height,
        peso_kg: data.dimensions.weight,
        interno: data.packaging_type === 'individual',
        unit_price: data.unit_cost || 0,
        quantity: data.current_stock || 0,
        min_stock: data.minimum_stock || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['individualPackaging'] });
      qc.invalidateQueries({ queryKey: ['packagingStats'] });
      qc.invalidateQueries({ queryKey: ['box_types'] });
      toast.success('Embalagem criada com sucesso');
    },
    onError: () => toast.error('Erro ao criar embalagem'),
  });
}

export function useUpdateIndividualPackaging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<IndividualPackaging> }) => {
      const payload: Record<string, unknown> = {};
      if (updates.product_name) payload.nome = updates.product_name;
      if (updates.dimensions) {
        payload.comprimento_cm = updates.dimensions.length;
        payload.largura_cm = updates.dimensions.width;
        payload.altura_cm = updates.dimensions.height;
        payload.peso_kg = updates.dimensions.weight;
      }
      if (updates.unit_cost !== undefined) payload.unit_price = updates.unit_cost;
      // current_stock / quantity is intentionally excluded from the plain UPDATE:
      // writing it directly races with debit_packaging_for_order (last-write-wins
      // clobbers parallel debits) and bypasses the stock_movements audit trail.
      // Quantity adjustments must go through an atomic RPC with a stock_movements row.
      if (updates.minimum_stock !== undefined) payload.min_stock = updates.minimum_stock;
      if (updates.is_active !== undefined) payload.active = updates.is_active;
      payload.updated_at = new Date().toISOString();
      const { error } = await supabase.from('box_types').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['individualPackaging'] });
      qc.invalidateQueries({ queryKey: ['packagingStats'] });
      qc.invalidateQueries({ queryKey: ['box_types'] });
      toast.success('Embalagem atualizada com sucesso');
    },
    onError: () => toast.error('Erro ao atualizar embalagem'),
  });
}

/** Soft-delete a packaging (sets active=false). Hard delete only if the user really wants it. */
export function useDeleteIndividualPackaging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, hard = false }: { id: string; hard?: boolean }) => {
      if (hard) {
        // Preflight: refuse hard-delete when the box_type is referenced by OPs,
        // packaging_configs, technical_sheets or stock_movements. Hard delete would
        // either CASCADE-wipe linked stock movements or fail on FK; both bypass the
        // audit trail or leave an inconsistent UX.
        const [opRes, cfgRes, sheetRes, movRes] = await Promise.all([
          supabase.from('orders').select('id', { count: 'exact', head: true })
            .eq('packaging_product_id', id).not('status', 'in', '("Cancelada","Finalizado")'),
          supabase.from('packaging_configs').select('sheet_id', { count: 'exact', head: true })
            .eq('box_type_id', id),
          supabase.from('technical_sheets').select('id', { count: 'exact', head: true })
            .eq('box_type_id', id),
          supabase.from('stock_movements').select('id', { count: 'exact', head: true })
            .eq('product_id', id),
        ]);
        if (opRes.error) throw new Error(`Falha ao verificar OPs vinculadas: ${opRes.error.message}`);
        if (cfgRes.error) throw new Error(`Falha ao verificar configurações de embalagem: ${cfgRes.error.message}`);
        if (sheetRes.error) throw new Error(`Falha ao verificar fichas técnicas: ${sheetRes.error.message}`);
        if (movRes.error) throw new Error(`Falha ao verificar movimentações: ${movRes.error.message}`);
        const blockers: string[] = [];
        if ((opRes.count ?? 0) > 0) blockers.push(`${opRes.count} ${opRes.count === 1 ? 'OP ativa' : 'OPs ativas'}`);
        if ((cfgRes.count ?? 0) > 0) blockers.push(`${cfgRes.count} ${cfgRes.count === 1 ? 'config' : 'configs'}`);
        if ((sheetRes.count ?? 0) > 0) blockers.push(`${sheetRes.count} ${sheetRes.count === 1 ? 'ficha técnica' : 'fichas técnicas'}`);
        if ((movRes.count ?? 0) > 0) blockers.push(`${movRes.count} ${movRes.count === 1 ? 'movimentação' : 'movimentações'} de estoque`);
        if (blockers.length > 0) {
          throw new Error(`Embalagem vinculada a ${blockers.join(', ')}. Desative-a (active=false) em vez de excluir.`);
        }
        const { error } = await supabase.from('box_types').delete().eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('box_types')
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['individualPackaging'] });
      qc.invalidateQueries({ queryKey: ['packagingStats'] });
      qc.invalidateQueries({ queryKey: ['packagingAlerts'] });
      qc.invalidateQueries({ queryKey: ['box_types'] });
      qc.invalidateQueries({ queryKey: ['box_types_stock'] });
      toast.success('Embalagem excluída');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao excluir embalagem'),
  });
}

/** Duplicate a box_type row (copies dimensions/cost/min_stock; resets quantity to 0). */
export function useDuplicateIndividualPackaging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: src, error: e1 } = await supabase
        .from('box_types')
        .select('*')
        .eq('id', id)
        .single();
      if (e1) throw e1;
      if (!src) throw new Error('Embalagem não encontrada');

      const { id: _omit, created_at: _c, updated_at: _u, ...rest } = src as any;
      const { error: e2 } = await supabase.from('box_types').insert({
        ...rest,
        nome: `${src.nome} (cópia)`,
        quantity: 0,
        active: true,
      });
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['individualPackaging'] });
      qc.invalidateQueries({ queryKey: ['packagingStats'] });
      qc.invalidateQueries({ queryKey: ['box_types'] });
      qc.invalidateQueries({ queryKey: ['box_types_stock'] });
      toast.success('Embalagem duplicada');
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao duplicar embalagem'),
  });
}

/** Hook to get low-stock packaging alerts */
export function usePackagingAlerts() {
  return useQuery({
    queryKey: ['packagingAlerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('box_types')
        .select('id, nome, interno, quantity, min_stock, unit_price, supplier_id')
        .eq('active', true)
        .order('nome');
      if (error) throw error;
      return (data ?? []).filter(b =>
        Number(b.min_stock || 0) > 0 && Number(b.quantity || 0) <= Number(b.min_stock || 0)
      );
    },
    staleTime: 2 * 60_000,
  });
}

export interface PackagingCatalogItem {
  id: string;
  nome: string;
  tipo: 'individual' | 'master' | 'colmeia';
  comprimento_ext: number;
  largura_ext: number;
  altura_ext: number;
  capacidade_pares: number;
  is_active: boolean;
}

export function usePackagingCatalog() {
  return useQuery<PackagingCatalogItem[]>({
    queryKey: ['packagingCatalog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaging_catalog')
        .select('*')
        .order('nome');
      if (error) throw error;
      return data as PackagingCatalogItem[];
    },
  });
}

export function useCreatePackagingCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<PackagingCatalogItem, 'id'>) => {
      const { error } = await supabase.from('packaging_catalog').insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packagingCatalog'] });
      toast.success('Item do catálogo criado com sucesso');
    },
    onError: () => toast.error('Erro ao criar item do catálogo'),
  });
}

