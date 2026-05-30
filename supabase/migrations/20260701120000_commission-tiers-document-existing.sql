-- Comissões escalonadas (faixas) — paridade Tutor32, módulo 2.
--
-- A tabela commission_tiers e a RPC calculate_tiered_commission JÁ existem no banco
-- vivo (aplicadas anteriormente via MCP, batendo com src/integrations/supabase/types.ts),
-- mas não havia arquivo de migration rastreando-as — ficavam "fantasma" no repo.
-- Esta migration é IDEMPOTENTE (IF NOT EXISTS / CREATE OR REPLACE) e apenas documenta
-- o estado atual pra que setups limpos e o GitHub Action fiquem consistentes.

CREATE TABLE IF NOT EXISTS public.commission_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  min_value numeric NOT NULL DEFAULT 0,        -- início da faixa (R$ acumulado no período)
  max_value numeric,                            -- fim da faixa; NULL = sem teto
  commission_pct numeric NOT NULL,              -- alíquota da faixa
  trigger_event text NOT NULL DEFAULT 'faturamento', -- pedido | faturamento | liquidez
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_tiers_rep ON public.commission_tiers(representative_id);

ALTER TABLE public.commission_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view commission_tiers" ON public.commission_tiers;
CREATE POLICY "Auth users can view commission_tiers" ON public.commission_tiers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert commission_tiers" ON public.commission_tiers;
CREATE POLICY "Auth users can insert commission_tiers" ON public.commission_tiers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update commission_tiers" ON public.commission_tiers;
CREATE POLICY "Auth users can update commission_tiers" ON public.commission_tiers FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete commission_tiers" ON public.commission_tiers;
CREATE POLICY "Auth users can delete commission_tiers" ON public.commission_tiers FOR DELETE TO authenticated USING (true);

-- Cálculo PROGRESSIVO/MARGINAL: para cada faixa ativa do (rep, evento), soma
--   (LEAST(total, max) - min) * pct/100
-- Retorna o VALOR (R$) da comissão acumulada no período.
CREATE OR REPLACE FUNCTION public.calculate_tiered_commission(
  p_representative_id uuid,
  p_period_total numeric,
  p_trigger_event text DEFAULT 'faturamento'::text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_commission numeric := 0;
  v_tier RECORD;
  v_taxable numeric;
BEGIN
  FOR v_tier IN
    SELECT min_value, max_value, commission_pct
      FROM public.commission_tiers
     WHERE representative_id = p_representative_id
       AND trigger_event = p_trigger_event
       AND active = true
     ORDER BY min_value ASC
  LOOP
    IF p_period_total > v_tier.min_value THEN
      v_taxable := LEAST(p_period_total, COALESCE(v_tier.max_value, p_period_total)) - v_tier.min_value;
      v_total_commission := v_total_commission + (v_taxable * v_tier.commission_pct / 100);
    END IF;
  END LOOP;
  RETURN v_total_commission;
END;
$function$;
