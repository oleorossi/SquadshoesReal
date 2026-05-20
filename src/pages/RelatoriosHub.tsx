/**
 * Hub de Relatórios A4 — index page que lista os 6 relatórios do redesign Novidade.
 *
 * Cada card tem:
 *   - Ícone editorial
 *   - Nome + slug
 *   - Descrição curta do que o relatório mostra
 *   - Badge de orientação (portrait / landscape)
 *   - Frequência sugerida (diário, semanal, por OP)
 *   - Link pra abrir
 */
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CalendarBlank as CalendarDays, ChartBar as FileBarChart, TrendUp as TrendingUp, ShieldCheck,
  Warning as AlertTriangle, ChartBar as BarChart3, ArrowRight,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

type ReportEntry = {
  slug: string;
  name: string;
  shortName: string;
  to: string;
  description: string;
  orientation: 'portrait' | 'landscape';
  frequency: string;
  icon: typeof CalendarDays;
  group: 'producao' | 'qualidade';
};

const REPORTS: ReportEntry[] = [
  {
    slug: 'RD',
    name: 'Relatório Diário de Produção',
    shortName: 'Diário',
    to: '/relatorios/diario-producao',
    description: 'KPIs do dia, produção por linha, % da meta, ocorrências do turno.',
    orientation: 'portrait',
    frequency: 'Diário',
    icon: CalendarDays,
    group: 'producao',
  },
  {
    slug: 'OP',
    name: 'Relatório de Fechamento de OP',
    shortName: 'Por OP',
    to: '/relatorios/op',
    description: 'Identificação + indicadores + apontamento por etapa + consumo de materiais.',
    orientation: 'portrait',
    frequency: 'Por OP fechada',
    icon: FileBarChart,
    group: 'producao',
  },
  {
    slug: 'OEE',
    name: 'Eficiência (OEE) Semanal',
    shortName: 'OEE',
    to: '/relatorios/oee',
    description: 'OEE/Disp/Perf/Qual por linha com sparkline + causas de perda + foco da semana.',
    orientation: 'landscape',
    frequency: 'Semanal',
    icon: TrendingUp,
    group: 'producao',
  },
  {
    slug: 'QC',
    name: 'Qualidade · FPY',
    shortName: 'Qualidade',
    to: '/relatorios/qualidade',
    description: 'Defeitos por categoria, Pareto top-5, ações corretivas com pílulas de status.',
    orientation: 'portrait',
    frequency: 'Semanal',
    icon: ShieldCheck,
    group: 'qualidade',
  },
  {
    slug: 'REF',
    name: 'Refugo & Re-trabalho',
    shortName: 'Refugo',
    to: '/relatorios/refugo',
    description: 'Refugo por linha + por etapa + custo R$ por categoria com total invertido.',
    orientation: 'portrait',
    frequency: 'Semanal',
    icon: AlertTriangle,
    group: 'qualidade',
  },
  {
    slug: 'SEM',
    name: 'Consolidado Semanal',
    shortName: 'Semanal',
    to: '/relatorios/semanal',
    description: 'Resumo geral da semana: produção dia-a-dia, top 5 modelos, histórico 6 semanas.',
    orientation: 'landscape',
    frequency: 'Semanal',
    icon: BarChart3,
    group: 'producao',
  },
];

const GROUP_LABELS: Record<ReportEntry['group'], string> = {
  producao: 'Produção',
  qualidade: 'Qualidade',
};

export default function RelatoriosHub() {
  const grouped = REPORTS.reduce<Record<string, ReportEntry[]>>((acc, r) => {
    (acc[r.group] = acc[r.group] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6 page-enter">
      {/* Header */}
      <EditorialPageHeader
        sectionLabel="RELATÓRIOS · HUB"
        title="Relatórios"
        description="Os 6 relatórios oficiais do redesign Novidade. Cada um abre em layout A4 pronto pra impressão — botão Imprimir no topo dispara window.print() com regras @page. Hoje todos com dados de exemplo."
      />

      {/* Cards agrupados */}
      {Object.entries(grouped).map(([groupKey, items]) => (
        <div key={groupKey} className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="display text-lg">{GROUP_LABELS[groupKey as ReportEntry['group']]}</h2>
            <div className="flex-1 h-px bg-border" />
            <Badge variant="secondary" className="text-xs">
              {items.length} {items.length === 1 ? 'relatório' : 'relatórios'}
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((r) => {
              const Icon = r.icon;
              return (
                <Link
                  key={r.slug}
                  to={r.to}
                  className={cn(
                    'group relative block rounded-xl border bg-card p-5 slash-top',
                    'transition-all duration-200 hover:border-primary/40 hover:shadow-card-hover hover:-translate-y-0.5'
                  )}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <Icon className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                  </div>

                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                      {r.slug}
                    </span>
                    <span className="display text-lg leading-tight">{r.shortName}</span>
                  </div>

                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    {r.description}
                  </p>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-xs uppercase tracking-wider">
                      {r.orientation === 'portrait' ? 'Portrait' : 'Landscape'}
                    </Badge>
                    <Badge variant="outline" className="text-xs uppercase tracking-wider">
                      {r.frequency}
                    </Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      {/* Footer info */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <p>
            <strong className="text-foreground">Como gerar PDF:</strong> abra o relatório, clique em
            "Imprimir" (canto superior). O navegador abre o diálogo de impressão — escolha "Salvar como PDF".
            As margens, headers e footers já estão calibrados para A4.
          </p>
          <p>
            <strong className="text-foreground">Próximos passos:</strong> conectar dados reais aos templates
            (orders, order_stages, order_costs, defect_records). Adicionar mais relatórios sob demanda
            reaproveitando o <code>A4Layout</code> (PaperShell / A4Head / A4Foot / Sigs / PrintBar).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
