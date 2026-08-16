import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ContractorSectionHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  className?: string;
}

/**
 * Cabeçalho canônico das áreas do módulo Terceirizados.
 *
 * Mantém a mesma hierarquia visual do cadastro de Pessoas, mas usa vocabulário
 * de expedição externa: operação, capacidade, retorno e financeiro.
 */
export function ContractorSectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: ContractorSectionHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 border-b-2 border-foreground pb-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}
