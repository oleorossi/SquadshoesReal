import { useState } from 'react';
import type { ProductGroup } from '@/hooks/useGroups';
import GroupCreateDialog from './GroupCreateDialog';
import GroupEditDialog, { type GroupEditTab } from './GroupEditDialog';

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
  /** Aba de abertura na edição — a lista de estoque tem um botão por assunto
   *  ("+ Cor" → cores, "Editar N itens" → em massa) e todos abrem ESTA janela. */
  initialTab?: GroupEditTab;
}

export default function GroupDialog({ open, onOpenChange, group, initialTab }: GroupDialogProps) {
  // Grupo recém-criado: a janela do grupo abre na sequência, independente do
  // `open` do pai (que já fechou a criação). Spec grupo-cor-obrigatoria.md, D5.
  const [created, setCreated] = useState<{ group: ProductGroup; tab: GroupEditTab } | null>(null);

  if (group) {
    return <GroupEditDialog open={open} onOpenChange={onOpenChange} group={group} initialTab={initialTab} />;
  }
  return (
    <>
      <GroupCreateDialog
        open={open}
        onOpenChange={onOpenChange}
        onCreated={(newGroup, tab) => setCreated({ group: newGroup, tab })}
      />
      {created && (
        <GroupEditDialog
          open
          onOpenChange={(next) => { if (!next) setCreated(null); }}
          group={created.group}
          initialTab={created.tab}
        />
      )}
    </>
  );
}
