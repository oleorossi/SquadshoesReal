/**
 * Paleta categórica ÚNICA para gráficos (recharts).
 *
 * Fonte de verdade das cores: tokens `--chart-1..--chart-8` de src/index.css
 * (:root e .dark) — acompanham o tema automaticamente, ao contrário dos hex
 * fixos que existiam espalhados em 5 paletas rivais (PCPDashboard, Reports,
 * SystemMonitor, FinanceReportsTab, CostAnalyticsPanel).
 *
 * A ordem é pensada pra daltonismo: séries vizinhas alternam quente/frio e
 * NUNCA formam par verde/vermelho (o verde fica no slot 7, longe do vermelho
 * do slot 1).
 *
 * ⚠ NUNCA montar gráfico com --primary e --destructive como séries
 * distintas: são a MESMA cor (347 71% 50%) — barras e swatches de legenda
 * saem idênticos. Pra séries categóricas, use sempre esta paleta.
 */
export const CHART_COLORS = [
  'hsl(var(--chart-1))', // vermelho Squad — série principal
  'hsl(var(--chart-2))', // azul (stage-cut-fg)
  'hsl(var(--chart-3))', // laranja (stage-assy-fg)
  'hsl(var(--chart-4))', // roxo (stage-sew-fg)
  'hsl(var(--chart-5))', // teal (stage-fin-fg)
  'hsl(var(--chart-6))', // dourado
  'hsl(var(--chart-7))', // verde médio (não usar --success: some no dark)
  'hsl(var(--chart-8))', // cinza neutro — série "outros"
];
