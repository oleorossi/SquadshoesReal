// Serviço de qualidade vinculado a ondas (Patch 6)
import { supabase } from "@/integrations/supabase/client";

export interface StageQuality {
  wave_stage_id: string;
  wave_id: string;
  stage: "corte" | "costura" | "silk" | "colagem" | "montagem" | "expedicao" | "acabamento";
  produced_quantity: number;
  total_defects: number;
  defect_rate: number;
  inspections_count: number;
}

export async function registerDefect(input: {
  waveStageId: string;
  defectQty: number;
  reason: string;
  productRef?: string;
  color?: string;
}): Promise<{
  inspection_id: string;
  rework_id: string;
  adjusted_produced: number;
}> {
  const { data, error } = await supabase.rpc(
    "register_defect_and_adjust_wave" as any,
    {
      p_wave_stage_id: input.waveStageId,
      p_defect_qty: input.defectQty,
      p_reason: input.reason,
      p_product_ref: input.productRef ?? null,
      p_color: input.color ?? "",
    },
  );
  if (error) throw error;
  return data as {
    inspection_id: string;
    rework_id: string;
    adjusted_produced: number;
  };
}

export async function listStageQuality(waveId: string): Promise<StageQuality[]> {
  const { data, error } = await supabase
    .from("v_stage_quality" as any)
    .select("*")
    .eq("wave_id", waveId);
  if (error) throw error;
  return (data ?? []) as unknown as StageQuality[];
}
