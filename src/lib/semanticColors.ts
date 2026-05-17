/**
 * Paleta semântica unificada.
 *
 * Antes deste arquivo, várias telas misturavam o uso de cores:
 *   - "Em Produção" aparecia em vermelho (cor de alerta) mesmo sem ser problema
 *   - "Forecast Mês Atual" aparecia em vermelho sem critério explícito
 *   - 104% e 173% de capacidade tinham o mesmo destaque (vermelho), perdendo
 *     a gradação entre "atenção" e "crítico"
 *
 * Padrão adotado:
 *
 *   ┌──────────────┬──────────────────────────────────────────────────────────┐
 *   │ tom semântico│ uso esperado                                             │
 *   ├──────────────┼──────────────────────────────────────────────────────────┤
 *   │ neutral      │ valor informativo, sem juízo de valor                    │
 *   │ info         │ atividade em andamento saudável (ex: "Em produção")      │
 *   │ success      │ conclusão positiva, dentro do esperado                   │
 *   │ warning      │ exige atenção, ainda dentro do controle (100–149%)       │
 *   │ critical     │ exige ação imediata, fora do controle (≥150%, atrasado) │
 *   └──────────────┴──────────────────────────────────────────────────────────┘
 *
 * O `tone` do <StatCard> e badges devem usar este vocabulário em vez de
 * "primary"/"destructive" diretamente — o significado fica explícito.
 */

export type SemanticTone = 'neutral' | 'info' | 'success' | 'warning' | 'critical';

/** Tom semântico → variant do tema (mapeia para tokens HSL do Tailwind). */
export const TONE_TO_VARIANT: Record<SemanticTone, string> = {
  neutral:  'default',
  info:     'primary',     // azul/carmim do tema, ativo mas neutro emocional
  success:  'success',     // verde
  warning:  'warning',     // âmbar/laranja
  critical: 'destructive', // vermelho
};

/**
 * Para barras de utilização (ex: capacidade de setor). Devolve o tom adequado
 * baseado em % — evita que 104% e 173% pareçam o mesmo problema.
 *
 * @example
 *   capacityTone(85)  → 'success'   // sub-utilizado, ok
 *   capacityTone(105) → 'warning'   // levemente sobrecarregado
 *   capacityTone(155) → 'critical'  // crítico, gargalo
 */
export function capacityTone(percent: number): SemanticTone {
  if (percent < 50)  return 'neutral';   // ocioso ou setor inativo
  if (percent < 95)  return 'success';   // dentro da capacidade
  if (percent < 110) return 'info';      // pleno, mas saudável
  if (percent < 150) return 'warning';   // atenção, programar overflow
  return 'critical';                     // gargalo claro
}

/**
 * Para variações vs. baseline (forecast vs. média histórica, faturamento vs.
 * meta, etc). Diferença pequena = neutral; grande diferença = info se positiva,
 * warning/critical se negativa.
 */
export function deltaTone(deltaPercent: number, opts?: { invert?: boolean }): SemanticTone {
  const sign = opts?.invert ? -1 : 1;
  const v = deltaPercent * sign;
  if (Math.abs(v) < 5) return 'neutral';
  if (v >= 5)          return 'success';
  if (v >= -15)        return 'warning';
  return 'critical';
}
