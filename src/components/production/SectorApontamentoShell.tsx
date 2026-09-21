import type { ReactNode } from 'react';
import { Warning as AlertTriangle, CircleNotch as Loader2, Icon as LucideIcon } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { TableSkeleton } from '@/components/layout/PageSkeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { StatGrid } from '@/components/ui/stat-card';
import { Checkbox } from '@/components/ui/checkbox';

interface SectorApontamentoShellProps {
  sectionLabel: string;
  title: string;
  description: string;
  isLoading: boolean;
  isError: boolean;
  isFetching?: boolean;
  onRetry: () => void;
  actions?: ReactNode;
  stats?: ReactNode;
  /** Conteúdo principal (lista / grade). Só renderiza se houver itens. */
  children?: ReactNode;
  empty?: {
    icon: LucideIcon;
    title: string;
    description: string;
  };
  /** Quando true, mostra empty em vez de children. */
  isEmpty?: boolean;
  /** Barra "selecionar todas" acima da lista. */
  selectAll?: {
    checked: boolean;
    onToggle: () => void;
    label: string;
  };
  /** Slot abaixo do header e acima dos stats (ex.: demanda de solado). */
  beforeStats?: ReactNode;
  /** Slot entre stats e lista. */
  afterStats?: ReactNode;
}

/**
 * Casca visual compartilhada do Apontamento por setor
 * (spec montagem-solagem-produtividade Fase A).
 * Loading/erro antes de empty; header + stats + seleção padronizados.
 */
export function SectorApontamentoShell({
  sectionLabel,
  title,
  description,
  isLoading,
  isError,
  isFetching,
  onRetry,
  actions,
  stats,
  children,
  empty,
  isEmpty,
  selectAll,
  beforeStats,
  afterStats,
}: SectorApontamentoShellProps) {
  if (isLoading) {
    return (
      <div className="space-y-5 page-enter">
        <EditorialPageHeader sectionLabel={sectionLabel} title={title} description={description} />
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="font-semibold text-foreground">Falha ao carregar as OPs do setor</p>
        <p className="text-sm text-muted-foreground">
          Pode ser uma instabilidade momentânea de conexão. Tente novamente sem recarregar a página.
        </p>
        <Button onClick={onRetry} disabled={isFetching} className="mt-1 gap-1.5">
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isFetching ? 'Carregando…' : 'Tentar novamente'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel={sectionLabel}
        title={title}
        description={description}
        actions={actions}
      />
      {beforeStats}
      {stats ? <StatGrid>{stats}</StatGrid> : null}
      {afterStats}
      {isEmpty && empty ? (
        <Panel flush>
          <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
        </Panel>
      ) : (
        <div className="space-y-3">
          {selectAll && (
            <div className="flex items-center gap-2 px-1">
              <Checkbox checked={selectAll.checked} onCheckedChange={selectAll.onToggle} />
              <span className="text-xs font-medium text-muted-foreground">{selectAll.label}</span>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
