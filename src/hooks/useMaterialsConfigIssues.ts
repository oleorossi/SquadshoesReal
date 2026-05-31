import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Materiais com cadastro incompleto que prejudica o cálculo de
 * consumo/custeio. Tipos cobertos (ver migration v_materials_config_issues):
 *
 *   - missing_width: linear (m/cm) usado em fichas sem dimensions_width na
 *     ficha de componente. Sem isso, dm²→m linear não converte e o consumo
 *     infla ~100×. Severity: critical.
 *   - missing_conversion: purchase_unit ≠ unit sem conversion_rate. Entrada
 *     de NF entra com qty errada. Severity: critical.
 *   - zero_price: unit_price = 0 em material usado em fichas. Não afeta
 *     consumo mas zera o custeio. Severity: warning.
 *   - missing_yield: calculation_method='yield' sem yield_per_meter.
 *     Severity: critical.
 */
export interface MaterialConfigIssue {
  product_id: string;
  product_name: string;
  color: string | null;
  group_name: string | null;
  issue_type: 'missing_width' | 'missing_conversion' | 'zero_price' | 'missing_yield';
  severity: 'critical' | 'warning';
  description: string;
}

export function useMaterialsConfigIssues() {
  return useQuery<MaterialConfigIssue[]>({
    queryKey: ['materials_config_issues'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_materials_config_issues')
        .select('*');
      if (error) throw error;
      return (data || []) as MaterialConfigIssue[];
    },
    staleTime: 60_000,
  });
}

/**
 * Indexa as issues por product_id pra lookup O(1) ao renderizar a linha
 * de cada material. Um produto pode ter múltiplas issues simultâneas
 * (ex: zero_price + missing_width).
 */
export function useMaterialsConfigIssuesByProduct() {
  const query = useMaterialsConfigIssues();
  const byProduct = new Map<string, MaterialConfigIssue[]>();
  if (query.data) {
    for (const issue of query.data) {
      const existing = byProduct.get(issue.product_id) || [];
      existing.push(issue);
      byProduct.set(issue.product_id, existing);
    }
  }
  return { ...query, byProduct };
}

/** Label curto em PT-BR pra cada tipo de issue (usado no badge). */
export const ISSUE_LABELS: Record<MaterialConfigIssue['issue_type'], string> = {
  missing_width: 'sem largura',
  missing_conversion: 'sem conversão',
  zero_price: 'sem preço',
  missing_yield: 'sem rendimento',
};
