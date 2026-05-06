import { useQuery, useMutation, useQueryClient, UseQueryResult, QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { resyncOPsForSheet } from '@/lib/resyncOPs';

/**
 * Helper unificado: dispara resync (await) e invalida caches.
 * Substitui o padrão fire-and-forget que escondia erros nos onSuccess.
 */
async function runResyncAndInvalidate(qc: QueryClient, sheetId: string) {
  try {
    const result = await resyncOPsForSheet(sheetId);
    if (result.totalResyncedOPs > 0) {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      toast.success(`${result.totalResyncedOPs} OP(s) resincronizada(s) automaticamente!`);
    }
    if (result.errors.length > 0) {
      toast.warning(`${result.errors.length} erro(s) no resync`, {
        description: result.errors.slice(0, 3).join('\n'),
      });
    }
  } catch (err: any) {
    toast.warning('Mudança salva, mas o resync automático falhou.', {
      description: err?.message,
    });
  }
}

export type OverheadHistoryEntry = {
  id: string;
  sheet_id: string;
  changed_by: string;
  old_value: number | null;
  new_value: number | null;
  created_at: string;
  profiles?: {
    full_name: string;
  };
};
export function useOverheadHistory(sheetId: string | null): UseQueryResult<OverheadHistoryEntry[], Error> {
  return useQuery({
    queryKey: ['overhead_history', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheet_overhead_history')
        .select('*')
        .eq('sheet_id', sheetId!)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as unknown as OverheadHistoryEntry[];
    },
  });
}

export type SheetFormData = {
  name: string;
  brand?: string;
  model?: string;
  description: string;
  shoe_category: string;
  sizes: string;
  status: string;
  code: string;
  gender: string;
  // Commercial fields (unified from references)
  collection: string;
  colors: string;
  cost_price: number;
  sale_price: number;
  barcode: string;
  has_straps: boolean;
  strap_colors: any[];
  image_url: string;
  // Color lookup fields
  cor_predominante_id: string | null;
  cor_palmilha_id: string | null;
  cor_tiras_id: string | null;
  cor_solado_id: string | null;
  box_type_id: string | null;
  acabamento_tiras: string;
  material_solado_tipo: string;
  obs_harmonizacao: string;
  status_ficha: string;
  qtd_prevista: number;
  data_ultima_revisao: string;
  responsavel_revisao: string;
  // Technical fields
  last_name: string;
  last_code: string;
  last_notes: string;
  last_exclusive: boolean;
  upper_material: string;
  upper_thickness: string;
  upper_finish: string;
  lining_material: string;
  lining_weight: string;
  insole_material: string;
  insole_thickness: string;
  sole_type: string;
  sole_group_id: string | null;
  sole_material: string;
  sole_code: string;
  sole_color: string;
  insole_color: string;
  insole_plate_product: string;
  sole_process: string;
  heel_height: string;
  heel_type: string;
  heel_base: string;
  heel_material: string;
  fit_type: string;
  measurements: Record<string, any>;
  tolerances: Record<string, any>;
  assembly_instructions: string;
  assembly_steps: any[];
  cola_type: string;
  cola_cure_time: string;
  stitch_spec: string;
  machine_settings: Record<string, any>;
  packaging_box_dimensions: string;
  packaging_tissue: string;
  packaging_notes: string;
  label_info: Record<string, any>;
  palletization: Record<string, any>;
  storage_instructions: string;
  legal_composition: string;
  country_origin: string;
  care_instructions: string;
  certifications: string;
  quality_tests: any[];
  acceptance_criteria: string;
  sampling_plan: string;
  version_number: string;
  responsible_person: string;
  approvals: Record<string, any>;
  change_log: any[];
  commercial_description: string;
  keywords: string;
  suggested_price: number;
  images: any[];
  color_images: any[];
  consumption_loss_pct: number;
  safety_margin_pct: number;
  components_accessories: any[];
  upper_consumption: number;
  lining_consumption: number;
  lining_accessories: any[];
  insole_consumption: number;
  sole_consumption: number;
  direct_components: any[];
  default_silk_url: string;
  lining_consumption_per_size: Record<string, number>;
  insole_consumption_per_size: Record<string, number>;
  upper_consumption_per_size: Record<string, number>;
  // Construction & routing complexity
  construction_type: 'corte_fio' | 'corte_costura' | 'tiras' | 'misto';
  requires_cutting: boolean;
  requires_cutting_cabedal: boolean;
  requires_sewing: boolean;
  corte_a_faca: boolean;
  has_colored_lining: boolean;
  colored_lining_mode: 'standard' | 'follows_variant' | 'manual_mapping';
  insole_color_mode: 'single' | 'follows_lining' | 'restricted_palette' | 'free';
  max_insole_colors: number;
   sole_drives_consumption: boolean;
   custom_overhead?: number | null;
   /** Whether insole (palmilha) has a lining (forração). true = follows cabedal color; false = use palmilha color mapping. */
   insole_has_lining: boolean;
   /** Palmilha comes ready-made in the correct color — no cutting or lining needed. */
   insole_ready_made: boolean;
   /** Daily production capacity at the Mesa sector (pairs/day). Required for tiras model. */
   mesa_daily_capacity: number;
   /** Minutes per pair to handle strap material after artisanal OS delivery (receiving, checking, separating). Only when has_straps = true. */
   handling_time_minutes: number;
};

export const emptySheetForm: SheetFormData = {
  name: '', brand: '', model: '', description: '', shoe_category: '', sizes: '33-41', status: 'Ativo',
  code: '', gender: '',
  collection: '', colors: '', cost_price: 0, sale_price: 0, barcode: '', has_straps: false, strap_colors: [], image_url: '', handling_time_minutes: 0,
  cor_predominante_id: null, cor_palmilha_id: null, cor_tiras_id: null, cor_solado_id: null, box_type_id: null,
  acabamento_tiras: '', material_solado_tipo: '', obs_harmonizacao: '', status_ficha: 'rascunho',
  qtd_prevista: 0, data_ultima_revisao: '', responsavel_revisao: '',
  last_name: '', last_code: '', last_notes: '', last_exclusive: false,
  upper_material: '', upper_thickness: '', upper_finish: '',
  lining_material: '', lining_weight: '',
  insole_material: '', insole_thickness: '',
  sole_type: '', sole_material: '', sole_code: '', sole_color: '', sole_process: '', sole_group_id: null, insole_color: '', insole_plate_product: '',
  heel_height: '', heel_type: '', heel_base: '', heel_material: '',
  fit_type: 'normal',
  measurements: {}, tolerances: {},
  assembly_instructions: '', assembly_steps: [],
  cola_type: '', cola_cure_time: '', stitch_spec: '', machine_settings: {},
  packaging_box_dimensions: '', packaging_tissue: '', packaging_notes: '',
  label_info: {}, palletization: {}, storage_instructions: '',
  legal_composition: '', country_origin: '', care_instructions: '', certifications: '',
  quality_tests: [], acceptance_criteria: '', sampling_plan: '',
  version_number: 'v1', responsible_person: '', approvals: {}, change_log: [],
  commercial_description: '', keywords: '', suggested_price: 0,
  images: [], color_images: [], consumption_loss_pct: 8, safety_margin_pct: 5, components_accessories: [],
  upper_consumption: 0, lining_consumption: 0, lining_accessories: [], insole_consumption: 0, sole_consumption: 0,
  direct_components: [],
  default_silk_url: '',
  lining_consumption_per_size: {},
  insole_consumption_per_size: {},
  upper_consumption_per_size: {},
  construction_type: 'corte_costura',
  requires_cutting: true,
  requires_cutting_cabedal: true,
  requires_sewing: true,
  corte_a_faca: false,
  has_colored_lining: false,
  colored_lining_mode: 'standard',
  insole_color_mode: 'free',
  max_insole_colors: 3,
   sole_drives_consumption: false,
   custom_overhead: null,
   insole_has_lining: true,
   insole_ready_made: false,
   mesa_daily_capacity: 0,
};

export type SheetMaterialFormData = {
  product_id: string;
  group_id?: string | null;
  quantity_per_unit: number;
  consumption_per_size?: Record<string, number>;
  color: string;
  width: string;
  weight: string;
  supplier: string;
  notes: string;
  sizes: string;
};

export function useTechnicalSheets() {
  return useQuery({
    queryKey: ['technical_sheets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

export function useSheetMaterials(sheetId: string | null) {
  return useQuery({
    queryKey: ['sheet_materials', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sheet_materials')
        .select('*, products(name, unit, sku, category, unit_price, quantity, group_id, color), product_groups(id, name)')
        .eq('sheet_id', sheetId!);
      if (error) throw error;
      return data;
    },
  });
}

import { sanitizeUuidFields } from '@/lib/utils';


export function useAddSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: Partial<SheetFormData>) => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .insert(sanitizeUuidFields(form as any) as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['technical_sheets'] }); toast.success('Ficha técnica criada!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SheetFormData> }) => {
      const { error } = await supabase
        .from('technical_sheets')
        .update(sanitizeUuidFields(data as any) as any)
        .eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: async (sheetId) => {
      qc.invalidateQueries({ queryKey: ['technical_sheets'] });
      toast.success('Ficha técnica atualizada!');
      await runResyncAndInvalidate(qc, sheetId);
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const [{ count: matCount, error: matErr }, { count: ordCount, error: ordErr }, { count: soiCount, error: soiErr }] = await Promise.all([
        supabase.from('sheet_materials').select('id', { count: 'exact', head: true }).eq('sheet_id', id),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('technical_sheet_id', id),
        supabase.from('sale_order_items').select('id', { count: 'exact', head: true }).eq('technical_sheet_id', id),
      ]);
      if (matErr) throw matErr;
      if (ordErr) throw ordErr;
      if (soiErr) throw soiErr;
      if ((matCount ?? 0) > 0) throw new Error(`Ficha tem ${matCount} material(is) vinculado(s) — esvazie a ficha antes de excluir.`);
      if ((ordCount ?? 0) > 0) throw new Error(`Ficha está vinculada a ${ordCount} OP(s) — não é possível excluir.`);
      if ((soiCount ?? 0) > 0) throw new Error(`Ficha está vinculada a ${soiCount} item(ns) de pedido — não é possível excluir.`);
      const { error } = await supabase
        .from('technical_sheets')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['technical_sheets'] }); toast.success('Ficha técnica excluída!'); },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useAddSheetMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sheetId, data }: { sheetId: string; data: SheetMaterialFormData }) => {
      const { error } = await supabase
        .from('sheet_materials')
        .insert({ sheet_id: sheetId, ...data });
      if (error) throw error;
    },
    onSuccess: async (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['sheet_materials', variables.sheetId] });
      toast.success('Material adicionado!');
      await runResyncAndInvalidate(qc, variables.sheetId);
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useBulkAddSheetMaterials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sheetId, materials }: { sheetId: string; materials: SheetMaterialFormData[] }) => {
      const rows = materials.map(m => ({ sheet_id: sheetId, ...m }));
      const { error } = await supabase.from('sheet_materials').insert(rows);
      if (error) throw error;
    },
    onSuccess: async (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['sheet_materials', variables.sheetId] });
      toast.success(`${variables.materials.length} materiais adicionados!`);
      await runResyncAndInvalidate(qc, variables.sheetId);
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateSheetMaterial(sheetId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SheetMaterialFormData> }) => {
      const { error } = await supabase
        .from('sheet_materials')
        .update(data)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['sheet_materials', sheetId] });
      toast.success('Material atualizado!');
      if (sheetId) await runResyncAndInvalidate(qc, sheetId);
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteSheetMaterial(sheetId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('sheet_materials')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['sheet_materials', sheetId] });
      toast.success('Material removido!');
      if (sheetId) await runResyncAndInvalidate(qc, sheetId);
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useCloneSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sourceId, newName }: { sourceId: string; newName: string }) => {
      const { data: source, error: srcErr } = await supabase
        .from('technical_sheets')
        .select('*')
        .eq('id', sourceId)
        .single();
      if (srcErr || !source) throw new Error(srcErr?.message || 'Ficha não encontrada');

      const { id: _id, created_at: _ca, updated_at: _ua, ...fields } = source as any;
      const { data: newSheet, error: insertErr } = await supabase
        .from('technical_sheets')
        .insert({ ...fields, name: newName, status_ficha: 'rascunho' } as any)
        .select('id')
        .single();
      if (insertErr || !newSheet) throw new Error(insertErr?.message || 'Erro ao criar ficha');
      const newId = (newSheet as any).id as string;

      // Helper: rollback the new sheet if any side-effect fails, so we don't leave
      // a half-cloned ficha técnica behind.
      const rollback = async (cause: string): Promise<never> => {
        try { await supabase.from('technical_sheets').delete().eq('id', newId); } catch { /* best-effort */ }
        throw new Error(cause);
      };

      const { data: materials, error: matReadErr } = await supabase
        .from('sheet_materials')
        .select('*')
        .eq('sheet_id', sourceId);
      if (matReadErr) await rollback(`Falha ao ler materiais da ficha origem: ${matReadErr.message}`);
      if (materials && materials.length > 0) {
        const rows = materials.map(({ id: _i, created_at: _c, ...m }: any) => ({ ...m, sheet_id: newId }));
        const { error: matInsErr } = await supabase.from('sheet_materials').insert(rows as any);
        if (matInsErr) await rollback(`Falha ao copiar materiais: ${matInsErr.message}`);
      }

      const { data: pkgs, error: pkgReadErr } = await supabase
        .from('packaging_configs')
        .select('*')
        .eq('sheet_id', sourceId);
      if (pkgReadErr) await rollback(`Falha ao ler embalagens: ${pkgReadErr.message}`);
      if (pkgs && pkgs.length > 0) {
        const rows = pkgs.map(({ id: _i, created_at: _c, updated_at: _u, ...p }: any) => ({ ...p, sheet_id: newId }));
        const { error: pkgInsErr } = await supabase.from('packaging_configs').insert(rows as any);
        if (pkgInsErr) await rollback(`Falha ao copiar embalagens: ${pkgInsErr.message}`);
      }

      const { data: soleMaps, error: soleReadErr } = await (supabase as any)
        .from('technical_sheet_sole_colors')
        .select('*')
        .eq('sheet_id', sourceId);
      if (soleReadErr) await rollback(`Falha ao ler mapeamento de cores de solado: ${soleReadErr.message}`);
      if (soleMaps && soleMaps.length > 0) {
        const rows = soleMaps.map(({ id: _i, created_at: _c, ...s }: any) => ({ ...s, sheet_id: newId }));
        const { error: soleInsErr } = await (supabase as any).from('technical_sheet_sole_colors').insert(rows);
        if (soleInsErr) await rollback(`Falha ao copiar cores de solado: ${soleInsErr.message}`);
      }

      const { data: insoleMaps, error: insoleReadErr } = await (supabase as any)
        .from('technical_sheet_insole_colors')
        .select('*')
        .eq('sheet_id', sourceId);
      if (insoleReadErr) await rollback(`Falha ao ler mapeamento de cores de palmilha: ${insoleReadErr.message}`);
      if (insoleMaps && insoleMaps.length > 0) {
        const rows = insoleMaps.map(({ id: _i, created_at: _c, ...ins }: any) => ({ ...ins, sheet_id: newId }));
        const { error: insoleInsErr } = await (supabase as any).from('technical_sheet_insole_colors').insert(rows);
        if (insoleInsErr) await rollback(`Falha ao copiar cores de palmilha: ${insoleInsErr.message}`);
      }

      return newId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technical_sheets'] });
      toast.success('Ficha copiada com sucesso!');
    },
    onError: (err: Error) => toast.error(`Erro ao copiar ficha: ${err.message}`),
  });
}
