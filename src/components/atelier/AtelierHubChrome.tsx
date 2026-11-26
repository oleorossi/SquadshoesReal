/**
 * Chrome da gestão do Ateliê: navegação em dois grupos, KPIs acionáveis
 * e atalhos de aba. Só apresentação — os totais vêm dos lotes já carregados.
 */
import {
  Calendar,
  ChartBar,
  ClipboardText,
  Package,
  Scissors,
  Tag,
  Truck,
  Users,
  Warning,
} from '@phosphor-icons/react';
import { useAtelierLots, useAtelierSettings } from '@/hooks/useAtelier';
import { summarizeAtelierHubKpis, type AtelierHubKpis } from '@/lib/atelierBoard';
import { cn } from '@/lib/utils';

export const ATELIER_HUB_TABS = new Set([
  'planejar',
  'lancar',
  'rua',
  'receber',
  'corte',
  'prestadores',
  'relatorio',
  'modelos',
  'tiras',
]);

export const ATELIER_TAB_ALIAS: Record<string, string> = {
  orders: 'rua',
  'os-ativas': 'rua',
  'na-rua': 'rua',
  planning: 'planejar',
  gestao: 'relatorio',
  prep: 'corte',
  rua: 'rua',
  contractors: 'prestadores',
  cobertura: 'prestadores',
  recipes: 'tiras',
};

type TabIcon = typeof Scissors;

export interface AtelierHubTab {
  id: string;
  label: string;
  icon: TabIcon;
  badgeKey?: keyof AtelierHubKpis;
  tone?: 'danger';
}

export const ATELIER_FLOW_TABS: AtelierHubTab[] = [
  { id: 'planejar', label: 'Planejar', icon: Calendar },
  { id: 'corte', label: 'Corte', icon: Scissors, badgeKey: 'awaitingCutLots' },
  { id: 'lancar', label: 'Lançar', icon: ClipboardText, badgeKey: 'readyToLaunchJobs' },
  { id: 'rua', label: 'Na rua', icon: Truck, badgeKey: 'onStreetJobs' },
  { id: 'receber', label: 'Receber', icon: Package, badgeKey: 'toReceiveJobs' },
];

export const ATELIER_SUPPORT_TABS: AtelierHubTab[] = [
  { id: 'prestadores', label: 'Prestadores', icon: Users },
  { id: 'modelos', label: 'Modelos', icon: Tag },
  { id: 'tiras', label: 'Tiras', icon: Scissors },
  { id: 'relatorio', label: 'Relatório', icon: ChartBar },
];

export function resolveAtelierHubTab(raw: string | null | undefined): string {
  const mapped = ATELIER_TAB_ALIAS[raw ?? ''] ?? raw ?? 'planejar';
  return ATELIER_HUB_TABS.has(mapped) ? mapped : 'planejar';
}

function formatKpi(n: number) {
  return n.toLocaleString('pt-BR');
}

export function AtelierHubNav({
  tab,
  onTabChange,
  kpis,
}: {
  tab: string;
  onTabChange: (tab: string, extras?: Record<string, string | null>) => void;
  kpis: AtelierHubKpis;
}) {
  return (
    <nav aria-label="Gestão do Ateliê" className="flex flex-col gap-2 xl:flex-row xl:items-stretch">
      <TabGroup
        label="Fluxo do dia"
        tabs={ATELIER_FLOW_TABS}
        tab={tab}
        onTabChange={onTabChange}
        kpis={kpis}
        emphasis
      />
      <TabGroup
        label="Cadastros e relatórios"
        tabs={ATELIER_SUPPORT_TABS}
        tab={tab}
        onTabChange={onTabChange}
        kpis={kpis}
      />
    </nav>
  );
}

function TabGroup({
  label,
  tabs,
  tab,
  onTabChange,
  kpis,
  emphasis,
}: {
  label: string;
  tabs: AtelierHubTab[];
  tab: string;
  onTabChange: (tab: string, extras?: Record<string, string | null>) => void;
  kpis: AtelierHubKpis;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-xl border p-1',
        emphasis ? 'border-border/80 bg-muted/40' : 'border-dashed border-border/70 bg-background',
      )}
      role="tablist"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      {tabs.map((item) => {
        const Icon = item.icon;
        const active = tab === item.id;
        const badge = item.badgeKey ? kpis[item.badgeKey] : 0;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(item.id, { atrasados: null })}
            className={cn(
              'inline-flex h-10 min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:bg-background/80 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" weight={active ? 'fill' : 'regular'} aria-hidden />
            <span className="whitespace-nowrap">{item.label}</span>
            {badge > 0 && (
              <span
                className={cn(
                  'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                  active ? 'bg-foreground text-background' : 'bg-muted text-foreground',
                )}
              >
                {formatKpi(badge)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function AtelierKpiStrip({
  kpis,
  onTabChange,
}: {
  kpis: AtelierHubKpis;
  onTabChange: (tab: string, extras?: Record<string, string | null>) => void;
}) {
  const items: Array<{
    label: string;
    value: number;
    tab: string;
    extras: Record<string, string | null>;
    danger?: boolean;
  }> = [
    { label: 'Aguardando corte', value: kpis.awaitingCutLots, tab: 'corte', extras: { atrasados: null } },
    { label: 'Prontos p/ lançar', value: kpis.readyToLaunchJobs, tab: 'lancar', extras: { atrasados: null } },
    { label: 'Na rua', value: kpis.onStreetJobs, tab: 'rua', extras: { atrasados: null } },
    { label: 'Atrasados', value: kpis.lateJobs, tab: 'corte', extras: { atrasados: '1' }, danger: true },
    { label: 'Pares em andamento', value: kpis.pairsInProgress, tab: 'corte', extras: { atrasados: null } },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" aria-label="Resumo do Ateliê">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onTabChange(item.tab, item.extras)}
          className={cn(
            'flex flex-col items-start gap-0.5 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/30 hover:bg-muted/30',
            item.danger && item.value > 0 && 'border-red-500/40 bg-red-500/5',
          )}
        >
          <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {item.danger && item.value > 0 && <Warning className="h-3.5 w-3.5 text-red-600" />}
            {item.label}
          </span>
          <span
            className={cn(
              'font-display text-xl tabular-nums leading-none text-foreground',
              item.danger && item.value > 0 && 'text-red-600',
            )}
          >
            {formatKpi(item.value)}
          </span>
        </button>
      ))}
    </div>
  );
}

export function useAtelierHubKpis(): AtelierHubKpis {
  const { data: lots = [] } = useAtelierLots();
  const { data: settings } = useAtelierSettings();
  return summarizeAtelierHubKpis(lots, settings);
}

