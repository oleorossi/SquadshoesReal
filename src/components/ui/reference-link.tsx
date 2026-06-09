import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface ReferenceLinkProps {
  /** ID da ficha técnica (= sale_order_items.reference_id / orders.reference_id). */
  referenceId?: string | null;
  /** Conteúdo do link — código/nome da referência. */
  children: React.ReactNode;
  /** Classe extra (a cor primária + hover:underline já vêm por padrão). */
  className?: string;
  /** Classe do ícone. Default `h-3 w-3`. */
  iconClassName?: string;
  /** Esconde o ícone de "abrir" (espaços apertados). */
  hideIcon?: boolean;
  /** Abre em NOVA ABA em vez de navegar na mesma — use em formulários de edição
   *  e diálogos sobre conteúdo não salvo, pra não perder o trabalho. */
  newTab?: boolean;
  /** Roda antes de navegar na MESMA aba (ex.: fechar um dialog). Ignorado com newTab. */
  onBeforeNavigate?: () => void;
  title?: string;
}

/**
 * Nome/código de referência clicável que abre a FICHA TÉCNICA daquela
 * referência via deep-link `/fichas-tecnicas?ref=<id>` (a página expande a
 * ficha). Sem `referenceId`, renderiza o conteúdo como texto puro (sem link).
 * Faz `stopPropagation` pra funcionar dentro de cards/linhas clicáveis.
 */
export function ReferenceLink({
  referenceId,
  children,
  className,
  iconClassName = 'h-3 w-3',
  hideIcon = false,
  newTab = false,
  onBeforeNavigate,
  title = 'Abrir ficha técnica desta referência',
}: ReferenceLinkProps) {
  const navigate = useNavigate();
  if (!referenceId) return <>{children}</>;
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        const url = `/fichas-tecnicas?ref=${referenceId}`;
        if (newTab) {
          window.open(url, '_blank', 'noopener,noreferrer');
          return;
        }
        onBeforeNavigate?.();
        navigate(url);
      }}
      className={cn('group inline-flex items-center gap-1 text-primary hover:underline text-left', className)}
    >
      {children}
      {!hideIcon && (
        <ArrowSquareOut className={cn(iconClassName, 'shrink-0 opacity-50 group-hover:opacity-100 transition-opacity')} />
      )}
    </button>
  );
}
