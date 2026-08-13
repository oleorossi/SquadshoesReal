import { supabase } from '@/integrations/supabase/client';

export type PrintJobStatus = 'pending' | 'generated' | 'confirmed' | 'failed' | 'cancelled';

interface CreatePrintJobInput {
  batchName: string;
  totalLabels: number;
  orderIds?: string[];
  templateId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Registra a intenção antes de renderizar. "confirmed" só vem de ação humana. */
export async function createPrintJob(input: CreatePrintJobInput): Promise<string> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Sessão expirada. Entre novamente.');
  const templateId = input.templateId && UUID_RE.test(input.templateId) ? input.templateId : null;
  const { data, error } = await supabase
    .from('print_jobs')
    .insert({
      batch_name: input.batchName,
      total_labels: input.totalLabels,
      status: 'pending',
      order_ids: input.orderIds || [],
      template_id: templateId,
      user_id: user.id,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function setPrintJobStatus(id: string, status: PrintJobStatus): Promise<void> {
  const { error } = await supabase.from('print_jobs').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function confirmPrintJob(id: string): Promise<void> {
  return setPrintJobStatus(id, 'confirmed');
}

export function isPhysicallyConfirmed(status: string | null | undefined): boolean {
  return status === 'confirmed';
}

export const PRINT_JOB_STATUS_LABELS: Record<string, string> = {
  pending: 'Gerando PDF',
  generated: 'PDF gerado — confirmar impressão',
  confirmed: 'Impressão confirmada',
  failed: 'Falha na geração',
  cancelled: 'Cancelado',
  completed: 'Legado — não confirmado',
};
