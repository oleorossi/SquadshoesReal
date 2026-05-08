-- =============================================================================
-- FIX 2 bugs latentes que bloqueavam calculate_order_cost em produção
-- =============================================================================
-- Bug A — order_costs sem coluna packaging_cost
--   A função calculate_order_cost faz INSERT em order_costs incluindo
--   packaging_cost, mas a tabela não tinha essa coluna. Erro silente:
--   "column packaging_cost of relation order_costs does not exist".
--   Adiciona coluna com DEFAULT 0 (todos os snapshots antigos viram 0).
--
-- Bug B — resolve_upper_material_for_variant: integer vs numeric
--   A função foi criada com (uuid, text, text, NUMERIC) na 20260510170000,
--   mas calculate_order_consumption_by_grade chama com integer no 4º arg
--   em algum caminho. Postgres não casta integer→numeric em function lookup
--   sob algumas condições. Criar overload (uuid, text, text, integer) que
--   delega pra versão numeric resolve.
-- =============================================================================

-- ── Bug A ──
ALTER TABLE public.order_costs
  ADD COLUMN IF NOT EXISTS packaging_cost numeric DEFAULT 0 NOT NULL;

COMMENT ON COLUMN public.order_costs.packaging_cost IS
  'Custo de embalagem por par × qty (cost_policies.packaging_cost_per_pair). '
  'Adicionada em audit-round-11 (bug latente: a função calculate_order_cost '
  'tentava inserir aqui mas a coluna não existia).';

-- ── Bug B ──
CREATE OR REPLACE FUNCTION public.resolve_upper_material_for_variant(
  p_variant_id  uuid,
  p_group_name  text,
  p_color       text,
  p_required    integer
) RETURNS TABLE (
  product_id    uuid,
  product_name  text,
  available_qty numeric,
  matched_by    text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT *
    FROM public.resolve_upper_material_for_variant(
           p_variant_id, p_group_name, p_color, p_required::numeric);
$$;

GRANT EXECUTE ON FUNCTION public.resolve_upper_material_for_variant(uuid, text, text, integer) TO authenticated;
