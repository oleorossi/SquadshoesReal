import { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, Plus, Tray as Inbox } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

interface Column {
  key: string;
  label: string;
  render?: (row: any) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

interface Stat {
  label: string;
  value: string | number;
  color?: 'default' | 'primary' | 'amber' | 'emerald' | 'destructive';
}

interface Props {
  title: string;
  subtitle?: string;
  /**
   * Quando informado, o cabeçalho é renderizado como EditorialPageHeader
   * (título Anton, kicker, rule-line) — usado quando o DataListPage é a
   * página inteira. Sem ele, mantém o header compacto (ideal pra uso
   * embutido dentro de abas/cards).
   */
  sectionLabel?: string;
  icon?: any;
  table: string;
  selectCols?: string;
  orderBy?: string;
  ascending?: boolean;
  limit?: number;
  filters?: Record<string, any>;
  columns: Column[];
  stats?: Stat[];
  emptyText?: string;
  newButtonLabel?: string;
  newButtonOnClick?: () => void;
  newButtonHref?: string;
  headerExtra?: ReactNode;
  badge?: ReactNode;
}

export function DataListPage({
  title, subtitle, sectionLabel, icon: Icon,
  table, selectCols = '*', orderBy = 'created_at', ascending = false, limit = 100,
  filters = {},
  columns, stats = [], emptyText = 'Nenhum registro',
  newButtonLabel, newButtonOnClick, newButtonHref, headerExtra, badge,
}: Props) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: [table, selectCols, orderBy, JSON.stringify(filters), limit],
    queryFn: async () => {
      let q = (supabase as any).from(table).select(selectCols).order(orderBy, { ascending }).limit(limit);
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null && v !== '') q = q.eq(k, v);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const STAT_COLORS: Record<string, string> = {
    default: 'text-foreground',
    primary: 'text-primary',
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
    destructive: 'text-destructive',
  };

  const headerActions = (
    <>
      {badge}
      {headerExtra}
      {newButtonLabel && newButtonOnClick && (
        <Button size="sm" className="gap-1.5" onClick={newButtonOnClick}>
          <Plus className="h-4 w-4" /> {newButtonLabel}
        </Button>
      )}
      {newButtonLabel && newButtonHref && (
        <Button size="sm" className="gap-1.5" asChild>
          <Link to={newButtonHref}>
            <Plus className="h-4 w-4" /> {newButtonLabel}
          </Link>
        </Button>
      )}
    </>
  );
  const hasActions = !!(badge || headerExtra || (newButtonLabel && (newButtonOnClick || newButtonHref)));

  return (
    <div className="space-y-4">
      {sectionLabel ? (
        <EditorialPageHeader
          sectionLabel={sectionLabel}
          title={title}
          description={subtitle}
          actions={hasActions ? headerActions : undefined}
        />
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            {Icon && <Icon className="h-7 w-7 text-primary mt-1 shrink-0" />}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                {badge}
              </div>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {headerExtra}
            {newButtonLabel && newButtonOnClick && (
              <Button size="sm" className="gap-1.5" onClick={newButtonOnClick}>
                <Plus className="h-4 w-4" /> {newButtonLabel}
              </Button>
            )}
            {newButtonLabel && newButtonHref && (
              <Button size="sm" className="gap-1.5" asChild>
                <Link to={newButtonHref}>
                  <Plus className="h-4 w-4" /> {newButtonLabel}
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}

      {stats.length > 0 && (
        <div className={`grid grid-cols-2 ${stats.length >= 3 ? 'md:grid-cols-3' : ''} ${stats.length >= 4 ? 'lg:grid-cols-4' : ''} gap-3`}>
          {stats.map((s, i) => (
            <Card key={i}>
              <CardContent className="p-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{s.label}</p>
                <p className={`text-2xl font-bold tracking-tight ${STAT_COLORS[s.color || 'default']}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-10 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Inbox className="h-10 w-10 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">{emptyText}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    {columns.map(c => (
                      <th key={c.key} style={{ width: c.width }}
                        className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${
                          c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                        }`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row: any, idx: number) => (
                    <tr key={row.id || idx} className="hover:bg-muted/30">
                      {columns.map(c => (
                        <td key={c.key} className={`px-3 py-2 ${
                          c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''
                        }`}>
                          {c.render ? c.render(row) : (row[c.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Stub mini para tabelas vazias
export function EmptyModulePage({
  title, subtitle, icon: Icon, message,
}: { title: string; subtitle?: string; icon?: any; message?: string }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        {Icon && <Icon className="h-7 w-7 text-primary mt-1" />}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          {Icon && <Icon className="h-12 w-12 mx-auto text-muted-foreground/30" />}
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {message || 'Módulo recém-implantado — nenhum registro ainda. Os cadastros aparecerão aqui conforme forem criados.'}
          </p>
          <Badge variant="outline">Estrutura pronta · DB tabelas criadas</Badge>
        </CardContent>
      </Card>
    </div>
  );
}
