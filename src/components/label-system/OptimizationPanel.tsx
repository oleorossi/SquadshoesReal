import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Sparkle as Sparkles, ArrowsClockwise as RefreshCw, Lightning as Zap, CheckCircle as CheckCircle2, Warning as AlertTriangle, Info, CircleNotch as Loader2, Layout, Gauge, CurrencyDollar as DollarSign, ShieldCheck } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { LabelTemplate } from '@/types/label-system';
import { analyzeTemplate, autoOptimize, type OptimizationResult, type OptimizationSuggestion } from '@/services/label-optimization';

const PRIORITY_CONFIG: Record<string, { color: string; label: string }> = {
  high: { color: 'text-destructive', label: 'Alta' },
  medium: { color: 'text-amber-500', label: 'Média' },
  low: { color: 'text-muted-foreground', label: 'Baixa' },
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  layout: <Layout className="h-4 w-4" />,
  performance: <Gauge className="h-4 w-4" />,
  cost: <DollarSign className="h-4 w-4" />,
  quality: <ShieldCheck className="h-4 w-4" />,
};

interface OptimizationPanelProps {
  template: LabelTemplate;
  onApply: (updated: LabelTemplate) => void;
}

export function OptimizationPanel({ template, onApply }: OptimizationPanelProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<OptimizationResult | null>(null);

  const runAnalysis = () => {
    setIsAnalyzing(true);
    // Simulate async for UX
    setTimeout(() => {
      setResult(analyzeTemplate(template));
      setIsAnalyzing(false);
    }, 600);
  };

  const handleApplySuggestion = (suggestion: OptimizationSuggestion) => {
    if (!suggestion.apply) {
      toast.info('Esta sugestão requer ajuste manual');
      return;
    }
    const updated = suggestion.apply(template);
    onApply(updated);
    setResult(analyzeTemplate(updated));
    toast.success(`Aplicado: ${suggestion.title}`);
  };

  const handleAutoOptimize = () => {
    const { template: optimized, applied } = autoOptimize(template);
    if (applied.length === 0) {
      toast.info('Nenhuma otimização automática disponível');
      return;
    }
    onApply(optimized);
    setResult(analyzeTemplate(optimized));
    toast.success(`${applied.length} otimização(ões) aplicada(s)`);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-foreground text-sm">Otimização de Etiquetas</h3>
          <p className="text-xs text-muted-foreground">Análise automática e sugestões de melhoria</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={runAnalysis} disabled={isAnalyzing} className="gap-1.5">
            {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Analisar
          </Button>
          <Button size="sm" onClick={handleAutoOptimize} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Auto-Otimizar
          </Button>
        </div>
      </div>

      {result ? (
        <>
          {/* Score cards */}
          <div className="grid grid-cols-5 gap-2">
            {([
              { key: 'overall', label: 'Geral', icon: <Sparkles className="h-3.5 w-3.5" /> },
              { key: 'layout', label: 'Layout', icon: <Layout className="h-3.5 w-3.5" /> },
              { key: 'performance', label: 'Performance', icon: <Gauge className="h-3.5 w-3.5" /> },
              { key: 'cost', label: 'Custo', icon: <DollarSign className="h-3.5 w-3.5" /> },
              { key: 'quality', label: 'Qualidade', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
            ] as const).map(item => {
              const score = result.scores[item.key];
              return (
                <Card key={item.key} className={item.key === 'overall' ? 'border-primary/30' : ''}>
                  <CardContent className="py-3 px-2 text-center">
                    <div className="flex items-center justify-center gap-1 mb-1 text-muted-foreground">{item.icon}<span className="text-[10px]">{item.label}</span></div>
                    <div className={`text-lg font-bold ${score >= 80 ? 'text-green-600' : score >= 50 ? 'text-amber-500' : 'text-destructive'}`}>
                      {score}%
                    </div>
                    <Progress value={score} className="h-1 mt-1" />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Savings summary */}
          {(result.estimated_cost_savings_pct > 0 || result.estimated_speed_improvement_pct > 0) && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-3 flex items-center gap-4 text-sm">
                <Zap className="h-4 w-4 text-primary shrink-0" />
                <div className="flex gap-4">
                  {result.estimated_cost_savings_pct > 0 && (
                    <span>Economia potencial: <strong>~{result.estimated_cost_savings_pct}%</strong> em material</span>
                  )}
                  {result.estimated_speed_improvement_pct > 0 && (
                    <span>Velocidade: <strong>+{result.estimated_speed_improvement_pct}%</strong> mais rápido</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Suggestions */}
          {result.suggestions.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                Template otimizado! Nenhuma sugestão pendente.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {result.suggestions.map(s => {
                const pc = PRIORITY_CONFIG[s.priority];
                return (
                  <Card key={s.id}>
                    <CardContent className="py-3 flex items-start gap-3">
                      <span className={`mt-0.5 shrink-0 ${pc.color}`}>
                        {s.priority === 'high' ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                      </span>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-foreground">{s.title}</span>
                          <Badge variant="outline" className="text-[10px] gap-1">{TYPE_ICON[s.type]} {s.type}</Badge>
                          <Badge variant={s.priority === 'high' ? 'destructive' : 'secondary'} className="text-[10px]">{pc.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{s.description}</p>
                        <p className="text-xs text-primary">{s.impact}</p>
                      </div>
                      {s.apply && (
                        <Button size="sm" variant="outline" onClick={() => handleApplySuggestion(s)} className="shrink-0 gap-1">
                          <Zap className="h-3 w-3" /> Aplicar
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>Execute uma análise para identificar oportunidades de melhoria</p>
            <Button variant="outline" className="mt-4 gap-1.5" onClick={runAnalysis}>
              <RefreshCw className="h-3.5 w-3.5" /> Iniciar Análise
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
