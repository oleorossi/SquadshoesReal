import { ReactNode, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { CircleNotch as Loader2, Plus, Tray as Inbox, Trash as Trash2 } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { confirmAndBulkDelete } from '@/lib/bulkConfirm';

const STAT_TONE: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'destructive'> = {
  default: 'default', primary: 'primary', amber: 'warning', emerald: 'success', destructive: 'destructive',
};

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
  /**
   * Quando true, mostra checkbox no início de cada linha + BulkActionsBar
   * com botão "Excluir". Requer `entityLabel` (singular) e `displayLabel`
   * (função que monta linha do preview no prompt — ex: o => `• ${o.code} — ${o.name}`).
   * Excluir = DELETE direto na `table` configurada (mesma da query principal).
   */
  enableBulkDelete?: boolean;
  entityLabel?: string;
  displayLabel?: (row: any) => string;
}

export function DataListPage({
  title, subtitle, sectionLabel, icon: Icon,
  table, selectCols = '*', orderBy = 'created_at', ascending = false, limit = 100,
  filters = {},
  columns, stats = [], emptyText = 'Nenhum registro',
  newButtonLabel, newButtonOnClick, newButtonHref, headerExtra, badge,
  enableBulkDelete, entityLabel = 'registro', displayLabel,
}: Props) {
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
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
        <StatGrid>
          {stats.map((s, i) => (
            <StatCard key={i} label={s.label} value={s.value} tone={STAT_TONE[s.color || 'default']} />
          ))}
        </StatGrid>
      )}

      <Panel flush>
        {isLoading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Inbox} title={emptyText} size="sm" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {enableBulkDelete && (
                    <th className="w-8 px-3 py-2.5">
                      <Checkbox
                        checked={rows.length > 0 && rows.every((r: any) => selectedIds.has(r.id))}
                        onCheckedChange={(v) => {
                          if (v) setSelectedIds(new Set(rows.map((r: any) => r.id)));
                          else clearSelection();
                        }}
                        aria-label="Selecionar todos"
                      />
                    </th>
                  )}
                  {columns.map(c => (
                    <th key={c.key} style={{ width: c.width }}
                      className={`px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground ${
                        c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                      }`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row: any, idx: number) => (
                  <tr
                    key={row.id || idx}
                    className={`transition-colors ${selectedIds.has(row.id) ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/30'}`}
                  >
                    {enableBulkDelete && (
                      <td className="px-3 py-2.5">
                        <Checkbox
                          checked={selectedIds.has(row.id)}
                          onCheckedChange={() => toggleSelected(row.id)}
                          aria-label="Selecionar linha"
                        />
                      </td>
                    )}
                    {columns.map(c => (
                      <td key={c.key} className={`px-3 py-2.5 ${
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
      </Panel>

      {enableBulkDelete && (
        <BulkActionsBar
          selectedIds={selectedIds}
          onClear={clearSelection}
          itemLabel={selectedIds.size === 1 ? entityLabel : `${entityLabel}s`}
          actions={[
            {
              label: 'Excluir',
              variant: 'destructive',
              icon: <Trash2 className="h-3.5 w-3.5" />,
              onClick: async () => {
                const ids = Array.from(selectedIds);
                const sampleLines = rows
                  .filter((r: any) => selectedIds.has(r.id))
                  .slice(0, 5)
                  .map((r: any) => displayLabel ? displayLabel(r) : `• ${r.id}`);
                await confirmAndBulkDelete({
                  ids,
                  entityLabel,
                  sampleLines,
                  deleteOne: async (id) => {
                    const { error } = await (supabase as any).from(table).delete().eq('id', id);
                    if (error) throw error;
                  },
                  onAfter: () => {
                    clearSelection();
                    qc.invalidateQueries({ queryKey: [table] });
                  },
                });
              },
            },
          ]}
        />
      )}
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
        <EmptyState
          icon={Icon}
          title="Nenhum registro ainda"
          description={message || 'Módulo recém-implantado — os cadastros aparecerão aqui conforme forem criados.'}
          action={<Badge variant="outline">Estrutura pronta · DB tabelas criadas</Badge>}
        />
      </Card>
    </div>
  );
}
