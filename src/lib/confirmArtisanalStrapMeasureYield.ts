import { supabase } from '@/integrations/supabase/client';

export interface ArtisanalStrapMeasureYieldPayload {
  /** Rendimento (m de tira por m de napa) a aplicar em todas as napas do lote. */
  confirmedYieldMPerM: number;
  /** Banda de corte (mm). Omitir/`null` = cada napa mantém a sua. */
  cutBandWidthMm?: number | null;
  /** Napas a alcançar. Omitir = todas as receitas vigentes da medida. */
  baseGroupIds?: string[];
}

export interface ArtisanalStrapMeasureYieldAppliedLine {
  base_group_id: string;
  base_group_name: string;
  previous_recipe_id: string;
  previous_yield_m_per_m: number;
  recipe_id: string;
  cut_band_width_mm: number;
  usable_width_mm: number;
}

export interface ArtisanalStrapMeasureYieldResult {
  measure_id: string;
  confirmed_yield_m_per_m: number;
  cut_band_width_mm: number | null;
  applied_count: number;
  applied: ArtisanalStrapMeasureYieldAppliedLine[];
  color_scope: 'all';
}

interface UntypedQueryResult {
  data: unknown;
  error: unknown;
}

interface UntypedSupabaseClient {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<UntypedQueryResult>;
}

const untypedSupabase = supabase as unknown as UntypedSupabaseClient;

/**
 * Só chaves presentes: a banda omitida deixa cada napa com a largura de banda
 * que ela já tem, e o escopo omitido alcança todas as receitas vigentes.
 */
export function buildArtisanalStrapMeasureYieldPayload(
  fields: ArtisanalStrapMeasureYieldPayload,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    confirmed_yield_m_per_m: fields.confirmedYieldMPerM,
  };
  if (fields.cutBandWidthMm != null) payload.cut_band_width_mm = fields.cutBandWidthMm;
  if (fields.baseGroupIds) payload.base_group_ids = fields.baseGroupIds;
  return payload;
}

/**
 * Aplica o rendimento a todas as napas de UMA medida, criando versão nova por
 * napa pelo writer canônico. O lado SQL valida o lote inteiro antes da primeira
 * escrita — um teto estourado em qualquer napa aborta tudo, então não existe
 * meia-aplicação: ou a medida inteira sai no número novo, ou nada muda.
 */
export async function confirmArtisanalStrapMeasureYield(
  measureId: string,
  fields: ArtisanalStrapMeasureYieldPayload,
  reason?: string,
): Promise<ArtisanalStrapMeasureYieldResult> {
  const { data, error } = await untypedSupabase.rpc(
    'confirm_artisanal_strap_measure_yield_for_all',
    {
      p_measure_id: measureId,
      p_payload: buildArtisanalStrapMeasureYieldPayload(fields),
      p_reason: reason ?? null,
    },
  );
  if (error) throw error;
  return data as ArtisanalStrapMeasureYieldResult;
}

/**
 * Teto do rendimento de uma napa: `floor(largura útil ÷ banda)`.
 * Espelha o CHECK `artisanal_strap_recipes_yield_ck` e a coluna GERADA
 * `theoretical_yield_m_per_m` — mudar um lado sem o outro faz a tela prometer
 * um número que o banco recusa.
 */
export function strapYieldCeiling(
  usableWidthMm: number | null | undefined,
  cutBandWidthMm: number | null | undefined,
): number {
  const width = Number(usableWidthMm) || 0;
  const band = Number(cutBandWidthMm) || 0;
  if (!(width > 0) || !(band > 0)) return 0;
  return Math.floor(width / band);
}
