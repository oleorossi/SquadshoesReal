import { useQuery, useMutation, useQueryClient, UseQueryResult, QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { resyncOPsForSheet } from '@/lib/resyncOPs';
import { ensureTechnicalStrapLineIds } from '@/lib/technicalStrapLines';

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
      toast.success(`${result.totalResyncedOPs} ${result.totalResyncedOPs === 1 ? 'OP resincronizada' : 'OPs resincronizadas'} automaticamente!`);
    }
    // Re-reserva de material: avisa SÓ quando houve mudança real, pra o operador
    // saber que o estoque reservado das OPs abertas foi reeditado junto com a
    // ficha (era o furo do PV-00145 — componente novo nunca reservado, e por
    // isso nunca debitado na finalização).
    const r = result.reservations;
    if (r && (r.inseridas > 0 || r.atualizadas > 0 || r.canceladas > 0)) {
      const partes = [
        r.inseridas > 0 ? `${r.inseridas} reservada(s)` : null,
        r.atualizadas > 0 ? `${r.atualizadas} ajustada(s)` : null,
        r.canceladas > 0 ? `${r.canceladas} cancelada(s)` : null,
      ].filter(Boolean);
      toast.success(`Material das OPs abertas reeditado: ${partes.join(' · ')}`);
    }
    if (result.errors.length > 0) {
      toast.warning(`${result.errors.length} ${result.errors.length === 1 ? 'erro' : 'erros'} no resync`, {
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
  // (Removido em 2026-05: campo `gender` era dead — coluna existia no DB
  // mas sem uso em business logic. Migration drop_gender_column elimina.)
  // Commercial fields (unified from references)
  collection: string;
  sale_price: number;
  has_straps: boolean;
  strap_colors: any[];
  // (Removidos em 2026-05 — dead fields auditados, sem uso em business logic:
  //   colors, cost_price, suggested_price, image_url, barcode (do sheet — barcode
  //   vive em material_variants), assembly_steps, cor_palmilha_id, cor_tiras_id.
  //   Migration drop_dead_technical_sheets_fields elimina do banco.)
  // Color lookup fields ainda usados (cor_predominante_id e cor_solado_id
  // são lidos por ReadyStockPanel + getClientLogo).
  cor_predominante_id: string | null;
  cor_solado_id: string | null;
  box_type_id: string | null;
  status_ficha: string;
  // Technical fields
  upper_material: string;
  /** Pin do SKU exato do Cabedal Material 1 (2026-06-28). Precedência no débito:
   *  variante > este pin > grupo+cor. null = resolve pela cor do PV. */
  upper_material_product_id?: string | null;
  upper_thickness: string;
  /** Corte a fio (2026-06-12): true = cabedal sem costura (borda crua do
   *  corte) — NÃO gera ficha de operador 'Costura Cabedal'; false = cabedal
   *  vai para costura. Só camada de impressão — não afeta fluxo/ondas. */
  upper_corte_a_fio: boolean;
  lining_material: string;
  /** Pin do SKU exato da Forração Material 1 (2026-06-28). Mesma precedência. */
  lining_material_product_id?: string | null;
  /** Grupo de material da forração de salto (fachete) — usado quando o solado
   *  é fachetado. Consumo por numeração vem do cadastro do solado. Segue o
   *  mesmo padrão de lining_material (nome do grupo, coluna text no DB). */
  fachete_material: string;
  insole_material: string;
  sole_type: string;
  sole_group_id: string | null;
  primary_sole_id?: string | null;
  sole_material: string;
  sole_color: string;
  insole_color: string;
  insole_plate_product: string;
  sole_process: string;
  heel_height: string;
  fit_type: string;
  version_number: string;
  images: any[];
  color_images: any[];
  safety_margin_pct: number;
  components_accessories: any[];
  upper_consumption: number;
  lining_consumption: number;
  lining_accessories: any[];
  insole_consumption: number;
  sole_consumption: number;
  direct_components: any[];
  /** Opt-in: quando true, os componentes vêm de technical_sheet_component_colors
   *  (por cor predominante) em vez de direct_components. Poucos modelos usam. */
  component_colors_enabled: boolean;
  default_silk_url: string;
  lining_consumption_per_size: Record<string, number>;
  insole_consumption_per_size: Record<string, number>;
  // Forração da palmilha (napa do forro que cobre a placa) — área própria por número, vinda do solado
  insole_lining_consumption: number;
  insole_lining_consumption_per_size: Record<string, number>;
  upper_consumption_per_size: Record<string, number>;
  // Construction & routing complexity
  construction_type: 'corte_fio' | 'corte_costura' | 'tiras' | 'misto';
  requires_cutting: boolean;
  requires_cutting_cabedal: boolean;
  requires_sewing: boolean;
  has_colored_lining: boolean;
  colored_lining_mode: 'standard' | 'follows_variant' | 'manual_mapping';
  insole_color_mode: 'single' | 'follows_lining' | 'restricted_palette' | 'free';
  max_insole_colors: number;
   sole_drives_consumption: boolean;
   /** Quais componentes seguem o MATERIAL PRINCIPAL da variante do item do PV
    *  (mig 20261027120000). Desligado = o componente usa sempre o material
    *  cadastrado na ficha — é o que protege material de identidade (ex.: a PALHA
    *  do cabedal do DS21/DS19).
    *  Não existe equivalente pra PALMILHA de propósito: aquele slot aponta a
    *  PLACA (EVA) e o material principal é sempre napa, então a cascata seria
    *  erro de categoria — a flag foi removida na mig 20261027120800. Variante que
    *  usa outra placa continua usando `insole_material_group_id`. */
   variant_drives_upper: boolean;
   variant_drives_lining: boolean;
   variant_drives_fachete: boolean;
   custom_overhead?: number | null;
   /** Whether insole (palmilha) has a lining (forração). true = follows cabedal color; false = use palmilha color mapping. */
   insole_has_lining: boolean;
   /** Palmilha comes ready-made in the correct color — no cutting or lining needed. */
   insole_ready_made: boolean;
   /** Daily production capacity at the Mesa sector (pairs/day). Required for tiras model. */
   mesa_daily_capacity: number;
   /** Peso do par do produto acabado em kg. Usado em NF-e, romaneio, MDF-e e rota. */
   weight_per_pair_kg: number | null;
   /** Peso da caixinha individual de 1 par em kg. Soma ao peso bruto. */
   box_weight_kg: number | null;
   /** NCM (Nomenclatura Comum do Mercosul) — 8 dígitos, obrigatório pra NF-e.
    *  Adicionado ao type em 20/05/2026 — antes faltava aqui, então o
    *  hidratador do form não copiava sheet.ncm → form.ncm (campo aparecia
    *  vazio ao reabrir a ficha mesmo com NCM gravado no DB). */
   ncm?: string | null;
   /** Mapeamento de facas de Corte Cabedal por ref (22/05/2026). Cada bucket
    *  agrega numerações (ex: P=[34,35,36], M=[37,38], G=[39,40]). Usado APENAS
    *  no setor Corte Cabedal pra somar quantidades por faca em vez de mostrar
    *  número-a-número. NULL = sem cadastro, ficha mostra sizes individuais.
    *  `code` (2026-06-12) = código físico da faca — opcional e retrocompatível
    *  (JSONB livre, ranges antigos sem o campo seguem válidos; sem migration). */
   knife_size_ranges?: Array<{ label: string; sizes: string[]; code?: string }> | null;
   /** Faixas P/M/G PRÓPRIAS do setor de Aviamento (segmento independente das
    *  facas de Corte Cabedal). Agrega numerações por faixa na ficha de operador
    *  de Aviamento. NULL = herda padrão global aviamento_pmg_default; [] = sem
    *  faixa (numeração individual); [{label,sizes[]}] = faixas próprias da ref. */
  aviamento_size_ranges?: Array<{ label: string; sizes: string[] }> | null;
  /** Setor de consumo de cada componente técnico da ficha. */
  component_consumption_sectors?: Record<string, string>;
};

export const emptySheetForm: SheetFormData = {
  name: '', brand: '', model: '', description: '', shoe_category: '', sizes: '33-41', status: 'Ativo',
  code: '',
  collection: '', sale_price: 0, has_straps: false, strap_colors: [],
  cor_predominante_id: null, cor_solado_id: null, box_type_id: null,
  status_ficha: 'rascunho',
  upper_material: '', upper_material_product_id: null, upper_thickness: '',
  upper_corte_a_fio: false,
  lining_material: '', lining_material_product_id: null,
  fachete_material: '',
  insole_material: '',
  sole_type: '', sole_material: '', sole_color: '', sole_process: '', sole_group_id: null, primary_sole_id: null, insole_color: '', insole_plate_product: '',
  heel_height: '',
  fit_type: 'normal',
  version_number: 'v1',
  images: [], color_images: [], safety_margin_pct: 5, components_accessories: [], component_colors_enabled: false,
  upper_consumption: 0, lining_consumption: 0, lining_accessories: [], insole_consumption: 0, sole_consumption: 0,
  direct_components: [],
  default_silk_url: '',
  lining_consumption_per_size: {},
  insole_consumption_per_size: {},
  insole_lining_consumption: 0,
  insole_lining_consumption_per_size: {},
  upper_consumption_per_size: {},
  construction_type: 'corte_costura',
  requires_cutting: true,
  requires_cutting_cabedal: true,
  requires_sewing: true,
  has_colored_lining: false,
  colored_lining_mode: 'standard',
  insole_color_mode: 'free',
  max_insole_colors: 3,
   sole_drives_consumption: true,
   variant_drives_upper: false,
   variant_drives_lining: false,
   variant_drives_fachete: false,
   custom_overhead: null,
   insole_has_lining: true,
   insole_ready_made: false,
   mesa_daily_capacity: 0,
   weight_per_pair_kg: null,
   box_weight_kg: null,
   ncm: null,
   knife_size_ranges: null,
  aviamento_size_ranges: null,
  component_consumption_sectors: {
    fibra: 'Corte Fibra',
    forracao_palmilha: 'Corte Forração',
    cabedal: 'Corte Cabedal',
    solado: 'Solagem',
  },
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
  /** Setor físico que recebe e consome este item no início da operação. */
  consumption_sector: string;
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

/** Colunas que a lista de PV realmente lê das fichas. Auditadas em SaleOrders.tsx
 *  (busca por sku, refById, segmento Adulto/Infantil, rótulo do item). */
export const TECHNICAL_SHEET_LITE_COLUMNS = 'id, code, name, shoe_category';

/**
 * Versão enxuta de `useTechnicalSheets` para telas que só precisam identificar a
 * ficha (código, nome, segmento) — não a ficha inteira.
 *
 * Por que existe (auditoria PV 07/08/2026): o hook canônico faz `select('*')` e,
 * com 53 fichas, isso são ~227 kB de JSON para entregar ~6 kB de dados usados —
 * a MAIOR consulta da tela /sales, maior que a própria lista de PVs. O peso está
 * em colunas que a lista nunca abre (strap_colors 27 kB, production_sectors 7,4 kB,
 * direct_components 5,8 kB, size_multipliers 5 kB, images 3,6 kB).
 *
 * ⚠ NÃO estreite o `useTechnicalSheets` original: TechnicalSheets.tsx e o
 * SaleOrderForm leem muito mais colunas.
 *
 * ⚠ Ao passar a ler uma coluna nova no consumidor, ela TEM que entrar em
 * `TECHNICAL_SHEET_LITE_COLUMNS` — o TS é loose (`strict:false`), então uma coluna
 * ausente vira `undefined` silencioso em runtime, não erro de compilação. Mesma
 * armadilha já documentada em TECHNICAL_SHEET_CONSUMPTION_COLUMNS.
 *
 * A sub-key ['technical_sheets','lite'] é invalidada de graça por todo
 * `invalidateQueries({ queryKey: ['technical_sheets'] })` do projeto — o match do
 * React Query é por prefixo.
 */
export function useTechnicalSheetsLite() {
  return useQuery({
    queryKey: ['technical_sheets', 'lite'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select(TECHNICAL_SHEET_LITE_COLUMNS)
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
        .select('*, products(name, unit, sku, ncm, category, unit_price, quantity, group_id, color), product_groups(id, name)')
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
      // Defesa: code duplicado entre fichas com NOMES DIFERENTES quebra o
      // dropdown do PV (dedup mantém só uma). Avisa o usuário, mas não bloqueia
      // (pode ser intencional em versionamento da mesma ref).
      const code = (form as any).code?.toString().trim();
      const name = (form as any).name?.toString().trim();
      if (code) {
        const { data: existing } = await supabase
          .from('technical_sheets')
          .select('id, name, code')
          .ilike('code', code);
        const dup = (existing || []).find(
          (s: any) => (s.name?.trim().toLowerCase() || '') !== (name?.toLowerCase() || '')
        );
        if (dup) {
          toast.warning(
            `⚠ Código "${code}" já é usado pela ficha "${dup.name}". Ambas vão aparecer no PV (fix 2026-05-12), mas considere usar códigos únicos.`,
            { duration: 8000 },
          );
        }
      }
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
      const payload = sanitizeUuidFields(data as any);
      // .select('id') retorna as linhas afetadas. Se RLS bloquear silently
      // (admin do client sem role admin no DB), data fica []. Antes esse caso
      // passava por "sucesso" e o user via toast verde sem nada ter sido salvo.
      const { data: updated, error } = await (supabase as any)
        .from('technical_sheets')
        .update(payload)
        .eq('id', id)
        .select('id');
      if (error) {
        console.error('[useUpdateSheet] erro Supabase:', { id, payload, error });
        throw error;
      }
      if (!updated || updated.length === 0) {
        console.error('[useUpdateSheet] 0 rows affected — possível RLS bloqueando:', { id, payload });
        throw new Error(
          'Atualização não persistiu. Verifique permissões (admin/gerente) ou se a ficha foi excluída em outra aba.'
        );
      }
      return id;
    },
    onSuccess: async (sheetId) => {
      qc.invalidateQueries({ queryKey: ['technical_sheets'] });
      toast.success('Ficha técnica atualizada!');
      await runResyncAndInvalidate(qc, sheetId);
    },
    onError: (err: Error) => {
      console.error('[useUpdateSheet] mutationFn falhou:', err);
      toast.error(`Falha ao salvar: ${err.message}`, { duration: 8000 });
    },
  });
}

export function useDeleteSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const [{ count: matCount, error: matErr }, { count: ordCount, error: ordErr }, { count: soiCount, error: soiErr }] = await Promise.all([
        supabase.from('sheet_materials').select('id', { count: 'exact', head: true }).eq('sheet_id', id),
        // FK real é reference_id → technical_sheets (a coluna technical_sheet_id
        // nunca existiu — o guard quebrava com 400 e a exclusão nunca validava OPs/itens).
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('reference_id', id),
        supabase.from('sale_order_items').select('id', { count: 'exact', head: true }).eq('reference_id', id),
      ]);
      if (matErr) throw matErr;
      if (ordErr) throw ordErr;
      if (soiErr) throw soiErr;
      if ((matCount ?? 0) > 0) throw new Error(`Ficha tem ${matCount} ${matCount === 1 ? 'material vinculado' : 'materiais vinculados'} — esvazie a ficha antes de excluir.`);
      if ((ordCount ?? 0) > 0) throw new Error(`Ficha está vinculada a ${ordCount} ${ordCount === 1 ? 'OP' : 'OPs'} — não é possível excluir.`);
      if ((soiCount ?? 0) > 0) throw new Error(`Ficha está vinculada a ${soiCount} ${soiCount === 1 ? 'item' : 'itens'} de pedido — não é possível excluir.`);
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

      // `search_norm` é coluna GERADA (GENERATED ALWAYS … STORED, migration
      // 20260613120000) — o banco recusa INSERT com valor nela ("cannot insert
      // a non-DEFAULT value into column search_norm"). Como copiamos via
      // select('*') + spread, precisa ser descartada explicitamente junto de
      // id/created_at/updated_at.
      const { id: _id, created_at: _ca, updated_at: _ua, search_norm: _sn, ...fields } = source as any;
      const { data: newSheet, error: insertErr } = await supabase
        .from('technical_sheets')
        .insert({ ...fields, name: newName, status_ficha: 'rascunho' } as any)
        .select('id')
        .single();
      if (insertErr || !newSheet) throw new Error(insertErr?.message || 'Erro ao criar ficha');
      const newId = (newSheet as any).id as string;

      // Trigger sync_construction_routing roda no INSERT e sobrescreve
      // has_straps/strap_colors baseado em construction_type. Se a ficha
      // original tinha has_straps=true mas construction_type='corte_costura'
      // (modelo com tiras opcionais), o trigger zera as tiras no clone.
      // Re-aplica esses campos via UPDATE depois pra preservar a config real.
      if (fields.has_straps || (fields.strap_colors && fields.strap_colors.length > 0)) {
        const clonedStrapColors = ensureTechnicalStrapLineIds(fields.strap_colors, true);
        await supabase
          .from('technical_sheets')
          .update({
            has_straps: fields.has_straps,
            strap_colors: clonedStrapColors,
          } as any)
          .eq('id', newId);
      }

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
