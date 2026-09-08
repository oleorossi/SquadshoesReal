import { supabase } from '@/integrations/supabase/client';

export interface StrapMeasureHubFieldsPayload {
  origemPadrao?: string | null;
  precoArtesanalPerM?: number | null;
  precoPrestadorPerM?: number | null;
}

interface UntypedQueryResult {
  data: unknown;
  error: unknown;
}

interface UntypedSupabaseClient {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<UntypedQueryResult>;
}

const untypedSupabase = supabase as unknown as UntypedSupabaseClient;

/** Só chaves presentes: omitir não mexe na coluna; `null` zera o preço. */
export function buildArtisanalStrapMeasureHubPayload(
  fields: StrapMeasureHubFieldsPayload,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (fields.origemPadrao !== undefined) payload.origem_padrao = fields.origemPadrao;
  if (fields.precoArtesanalPerM !== undefined) {
    payload.preco_artesanal_per_m = fields.precoArtesanalPerM;
  }
  if (fields.precoPrestadorPerM !== undefined) {
    payload.preco_prestador_per_m = fields.precoPrestadorPerM;
  }
  return payload;
}

/**
 * Grava origem/preços da medida via RPC SECURITY DEFINER.
 * Só envia chaves presentes no payload — omitir não mexe; `null` zera o preço.
 */
export async function saveArtisanalStrapMeasureHubFields(
  measureId: string,
  fields: StrapMeasureHubFieldsPayload,
  reason?: string,
): Promise<string> {
  const { data, error } = await untypedSupabase.rpc('save_artisanal_strap_measure_hub_fields', {
    p_measure_id: measureId,
    p_payload: buildArtisanalStrapMeasureHubPayload(fields),
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return String(data ?? measureId);
}
