import { useQuery, useMutation, useQueryClient, UseQueryResult, QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ensureTechnicalStrapLineIds } from '@/lib/technicalStrapLines';
import { replaceTechnicalSheetCacheRow } from '@/lib/technicalSheetPatch';
import { invalidateProductionCaches } from '@/hooks/useProductionTransitions';

/**
 * Alterar uma ficha invalida o plano/snapshot por trigger do banco, mas NUNCA
 * reescreve uma OP automaticamente. O operador revisa o impacto e, se a
 * correção realmente deve valer, executa o resync administrativo transacional.
 */
function invalidateSheetAudit(qc: QueryClient) {
  // A auditoria industrial alimenta os badges do catálogo e a régua da
  // própria referência. Sem invalidar essas chaves, a pendência continuava
  // visível por até um minuto depois de o usuário corrigi-la na ficha.
  qc.invalidateQueries({ queryKey: ['sheets_audit'] });
  qc.invalidateQueries({ queryKey: ['sheets_audit_summary'] });
  qc.invalidateQueries({ queryKey: ['technical_sheet_audit'] });
}

function invalidateSheetImpact(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['sale_orders'] });
  qc.invalidateQueries({ queryKey: ['pv_outdated_status'] });
  qc.invalidateQueries({ queryKey: ['sale-order-command-preflight'] });
  qc.invalidateQueries({ queryKey: ['system-diag', 'pv-system'] });
  invalidateSheetAudit(qc);
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
  /** Grupo-folha canônico do Cabedal Material 1. O nome continua salvo em
   *  upper_material por compatibilidade com os motores legados, mas o UUID
   *  evita perder o vínculo quando o grupo é renomeado. */
  upper_material_group_id?: string | null;
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
  upper_material: '', upper_material_group_id: null, upper_material_product_id: null, upper_thickness: '',
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
export const TECHNICAL_SHEET_LITE_COLUMNS = 'id, code, name, shoe_category, retired_at';

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


/**
 * Nome de ficha JÁ EM USO por outra ficha, ou null. É a trave de identidade
 * pedida pelo dono em 20/08/2026: "não permitir cadastrar a mesma referência
 * que já tem no sistema".
 *
 * ⚠ A identidade da ficha é o `name`, NÃO o `code`. O campo de código é
 * rotulado "Código interno / SKU (opcional)" na própria tela e é reusado de
 * propósito entre fichas diferentes — medido em 20/08/2026: BT01/BT02 dividem
 * o code 'BT01', I100/I90/I91 dividem 'I90I', NL01/NL02 dividem 'NL02' e
 * CF 07/CF 09 dividem 'CONFORTO'. Travar por código quebraria esses 11
 * cadastros legítimos; travar por nome não quebra nenhum, porque `name` é
 * único na base inteira (o único par repetido era SP130, uma duplicata
 * acidental criada em 20/08 — foi ela que originou este pedido: a foto foi
 * parar na cópia e a ficha em uso ficou sem imagem).
 *
 * Nome vazio não é travado: quem decide se ficha sem nome pode existir é outro
 * lugar, e bloquear aqui impediria salvar as fichas legadas sem nome.
 * Ficha aposentada também não reserva o nome operacional: o histórico segue
 * ligado ao UUID antigo, enquanto uma ficha corrigida pode reutilizar o nome.
 */
type SheetNameRow = {
  id: string;
  name: string | null;
  code: string | null;
  retired_at: string | null;
};

type TechnicalSheetCacheRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  shoe_category?: string | null;
  [key: string]: unknown;
};

export async function findSheetNameCollision(
  name: string,
  ignoreId?: string,
): Promise<SheetNameRow | null> {
  const alvo = (name || '').trim();
  if (!alvo) return null;
  const { data, error } = await supabase
    .from('technical_sheets')
    .select('id, name, code, retired_at')
    .is('retired_at', null)
    .ilike('name', alvo);
  // Erro de leitura NÃO bloqueia o cadastro: a trave é uma conveniência, e
  // derrubar o save por causa de um SELECT que falhou seria pior que o
  // duplicado que ela evita.
  if (error) {
    console.warn('[findSheetNameCollision] checagem falhou, seguindo sem travar:', error);
    return null;
  }
  const rows = (data || []) as unknown as SheetNameRow[];
  return rows.find(sheet =>
    sheet.id !== ignoreId
    && !sheet.retired_at
    && (sheet.name || '').trim().toLowerCase() === alvo.toLowerCase()
  ) ?? null;
}

type TechnicalSheetCloneCompletionState = {
  clone_completed_request_id?: string | null;
  clone_cleanup_request_id?: string | null;
};

export function isTechnicalSheetCloneCompletionConfirmed(
  state: TechnicalSheetCloneCompletionState | null | undefined,
  requestId: string,
): boolean {
  return !!state
    && state.clone_completed_request_id === requestId
    && state.clone_cleanup_request_id == null;
}

export function useAddSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: Partial<SheetFormData>) => {
      // Defesa: code duplicado entre fichas com NOMES DIFERENTES quebra o
      // dropdown do PV (dedup mantém só uma). Avisa o usuário, mas não bloqueia
      // (pode ser intencional em versionamento da mesma ref).
      const code = (form as any).code?.toString().trim();
      const name = (form as any).name?.toString().trim();

      // TRAVA (bloqueia): referência com o mesmo nome já existe.
      const nameCollision = await findSheetNameCollision(name);
      if (nameCollision) {
        throw new Error(
          `A referência "${nameCollision.name}" já existe no sistema`
          + `${nameCollision.code ? ` (código ${nameCollision.code})` : ''}.`
          + ' Abra a ficha existente em vez de criar outra, ou use um nome diferente.'
        );
      }

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technical_sheets'] });
      invalidateSheetAudit(qc);
      toast.success('Ficha técnica criada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SheetFormData> }) => {
      // Mesma trave do cadastro: renomear uma ficha PARA um nome já usado cria
      // a duplicata pela porta dos fundos. Só checa quando o nome vem no
      // payload — salvamento parcial de outros campos não paga o SELECT.
      if (Object.prototype.hasOwnProperty.call(data, 'name')) {
        const renameCollision = await findSheetNameCollision(data.name ?? '', id);
        if (renameCollision) {
          throw new Error(
            `A referência "${renameCollision.name}" já existe no sistema`
            + `${renameCollision.code ? ` (código ${renameCollision.code})` : ''}.`
            + ' Escolha outro nome.'
          );
        }
      }
      const payload = sanitizeUuidFields(data as any);
      // .select('*') retorna a linha final para atualizar só esse item no cache.
      // Se RLS bloquear silently (admin do client sem role admin no DB), data
      // fica []. Antes esse caso passava por "sucesso" e o user via toast verde
      // sem nada ter sido salvo.
      const { data: updated, error } = await (supabase as any)
        .from('technical_sheets')
        .update(payload)
        .eq('id', id)
        .select('*');
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
      return updated[0];
    },
    onSuccess: (updatedSheet) => {
      // O UPDATE já devolve a linha final (incluindo updated_at e efeitos de
      // triggers). Substituí-la no cache evita baixar novamente todas as fichas
      // e seus JSONBs pesados após cada pequena correção.
      qc.setQueryData<TechnicalSheetCacheRow[]>(['technical_sheets'], (cached) => (
        replaceTechnicalSheetCacheRow(cached, updatedSheet)
      ));
      // A lista leve tem chave própria e antes era invalidada por prefixo. Ela
      // também precisa refletir renome/código/categoria sem um refetch global.
      qc.setQueryData<TechnicalSheetCacheRow[]>(['technical_sheets', 'lite'], (cached) => {
        if (!cached) return cached;
        return cached.map((row) => row.id === updatedSheet.id
          ? {
              ...row,
              name: updatedSheet.name,
              code: updatedSheet.code,
              shoe_category: updatedSheet.shoe_category,
            }
          : row);
      });
      qc.invalidateQueries({ queryKey: ['technical_sheets', 'cabedal-par-pe-audit'] });
      invalidateSheetImpact(qc);
      toast.success('Ficha atualizada; OPs existentes foram preservadas e o impacto ficou sinalizado.');
    },
    onError: (err: Error) => {
      console.error('[useUpdateSheet] mutationFn falhou:', err);
      toast.error(`Falha ao salvar: ${err.message}`, { duration: 8000 });
    },
  });
}

export interface TechnicalSheetDeleteLinks {
  orders: number;
  sale_order_items: number;
  technical_sheet_snapshots: number;
  technical_strap_line_identity_map: number;
  production_wave_items: number;
  product_references: number;
  ready_stock: number;
  ready_stock_movements: number;
  reference_materials: number;
  sop_plan_items: number;
  nfe_devolucao_item_claims: number;
}

export interface TechnicalSheetActiveOrderImpact {
  id: string;
  order_number: string;
  status: string;
  quantity: number;
  sale_order_id: string;
  parent_status?: string | null;
  has_terminal_parent?: boolean;
  has_non_reversible_facts: boolean;
}

export interface TechnicalSheetDeleteImpact {
  sheet_id: string;
  sheet_name: string;
  sheet_code: string | null;
  sheet_status: string;
  sheet_publication_status: string;
  updated_at: string;
  mode: 'retire';
  can_hard_delete: false;
  can_retire: boolean;
  active_orders: TechnicalSheetActiveOrderImpact[];
  active_order_count: number;
  blocking_active_order_count: number;
  terminal_parent_active_order_count: number;
  blocking_wave_count: number;
  blocking_strap_demand_count?: number;
  reversible_strap_demand_count?: number;
  blocking_service_order_count?: number;
  reversible_service_order_count?: number;
  active_pairs: number;
  active_sale_item_count: number;
  active_sale_item_pairs: number;
  historical_order_count: number;
  links: TechnicalSheetDeleteLinks;
}

export interface TechnicalSheetDeleteResult {
  ok: boolean;
  mode: 'retire';
  sheet_id: string;
  sheet_name: string;
  sheet_code: string | null;
  cancelled_active_orders: number;
  cancelled_order_ids?: string[];
  cancelled_order_numbers?: string[];
  excluded_sale_order_item_ids?: string[];
  excluded_sale_order_item_count: number;
  excluded_sale_order_item_pairs: number;
  cancelled_strap_demand_count?: number;
  cancelled_service_order_count?: number;
  removed_wave_source_count?: number;
  active_pairs_removed: number;
  historical_orders_preserved: number;
  total_orders_preserved: number;
  links_preserved: TechnicalSheetDeleteLinks;
  alert_id: string | null;
  retired_at?: string;
}

export function useTechnicalSheetDeleteImpact(sheetId: string | null) {
  return useQuery({
    queryKey: ['technical_sheet_delete_impact', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'get_technical_sheet_retirement_impact' as never,
        { p_sheet_id: sheetId } as never,
      );
      if (error) throw error;
      return data as TechnicalSheetDeleteImpact;
    },
    staleTime: 0,
    gcTime: 60 * 1000,
  });
}

export function useDeleteSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      expectedUpdatedAt,
      clientRequestId,
      reason,
    }: {
      id: string;
      expectedUpdatedAt: string;
      clientRequestId: string;
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc(
        'admin_retire_technical_sheet' as never,
        {
          p_sheet_id: id,
          p_expected_updated_at: expectedUpdatedAt,
          p_client_request_id: clientRequestId,
          p_reason: reason,
        } as never,
      );
      if (error) throw error;
      const result = data as TechnicalSheetDeleteResult;
      if (!result?.ok) throw new Error('O servidor não confirmou a exclusão da ficha.');
      return result;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['technical_sheets'] });
      invalidateProductionCaches(qc);
      qc.invalidateQueries({ queryKey: ['production_waves'] });
      qc.invalidateQueries({ queryKey: ['production_alerts_active'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items_all'] });
      qc.invalidateQueries({ queryKey: ['mrp-needs'] });
      qc.invalidateQueries({ queryKey: ['mrp_suggestions'] });
      qc.invalidateQueries({ queryKey: ['materials_per_pv'] });
      qc.invalidateQueries({ queryKey: ['pv-consumption'] });
      qc.invalidateQueries({ queryKey: ['consumption-source'] });
      qc.invalidateQueries({ queryKey: ['purchase_projection_for_mrp'] });
      qc.invalidateQueries({ queryKey: ['purchase_projection_timeline'] });
      qc.invalidateQueries({ queryKey: ['purchase_projection_timeline_for_agenda'] });
      qc.invalidateQueries({ queryKey: ['sector-period-load'] });
      qc.invalidateQueries({ queryKey: ['capacity_overflow'] });
      qc.invalidateQueries({ queryKey: ['artisanal-strap-demands'] });
      qc.invalidateQueries({ queryKey: ['artisanal-strap-production'] });
      qc.invalidateQueries({ queryKey: ['artisanal-strap-external-operations'] });
      qc.invalidateQueries({ queryKey: ['strap-contractor-operations'] });
      qc.invalidateQueries({ queryKey: ['strap_stock_lines_preview'] });
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      invalidateSheetImpact(qc);

      toast.success(`Ficha ${result.sheet_name} retirada da produção.`, {
        description: `${result.excluded_sale_order_item_count} item(ns) de PV e ${result.excluded_sale_order_item_pairs} pares retirados da produção; ${result.cancelled_active_orders} OP(s) cancelada(s) e ${result.historical_orders_preserved} histórica(s) preservada(s).`,
        duration: 10000,
      });
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`, { duration: 8000 }),
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
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['sheet_materials', variables.sheetId] });
      invalidateSheetImpact(qc);
      toast.success('Material adicionado; OPs existentes não foram alteradas automaticamente.');
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
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['sheet_materials', variables.sheetId] });
      invalidateSheetImpact(qc);
      toast.success(`${variables.materials.length} materiais adicionados; OPs existentes foram preservadas.`);
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheet_materials', sheetId] });
      invalidateSheetImpact(qc);
      toast.success('Material atualizado; OPs existentes não foram alteradas automaticamente.');
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheet_materials', sheetId] });
      invalidateSheetImpact(qc);
      toast.success('Material removido; OPs existentes não foram alteradas automaticamente.');
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
      const cleanupRequestId = crypto.randomUUID();
      const {
        id: _id,
        created_at: _ca,
        updated_at: _ua,
        search_norm: _sn,
        retired_at: _retiredAt,
        retired_by: _retiredBy,
        retirement_reason: _retirementReason,
        retirement_request_id: _retirementRequestId,
        created_by: _createdBy,
        clone_source_id: _cloneSourceId,
        clone_cleanup_request_id: _cloneCleanupRequestId,
        clone_cleanup_started_at: _cloneCleanupStartedAt,
        clone_completed_request_id: _cloneCompletedRequestId,
        clone_completed_at: _cloneCompletedAt,
        ...fields
      } = source as any;
      const { data: newSheet, error: insertErr } = await supabase
        .from('technical_sheets')
        .insert({
          ...fields,
          name: newName,
          status_ficha: 'rascunho',
          clone_source_id: sourceId,
          clone_cleanup_request_id: cleanupRequestId,
        } as any)
        .select('id')
        .single();
      if (insertErr || !newSheet) throw new Error(insertErr?.message || 'Erro ao criar ficha');
      const newId = (newSheet as any).id as string;

      // O DELETE direto continua revogado. A compensacao so aceita o proprio
      // criador, token exato, clone rascunho com menos de 15 minutos e nenhuma
      // FK externa alem das tres configuracoes copiadas abaixo.
      const rollback = async (cause: string): Promise<never> => {
        try {
          const { data, error } = await supabase.rpc(
            'cleanup_failed_technical_sheet_clone' as never,
            {
              p_sheet_id: newId,
              p_cleanup_request_id: cleanupRequestId,
            } as never,
          );
          if (error || !(data as { ok?: boolean } | null)?.ok) {
            const cleanupMessage = error?.message || 'servidor não confirmou a limpeza';
            throw new Error(cleanupMessage);
          }
        } catch (cleanupError) {
          const cleanupMessage = cleanupError instanceof Error
            ? cleanupError.message
            : 'erro desconhecido na limpeza';
          throw new Error(`${cause}. O clone parcial não pôde ser limpo: ${cleanupMessage}`);
        }
        throw new Error(cause);
      };

      try {
        // Trigger sync_construction_routing roda no INSERT e sobrescreve
        // has_straps/strap_colors baseado em construction_type. Reaplica a
        // configuracao com novas identidades tecnicas e confere o retorno.
        if (fields.has_straps || (fields.strap_colors && fields.strap_colors.length > 0)) {
          const clonedStrapColors = ensureTechnicalStrapLineIds(fields.strap_colors, true);
          const { error: strapUpdateError } = await supabase
            .from('technical_sheets')
            .update({
              has_straps: fields.has_straps,
              strap_colors: clonedStrapColors,
            } as any)
            .eq('id', newId);
          if (strapUpdateError) throw new Error(`Falha ao copiar tiras: ${strapUpdateError.message}`);
        }

        const { data: materials, error: matReadErr } = await supabase
          .from('sheet_materials')
          .select('*')
          .eq('sheet_id', sourceId);
        if (matReadErr) throw new Error(`Falha ao ler materiais da ficha origem: ${matReadErr.message}`);
        if (materials && materials.length > 0) {
          const rows = materials.map(({ id: _i, created_at: _c, ...m }: any) => ({ ...m, sheet_id: newId }));
          const { error: matInsErr } = await supabase.from('sheet_materials').insert(rows as any);
          if (matInsErr) throw new Error(`Falha ao copiar materiais: ${matInsErr.message}`);
        }

        const { data: soleMaps, error: soleReadErr } = await (supabase as any)
          .from('technical_sheet_sole_colors')
          .select('*')
          .eq('sheet_id', sourceId);
        if (soleReadErr) throw new Error(`Falha ao ler mapeamento de cores de solado: ${soleReadErr.message}`);
        if (soleMaps && soleMaps.length > 0) {
          const rows = soleMaps.map(({ id: _i, created_at: _c, ...s }: any) => ({ ...s, sheet_id: newId }));
          const { error: soleInsErr } = await (supabase as any).from('technical_sheet_sole_colors').insert(rows);
          if (soleInsErr) throw new Error(`Falha ao copiar cores de solado: ${soleInsErr.message}`);
        }

        const { data: insoleMaps, error: insoleReadErr } = await (supabase as any)
          .from('technical_sheet_insole_colors')
          .select('*')
          .eq('sheet_id', sourceId);
        if (insoleReadErr) throw new Error(`Falha ao ler mapeamento de cores de palmilha: ${insoleReadErr.message}`);
        if (insoleMaps && insoleMaps.length > 0) {
          const rows = insoleMaps.map(({ id: _i, created_at: _c, ...ins }: any) => ({ ...ins, sheet_id: newId }));
          const { error: insoleInsErr } = await (supabase as any).from('technical_sheet_insole_colors').insert(rows);
          if (insoleInsErr) throw new Error(`Falha ao copiar cores de palmilha: ${insoleInsErr.message}`);
        }

        const { data: completed, error: completeError } = await supabase.rpc(
          'complete_technical_sheet_clone' as never,
          {
            p_sheet_id: newId,
            p_cleanup_request_id: cleanupRequestId,
          } as never,
        );
        if (completeError || !(completed as { ok?: boolean } | null)?.ok) {
          // A resposta HTTP pode se perder depois do COMMIT. Antes de executar
          // a compensacao destrutiva, reconcilia o estado gravado pelo mesmo
          // token. Se o servidor concluiu e limpou o token de cleanup, o clone
          // e valido mesmo que a chamada RPC tenha retornado erro/sem payload.
          const { data: completionState, error: completionStateError } = await supabase
            .from('technical_sheets')
            .select('clone_completed_request_id, clone_cleanup_request_id' as never)
            .eq('id', newId)
            .maybeSingle();
          const reconciled = !completionStateError
            && isTechnicalSheetCloneCompletionConfirmed(
              completionState as TechnicalSheetCloneCompletionState | null,
              cleanupRequestId,
            );
          if (!reconciled) {
            throw new Error(completeError?.message || 'Falha ao finalizar a cópia da ficha');
          }
        }

        return newId;
      } catch (error) {
        const cause = error instanceof Error ? error.message : 'Falha desconhecida ao copiar a ficha';
        return rollback(cause);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['technical_sheets'] });
      invalidateSheetAudit(qc);
      toast.success('Ficha copiada com sucesso!');
    },
    onError: (err: Error) => toast.error(`Erro ao copiar ficha: ${err.message}`),
  });
}
