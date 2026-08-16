import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const LABELS: Record<string, string> = {
  active: 'Ativa',
  review_required: 'Revisão necessária',
  suspended: 'Suspensa',
  archived: 'Arquivada',
  draft: 'Rascunho',
  pending_approval: 'Aguardando aprovação',
  'aguardando aprovação': 'Aguardando aprovação',
  approved: 'Aprovada',
  aprovada: 'Aprovada',
  suspensa: 'Suspensa',
  'oc provisória — sem fornecedor': 'OC Provisória — Sem fornecedor',
  superseded: 'Substituída',
  pending: 'Pendente',
  allocated: 'Alocada',
  planned: 'Planejada',
  in_progress: 'Em andamento',
  partial: 'Parcial',
  fulfilled: 'Atendida',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  error: 'Erro',
  dead_letter: 'Requer intervenção',
};

interface StrapStatusBadgeProps {
  status: string | null | undefined;
  className?: string;
}

export function StrapStatusBadge({ status, className }: StrapStatusBadgeProps) {
  const normalized = (status || 'pending').toLowerCase();
  const attention = ['review_required', 'pending_approval', 'aguardando aprovação', 'suspended', 'suspensa', 'oc provisória — sem fornecedor', 'error', 'dead_letter'].includes(normalized);
  const completed = ['active', 'approved', 'aprovada', 'fulfilled', 'completed'].includes(normalized);

  return (
    <Badge
      variant={attention ? 'outline' : completed ? 'default' : 'secondary'}
      className={cn(
        'whitespace-nowrap text-[10px]',
        attention && 'border-warning/50 bg-warning/10 text-warning-foreground',
        className,
      )}
    >
      {LABELS[normalized] || status || 'Pendente'}
    </Badge>
  );
}
