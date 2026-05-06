import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface WorkflowCondition {
  id: string;
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'is_empty' | 'is_not_empty';
  value: string;
}

export interface WorkflowAction {
  id: string;
  type: string;
  label: string;
  config: Record<string, string>;
}

export interface AutomationWorkflow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  trigger_label: string;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  enabled: boolean;
  category: string;
  execution_count: number;
  success_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationExecution {
  id: string;
  workflow_id: string;
  workflow_name: string;
  trigger: string;
  status: 'success' | 'error' | 'skipped';
  context: Record<string, unknown>;
  result: Record<string, unknown>;
  error_message: string | null;
  executed_at: string;
}

export type WorkflowInsert = {
  name: string;
  description: string;
  trigger: string;
  trigger_label: string;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  enabled: boolean;
  category: string;
};

// Tables not yet in generated types — cast to bypass type check
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

export function useAutomationWorkflows() {
  return useQuery({
    queryKey: ['automation_workflows'],
    queryFn: async () => {
      const { data, error } = await db()
        .from('automation_workflows')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data as unknown[]) ?? []).map((row: any) => ({
        ...row,
        conditions: Array.isArray(row.conditions) ? row.conditions : [],
        actions: Array.isArray(row.actions) ? row.actions : [],
      })) as AutomationWorkflow[];
    },
    staleTime: 30_000,
  });
}

export function useAddWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: WorkflowInsert) => {
      const { error } = await db().from('automation_workflows').insert(form);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation_workflows'] });
      toast.success('Automação criada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<WorkflowInsert> }) => {
      const { error } = await db().from('automation_workflows').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation_workflows'] });
      toast.success('Automação atualizada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db().from('automation_workflows').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation_workflows'] });
      toast.success('Automação removida');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useToggleWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await db().from('automation_workflows').update({ enabled }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['automation_workflows'] });
      toast.success(vars.enabled ? 'Automação ativada' : 'Automação desativada');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRunWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (workflow: AutomationWorkflow) => {
      const ranAt = new Date().toISOString();
      const result = {
        dry_run: true,
        ran_at: ranAt,
        trigger: workflow.trigger,
        conditions_count: workflow.conditions.length,
        actions_queued: workflow.actions.map(a => ({ type: a.type, label: a.label })),
      };

      const { error: logErr } = await db().from('automation_executions').insert({
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        trigger: workflow.trigger,
        status: 'success',
        context: { manual: true, triggered_by: 'user' },
        result,
        error_message: null,
      });
      if (logErr) throw logErr;

      // Atomic increment via RPC — avoids lost-update when two concurrent
      // triggers read the same stale cached count and both write N+1 instead of N+2.
      const { error: statsErr } = await (db() as any).rpc('increment_workflow_stats', {
        p_id: workflow.id,
        p_success: true,
      });
      if (statsErr) throw statsErr;

      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation_workflows'] });
      qc.invalidateQueries({ queryKey: ['automation_executions'] });
      toast.success('Automação executada e registrada no histórico');
    },
    onError: (e: Error) => toast.error('Erro ao executar: ' + e.message),
  });
}

export function useAutomationExecutions(workflowId?: string | null) {
  return useQuery({
    queryKey: ['automation_executions', workflowId ?? null],
    queryFn: async () => {
      let query = db()
        .from('automation_executions')
        .select('*')
        .order('executed_at', { ascending: false })
        .limit(200);
      if (workflowId) query = query.eq('workflow_id', workflowId);
      const { data, error } = await query;
      if (error) throw error;
      return (data as AutomationExecution[]) ?? [];
    },
    staleTime: 15_000,
  });
}
