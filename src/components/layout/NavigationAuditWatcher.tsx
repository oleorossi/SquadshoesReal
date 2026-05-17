import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Warning as AlertTriangle, Gear as SettingsIcon, X, FunnelSimple as ListFilter } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';
import {
  runNavigationAuditOnce,
  describeIssue,
  type NavigationIssue,
} from '@/lib/navigationAudit';

/** Extrai o path da rota inconsistente da issue, quando aplicável. */
function getIssuePath(issue: NavigationIssue): string | null {
  if ('path' in issue) return issue.path;
  return null;
}

/**
 * Roda a auditoria de menu ↔ permissões na primeira montagem do AppLayout
 * e exibe um aviso visual em desenvolvimento. Silencioso em produção.
 *
 * Renderiza um banner discreto no topo da tela apenas quando há issues
 * ativas em DEV, para que o desenvolvedor perceba imediatamente. Cada
 * issue oferece atalho para a tela de Permissões (/settings) e destaca
 * o path da rota com inconsistência para correção mais rápida.
 */
export function NavigationAuditWatcher() {
  const [issues, setIssues] = useState<NavigationIssue[]>([]);
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;

  useEffect(() => {
    const found = runNavigationAuditOnce();
    if (!isDev || found.length === 0) return;
    setIssues(found);
    const firstPath = found.map(getIssuePath).filter(Boolean)[0];
    toast.error(`${found.length} ${found.length === 1 ? 'inconsistência' : 'inconsistências'} no menu lateral`, {
      description: firstPath
        ? `Primeira: ${firstPath}. Clique para abrir a tela de Permissões.`
        : 'Itens de menu apontam para módulos incoerentes. Veja o console.',
      duration: 10000,
      action: {
        label: 'Permissões',
        onClick: () => { window.location.assign('/settings'); },
      },
    });
  }, [isDev]);

  if (!isDev || issues.length === 0) return null;

  return (
    <div className="sticky top-0 z-50 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
        <div className="flex-1">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <strong className="text-destructive">[DEV] Menu ↔ Permissões inconsistente</strong>
            <div className="flex gap-2">
              <Link
                to="/navigation-audit"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors text-[10px] font-semibold uppercase tracking-wider"
              >
                <ListFilter className="h-3 w-3" />
                Ver Detalhes
              </Link>
              <Link
                to="/settings"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors text-[10px] font-semibold uppercase tracking-wider"
              >
                <SettingsIcon className="h-3 w-3" />
                Abrir Permissões
              </Link>
            </div>
          </div>
          <ul className="mt-1.5 list-disc ml-5 space-y-1 text-muted-foreground">
            {issues.map((i, idx) => {
              const path = getIssuePath(i);
              return (
                <li key={idx} className="leading-relaxed">
                  {path && (
                    <code className="px-1.5 py-0.5 rounded bg-destructive/20 text-destructive font-mono font-bold mr-1.5">
                      {path}
                    </code>
                  )}
                  <span>{describeIssue(i)}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <button
          onClick={() => setIssues([])}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Fechar aviso"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
