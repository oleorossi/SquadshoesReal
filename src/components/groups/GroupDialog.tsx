import type { ProductGroup } from '@/hooks/useGroups';
import GroupCreateDialog from './GroupCreateDialog';
import GroupEditDialog from './GroupEditDialog';

/**
 * Entry ÚNICO para o diálogo de grupo de material. Delega para o fluxo de criação
 * (sem `group`) ou de edição (com `group`), sem duplicar a decisão em cada tela.
 *
 * Os dois fluxos internos (GroupCreateDialog / GroupEditDialog) continuam sendo os
 * componentes battle-tested — este wrapper só unifica o ponto de entrada, então
 * toda tela importa `GroupDialog` e passa (ou não) `group`.
 */
export interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ausente = criar novo grupo; presente = editar o grupo informado. */
  group?: ProductGroup | null;
}

export default function GroupDialog({ open, onOpenChange, group }: GroupDialogProps) {
  if (group) {
    return <GroupEditDialog open={open} onOpenChange={onOpenChange} group={group} />;
  }
  return <GroupCreateDialog open={open} onOpenChange={onOpenChange} />;
}
