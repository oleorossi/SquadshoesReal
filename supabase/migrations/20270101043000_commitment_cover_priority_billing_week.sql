-- =============================================================================
-- Prioridade de rateio = semana de faturamento (sem bump de Ateliê)
--
-- Decisão do dono (Relatório de Pendência): na disputa entre PVs pela mesma
-- entrada de estoque, ordenar de cima pra baixo pela data de faturamento mais
-- próxima. Tela e banco precisam da MESMA ordem — senão a disputa mente.
--
-- Antes: Ateliê (+0) furava a fila de qualquer PV sem Ateliê (+100000000),
-- depois vinha billing_week / delivery_deadline / created_at.
-- Agora: score = epoch do 1º dia de billing_week; fallback delivery_deadline;
-- senão created_at. Menor score = maior prioridade (inalterado).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.commitment_cover_priority(p_sale_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing date;
  v_delivery date;
  v_created timestamptz;
  v_score numeric;
BEGIN
  IF p_sale_order_id IS NULL THEN
    RETURN 9000000000;
  END IF;

  v_billing := public.resolve_billing_week_for_order(p_sale_order_id);

  SELECT so.delivery_deadline, so.created_at
    INTO v_delivery, v_created
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id;

  -- Menor score = maior prioridade.
  -- Sem bump de Ateliê: a disputa e o rateio seguem só o faturamento.
  v_score := CASE
    WHEN v_billing IS NOT NULL THEN EXTRACT(EPOCH FROM v_billing::timestamp)::numeric
    WHEN v_delivery IS NOT NULL THEN 2000000000 + EXTRACT(EPOCH FROM v_delivery::timestamp)::numeric
    ELSE 4000000000 + EXTRACT(EPOCH FROM COALESCE(v_created, now()))::numeric
  END;

  RETURN v_score;
END;
$$;

COMMENT ON FUNCTION public.commitment_cover_priority(uuid) IS
  'Prioridade de rateio/cover: 1º dia da semana de faturamento, depois prazo de entrega, depois criação. Sem bump de Ateliê (Relatório de Pendência).';

GRANT EXECUTE ON FUNCTION public.commitment_cover_priority(uuid) TO authenticated, service_role;
