// Porta única de dados da Engine de Capacidade & Produtividade por Modelo
// (specs/produtividade-por-modelo.md). RPCs e tabelas das migrations 20260719*.
// Validação dupla (R12): estas checagens client-side espelham os CHECKs do banco
// e falham ANTES de chamar o Supabase.
import { supabase } from "@/integrations/supabase/client";
import type {
  CapacityParameters,
  ModelProductivityResult,
  ProductivitySnapshot,
  SectorHeadcountRow,
  SetCapacityResult,
} from "@/types/capacity";

export interface SheetOption {
  id: string;
  name: string;
  shoe_category: string | null;
}

function assertSheetIds(sheetIds: string[]): void {
  if (!Array.isArray(sheetIds) || sheetIds.length === 0) {
    throw new Error("Selecione ao menos uma ficha técnica");
  }
}

export function assertHeadcount(headcount: number | null): void {
  if (headcount === null) return; // limpar a equipe do setor é válido
  if (typeof headcount !== "number" || !Number.isFinite(headcount) || headcount < 0) {
    throw new Error("Equipe inválida: informe um número ≥ 0 (aceita 0,5 pra pessoa dividida)");
  }
}

export function assertCapacityParams(patch: Partial<CapacityParameters>): void {
  if (patch.efficiency_pct !== undefined) {
    if (!Number.isFinite(patch.efficiency_pct) || patch.efficiency_pct <= 0 || patch.efficiency_pct > 100) {
      throw new Error("Eficiência inválida: use um valor entre 1 e 100%");
    }
  }
  if (patch.journey_minutes !== undefined) {
    if (!Number.isFinite(patch.journey_minutes) || patch.journey_minutes < 60 || patch.journey_minutes > 720) {
      throw new Error("Jornada inválida: use entre 60 e 720 minutos");
    }
  }
  if (patch.working_days_per_month !== undefined) {
    if (!Number.isFinite(patch.working_days_per_month) || patch.working_days_per_month < 1 || patch.working_days_per_month > 31) {
      throw new Error("Dias úteis inválidos: use entre 1 e 31");
    }
  }
}

/** Fichas ativas pro seletor (status é 'Ativo' pt-BR — não filtrar por 'active'). */
export async function listActiveSheets(): Promise<SheetOption[]> {
  const { data, error } = await supabase
    .from("technical_sheets")
    .select("id, name, shoe_category")
    .eq("status", "Ativo")
    .order("name");
  if (error) throw error;
  return (data ?? []) as SheetOption[];
}

export async function getModelProductivity(sheetIds: string[]): Promise<ModelProductivityResult> {
  assertSheetIds(sheetIds);
  const { data, error } = await (supabase as any).rpc("get_model_productivity", {
    p_sheet_ids: sheetIds,
  });
  if (error) throw error;
  return data as unknown as ModelProductivityResult;
}

export async function getCapacityParameters(): Promise<CapacityParameters | null> {
  const { data, error } = await (supabase as any)
    .from("capacity_parameters")
    .select("journey_minutes, efficiency_pct, working_days_per_month")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as CapacityParameters | null;
}

export async function updateCapacityParameters(patch: Partial<CapacityParameters>): Promise<void> {
  assertCapacityParams(patch);
  if (Object.keys(patch).length === 0) return;
  const { error } = await (supabase as any)
    .from("capacity_parameters")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw error;
}

export async function listSectorHeadcount(): Promise<SectorHeadcountRow[]> {
  const { data, error } = await (supabase as any)
    .from("sector_settings")
    .select("sector, flow_order, headcount")
    .order("flow_order");
  if (error) throw error;
  return (data ?? []) as SectorHeadcountRow[];
}

export async function updateSectorHeadcount(sector: string, headcount: number | null): Promise<void> {
  if (!sector) throw new Error("Setor obrigatório");
  assertHeadcount(headcount);
  const { error } = await (supabase as any)
    .from("sector_settings")
    .update({ headcount })
    .eq("sector", sector);
  if (error) throw error;
}

/** Grava a equipe de VÁRIOS setores numa transação só (RPC update_sector_headcounts,
 *  mig 20260719120300) — evita escrita parcial quando um update falha no meio. */
export async function updateSectorHeadcounts(changes: Record<string, number | null>): Promise<number> {
  const entries = Object.entries(changes);
  if (entries.length === 0) return 0;
  for (const [sector, headcount] of entries) {
    if (!sector) throw new Error("Setor obrigatório");
    assertHeadcount(headcount);
  }
  const { data, error } = await (supabase as any).rpc("update_sector_headcounts", {
    p_headcounts: changes,
  });
  if (error) throw error;
  return (data ?? 0) as number;
}

/** Edição de capacidade produtiva POR MODELO × SETOR (R19): o dono digita
 *  pares/dia observados e o servidor converte pra min/par (= headcount ×
 *  jornada ÷ pares), gravando como tempo manual no BOM da ficha. A dificuldade
 *  do modelo fica embutida no min/par — modelo que rende menos pares fica mais
 *  caro por par no custo-minuto e no custeio do PV (trigger costs_dirty). */
export async function setModelSectorCapacity(
  sheetId: string,
  sector: string,
  pairsPerDay: number,
): Promise<SetCapacityResult> {
  if (!sheetId) throw new Error("Ficha obrigatória");
  if (!sector) throw new Error("Setor obrigatório");
  if (typeof pairsPerDay !== "number" || !Number.isFinite(pairsPerDay) || pairsPerDay <= 0) {
    throw new Error("Capacidade inválida: informe pares/dia maior que zero");
  }
  const { data, error } = await (supabase as any).rpc("set_model_sector_capacity", {
    p_sheet_id: sheetId,
    p_sector: sector,
    p_pairs_per_day: pairsPerDay,
  });
  if (error) throw error;
  return data as unknown as SetCapacityResult;
}

/** Congela o cálculo atual da ficha no banco de custos. Server-side recalcula
 *  via get_model_productivity — o cliente NUNCA envia os números (R17). */
export async function saveProductivitySnapshot(sheetId: string): Promise<unknown> {
  if (!sheetId) throw new Error("Ficha obrigatória");
  const { data, error } = await (supabase as any).rpc("save_model_productivity_snapshot", {
    p_sheet_id: sheetId,
  });
  if (error) throw error;
  return data;
}

export async function listProductivitySnapshots(sheetId: string): Promise<ProductivitySnapshot[]> {
  if (!sheetId) throw new Error("Ficha obrigatória");
  const { data, error } = await (supabase as any)
    .from("model_productivity_snapshots")
    .select("*")
    .eq("technical_sheet_id", sheetId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as ProductivitySnapshot[];
}

export async function deleteProductivitySnapshot(id: string): Promise<void> {
  if (!id) throw new Error("Snapshot obrigatório");
  const { error } = await (supabase as any)
    .from("model_productivity_snapshots")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
