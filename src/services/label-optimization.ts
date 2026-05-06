import type { LabelTemplate, LabelField } from '@/types/label-system';

export interface OptimizationSuggestion {
  id: string;
  type: 'layout' | 'performance' | 'cost' | 'quality';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  apply?: (template: LabelTemplate) => LabelTemplate;
}

export interface OptimizationResult {
  template_id: string;
  suggestions: OptimizationSuggestion[];
  scores: {
    layout: number;
    performance: number;
    cost: number;
    quality: number;
    overall: number;
  };
  estimated_cost_savings_pct: number;
  estimated_speed_improvement_pct: number;
}

/** Detect overlapping fields */
function detectOverlaps(fields: LabelField[]): [LabelField, LabelField][] {
  const pairs: [LabelField, LabelField][] = [];
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      const a = fields[i].position, b = fields[j].position;
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) {
        pairs.push([fields[i], fields[j]]);
      }
    }
  }
  return pairs;
}

/** Check alignment score (0-1) */
function alignmentScore(fields: LabelField[]): number {
  if (fields.length < 2) return 1;
  const xs = fields.map(f => f.position.x);
  const ys = fields.map(f => f.position.y);
  const uniqueX = new Set(xs).size;
  const uniqueY = new Set(ys).size;
  // fewer unique positions = better alignment
  const ratio = (uniqueX + uniqueY) / (fields.length * 2);
  return Math.max(0, 1 - ratio + 0.3);
}

/** Calculate wasted space ratio */
function wastedSpaceRatio(template: LabelTemplate): number {
  const totalArea = template.dimensions.width * template.dimensions.height;
  const usedArea = template.fields.reduce((a, f) => a + f.position.width * f.position.height, 0);
  return Math.max(0, 1 - usedArea / totalArea);
}

export function analyzeTemplate(template: LabelTemplate): OptimizationResult {
  const suggestions: OptimizationSuggestion[] = [];

  // Layout: overlaps
  const overlaps = detectOverlaps(template.fields);
  if (overlaps.length > 0) {
    suggestions.push({
      id: crypto.randomUUID(),
      type: 'layout',
      priority: 'high',
      title: 'Resolver Sobreposições',
      description: `${overlaps.length} par(es) de campos sobrepostos detectados. Isto pode causar problemas na impressão.`,
      impact: 'Evita campos ilegíveis',
      effort: 'low',
      apply: (t) => {
        const sorted = [...t.fields].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
        let lastBottom = 0;
        const adjusted = sorted.map(f => {
          const newY = Math.max(f.position.y, lastBottom + 1);
          lastBottom = newY + f.position.height;
          return { ...f, position: { ...f.position, y: newY } };
        });
        return { ...t, fields: adjusted, updated_at: new Date().toISOString() };
      },
    });
  }

  // Layout: alignment
  const aScore = alignmentScore(template.fields);
  if (aScore < 0.7 && template.fields.length >= 2) {
    suggestions.push({
      id: crypto.randomUUID(),
      type: 'layout',
      priority: 'medium',
      title: 'Melhorar Alinhamento',
      description: 'Alinhar campos em uma grade de 5mm para aparência mais profissional.',
      impact: 'Melhor legibilidade',
      effort: 'low',
      apply: (t) => ({
        ...t,
        fields: t.fields.map(f => ({
          ...f,
          position: {
            ...f.position,
            x: Math.round(f.position.x / 5) * 5,
            y: Math.round(f.position.y / 5) * 5,
          },
        })),
        updated_at: new Date().toISOString(),
      }),
    });
  }

  // Cost: wasted space
  const waste = wastedSpaceRatio(template);
  if (waste > 0.6 && template.fields.length > 0) {
    suggestions.push({
      id: crypto.randomUUID(),
      type: 'cost',
      priority: 'medium',
      title: 'Reduzir Tamanho da Etiqueta',
      description: `${Math.round(waste * 100)}% da etiqueta está vazia. Considere reduzir as dimensões.`,
      impact: `Economia de ~${Math.round(waste * 30)}% em material`,
      effort: 'medium',
    });
  }

  // Performance: barcode complexity
  const barcodes = template.fields.filter(f => f.type === 'barcode' || f.type === 'qr_code');
  if (barcodes.length > 2) {
    suggestions.push({
      id: crypto.randomUUID(),
      type: 'performance',
      priority: 'medium',
      title: 'Reduzir Códigos de Barras',
      description: `${barcodes.length} códigos na mesma etiqueta aumenta o tempo de impressão. Considere usar apenas 1-2.`,
      impact: 'Impressão 20-30% mais rápida',
      effort: 'medium',
    });
  }

  // Quality: font size too small
  const smallFonts = template.fields.filter(f => (f.type === 'text' || f.type === 'dynamic_text') && f.styling.font_size < 7);
  if (smallFonts.length > 0) {
    suggestions.push({
      id: crypto.randomUUID(),
      type: 'quality',
      priority: 'high',
      title: 'Aumentar Tamanho de Fonte',
      description: `${smallFonts.length} campo(s) com fonte menor que 7pt podem ser ilegíveis após impressão.`,
      impact: 'Melhor legibilidade',
      effort: 'low',
      apply: (t) => ({
        ...t,
        fields: t.fields.map(f =>
          (f.type === 'text' || f.type === 'dynamic_text') && f.styling.font_size < 7
            ? { ...f, styling: { ...f.styling, font_size: 8 } }
            : f
        ),
        updated_at: new Date().toISOString(),
      }),
    });
  }

  // Quality: no barcode
  if (barcodes.length === 0 && template.fields.length > 0) {
    suggestions.push({
      id: crypto.randomUUID(),
      type: 'quality',
      priority: 'low',
      title: 'Adicionar Código de Barras',
      description: 'Etiquetas sem código de barras dificultam rastreamento e leitura automática.',
      impact: 'Rastreabilidade',
      effort: 'low',
    });
  }

  // Calculate scores
  const layoutScore = Math.min(1, (overlaps.length === 0 ? 0.5 : 0) + (aScore > 0.7 ? 0.5 : aScore * 0.5));
  const perfScore = barcodes.length <= 2 ? 1 : 0.6;
  const costScore = waste < 0.5 ? 1 : 1 - waste;
  const qualityScore = smallFonts.length === 0 ? (barcodes.length > 0 ? 1 : 0.8) : 0.5;
  const overall = layoutScore * 0.3 + perfScore * 0.2 + costScore * 0.25 + qualityScore * 0.25;

  return {
    template_id: template.id,
    suggestions: suggestions.sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return p[a.priority] - p[b.priority];
    }),
    scores: {
      layout: Math.round(layoutScore * 100),
      performance: Math.round(perfScore * 100),
      cost: Math.round(costScore * 100),
      quality: Math.round(qualityScore * 100),
      overall: Math.round(overall * 100),
    },
    estimated_cost_savings_pct: Math.round(waste > 0.5 ? waste * 20 : 0),
    estimated_speed_improvement_pct: barcodes.length > 2 ? 25 : 0,
  };
}

/** Auto-optimize: apply all high-priority, low-effort suggestions */
export function autoOptimize(template: LabelTemplate): { template: LabelTemplate; applied: string[] } {
  const result = analyzeTemplate(template);
  let current = { ...template };
  const applied: string[] = [];

  for (const s of result.suggestions) {
    if (s.priority === 'high' && s.effort === 'low' && s.apply) {
      current = s.apply(current);
      applied.push(s.title);
    }
  }

  return { template: current, applied };
}
