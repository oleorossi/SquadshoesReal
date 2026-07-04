import { forwardRef } from 'react';
import { Button, ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCan } from '@/hooks/useAccessControl';
import type { PermissionAction } from '@/hooks/useAccessControl';

interface PermissionButtonProps extends ButtonProps {
  /** Rota/área que governa a ação (ex.: '/finance', '/sales'). */
  path: string;
  /** Ação exigida. Default 'edit' (o gate mais comum em botões de ação). */
  action?: PermissionAction;
  /** Sem permissão: esconde (default) ou desabilita com tooltip. */
  whenDenied?: 'hide' | 'disable';
  /** Texto do tooltip quando desabilitado por falta de permissão. */
  deniedTooltip?: string;
}

/**
 * Botão que só age se o usuário tiver a permissão da AÇÃO na área (`path`).
 *
 * Primitivo reutilizável do controle CRUD por área — cada tela vai adotando ao
 * envolver seus botões de criar/editar/excluir. Admin e usuários sem permissão
 * granular (RBAC legado) sempre passam, então a adoção é incremental e segura:
 * envolver um botão nunca restringe quem já podia agir hoje.
 */
export const PermissionButton = forwardRef<HTMLButtonElement, PermissionButtonProps>(
  ({ path, action = 'edit', whenDenied = 'hide', deniedTooltip, ...buttonProps }, ref) => {
    const perm = useCan(path);
    const allowed =
      action === 'view' ? perm.canView
      : action === 'create' ? perm.canCreate
      : action === 'delete' ? perm.canDelete
      : perm.canEdit;

    if (allowed || perm.loading) return <Button ref={ref} {...buttonProps} />;
    if (whenDenied === 'hide') return null;

    const disabled = (
      <Button ref={ref} {...buttonProps} disabled aria-disabled />
    );
    if (!deniedTooltip) return disabled;
    return (
      <Tooltip>
        <TooltipTrigger asChild><span className="inline-flex">{disabled}</span></TooltipTrigger>
        <TooltipContent>{deniedTooltip}</TooltipContent>
      </Tooltip>
    );
  },
);
PermissionButton.displayName = 'PermissionButton';
