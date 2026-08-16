import { supabase } from '@/integrations/supabase/client';

export interface SoleProfilePatch {
  name?: string;
  sku?: string;
  color?: string;
  unit_price?: number;
  size_from?: number;
  size_to?: number;
  supplier_id?: string | null;
  supplier_lead_time_days?: number;
  sole_material?: string | null;
  heel_height?: number | null;
  sole_moq?: number;
  sole_technical_notes?: string | null;
  is_standard_sole_item?: boolean;
  is_fachetado?: boolean;
  insole_mode?: 'cortar' | 'pronta_na_cor';
  sole_classification?: 'tradicional' | 'palmilha_pronta' | 'conjugado';
  fachete_material_group_id?: string | null;
}

export interface SoleProfileUpdateResult {
  product_id: string;
  updated: boolean;
  siblings_updated: number;
}

interface SoleProfileRpcClient {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
}

export async function updateSoleProfile(
  productId: string,
  profile: SoleProfilePatch,
): Promise<SoleProfileUpdateResult> {
  const rpcClient = supabase as unknown as SoleProfileRpcClient;
  const { data, error } = await rpcClient.rpc('update_sole_profile', {
    p_product_id: productId,
    p_profile: profile,
  });
  if (error) throw error;
  return data as SoleProfileUpdateResult;
}
