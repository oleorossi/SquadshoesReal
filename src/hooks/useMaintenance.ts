import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Equipment {
  id: string;
  name: string;
  code: string | null;
  sector: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  acquisition_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaintenancePlan {
  id: string;
  equipment_id: string;
  description: string;
  frequency_days: number;
  last_performed_at: string | null;
  next_due_at: string | null;
  responsible: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  equipment?: Equipment;
}

export interface MaintenanceLog {
  id: string;
  equipment_id: string;
  plan_id: string | null;
  type: string;
  description: string;
  cost: number;
  performed_by: string | null;
  performed_at: string;
  notes: string | null;
  created_at: string;
  equipment?: Equipment;
}

// ─── Equipment ───
export function useEquipment() {
  return useQuery<Equipment[]>({
    queryKey: ["equipment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment" as any)
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Equipment[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpsertEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (eq: Partial<Equipment> & { name: string }) => {
      if (eq.id) {
        const { error } = await supabase
          .from("equipment" as any)
          .update(eq as any)
          .eq("id", eq.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("equipment" as any).insert(eq as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Equipamento salvo");
      qc.invalidateQueries({ queryKey: ["equipment"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("equipment" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Equipamento removido");
      qc.invalidateQueries({ queryKey: ["equipment"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Plans ───
export function useMaintenancePlans() {
  return useQuery<MaintenancePlan[]>({
    queryKey: ["maintenance-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_plans" as any)
        .select("*, equipment:equipment_id(id, name, code, sector)")
        .order("next_due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as MaintenancePlan[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpsertMaintenancePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plan: Partial<MaintenancePlan> & { equipment_id: string; description: string }) => {
      const payload: any = { ...plan };
      delete payload.equipment;
      if (plan.id) {
        const { error } = await supabase
          .from("maintenance_plans" as any)
          .update(payload)
          .eq("id", plan.id);
        if (error) throw error;
      } else {
        // Set initial next_due_at
        if (!payload.next_due_at) {
          const days = payload.frequency_days || 30;
          payload.next_due_at = new Date(Date.now() + days * 86400000).toISOString();
        }
        const { error } = await supabase.from("maintenance_plans" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Plano de manutenção salvo");
      qc.invalidateQueries({ queryKey: ["maintenance-plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Logs ───
export function useMaintenanceLogs() {
  return useQuery<MaintenanceLog[]>({
    queryKey: ["maintenance-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_logs" as any)
        .select("*, equipment:equipment_id(id, name, code)")
        .order("performed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MaintenanceLog[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useCreateMaintenanceLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (log: Partial<MaintenanceLog> & { equipment_id: string; description: string }) => {
      const payload: any = { ...log };
      delete payload.equipment;
      const { error } = await supabase.from("maintenance_logs" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Manutenção registrada");
      qc.invalidateQueries({ queryKey: ["maintenance-logs"] });
      qc.invalidateQueries({ queryKey: ["maintenance-plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}