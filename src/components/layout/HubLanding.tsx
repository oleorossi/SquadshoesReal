import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, DotsThree as MoreHorizontal, ShieldCheck } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { useAccessControl } from '@/hooks/useAccessControl';
import { usePrefetchRoute } from '@/hooks/usePrefetchRoute';
import { getNavigationHub, getSecondaryRoutesForGroup } from '@/data/navigation';
import { cn } from '@/lib/utils';

interface HubLandingProps {
  /** Path canônico do hub — a definição vem de `HUBS` em `navigation.ts`. */
  hubPath: string;
  sectionLabel: string;
  description: string;
  /** Rótulo curto por filho, quando o nome do item não explica a etapa. */
  hints?: Record<string, string>;
}

/**
 * Casca de landing de hub — a tela que a sidebar abre quando a pessoa escolhe
 * uma área. Lista os FILHOS do hub (as telas de trabalho) e, embaixo, as
 * ferramentas que não ocupam a barra.
 *
 * Fonte única: `HUBS` (navigation.ts). Não enumere filhos aqui — um hub com
 * duas listas volta a divergir da sidebar, que foi a origem da metade dos
 * achados da auditoria de IA.
 */
export function HubLanding({ hubPath, sectionLabel, description, hints }: HubLandingProps) {
  const navigate = useNavigate();
  const { canAccessRoute } = useAccessControl();
  const { prefetch, cancel: cancelPrefetch } = usePrefetchRoute();
  const hub = getNavigationHub(hubPath);

  const children = useMemo(
    () => (hub ? hub.children.filter((child) => canAccessRoute(child.path)) : []),
    [hub, canAccessRoute],
  );

  const tools = useMemo(
    () => (hub
      ? hub.groups
        .flatMap((group) => getSecondaryRoutesForGroup(group))
        .filter((route) => canAccessRoute(route.path))
      : []),
    [hub, canAccessRoute],
  );

  if (!hub) return null;

  return (
    <div className="space-y-5 editorial-stagger">
      <EditorialPageHeader
        sectionLabel={sectionLabel}
        title={hub.label}
        description={description}
      />

      {children.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={ShieldCheck}
            title="Nenhuma tela desta área liberada"
            description="Sua conta não tem permissão para as telas deste setor. Peça a um administrador para liberar os acessos em Configurações."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {children.map((child) => (
            <button
              key={child.path}
              type="button"
              onClick={() => navigate(child.path)}
              onMouseEnter={() => prefetch(child.path)}
              onMouseLeave={cancelPrefetch}
              onFocus={() => prefetch(child.path)}
              className={cn(
                'group flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all',
                'hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <child.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-foreground group-hover:text-primary">
                  {child.label}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {hints?.[child.path] ?? child.group}
                </span>
              </span>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-1 group-hover:text-primary" />
            </button>
          ))}
        </div>
      )}

      {tools.length > 0 && (
        <Panel
          title={
            <span className="flex items-center gap-2">
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              Ferramentas da área
            </span>
          }
          subtitle="Telas de uso pontual — também achaveis no Cmd+K."
        >
          <div className="flex flex-wrap gap-2">
            {tools.map((tool) => (
              <button
                key={tool.path}
                type="button"
                onClick={() => navigate(tool.path)}
                onMouseEnter={() => prefetch(tool.path)}
                onMouseLeave={cancelPrefetch}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <tool.icon className="h-3.5 w-3.5" />
                {tool.label}
              </button>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
