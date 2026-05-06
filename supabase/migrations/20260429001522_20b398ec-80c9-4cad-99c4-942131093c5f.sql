CREATE OR REPLACE FUNCTION public.cancel_wave(p_wave_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status::text INTO v_status FROM production_waves WHERE id = p_wave_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Onda não encontrada.';
  END IF;
  IF v_status NOT IN ('draft', 'planning') THEN
    RAISE EXCEPTION 'Apenas ondas em rascunho ou planejamento podem ser canceladas (status atual: %).', v_status;
  END IF;

  UPDATE production_waves
     SET status      = 'cancelled',
         finished_at = now(),
         updated_at  = now(),
         notes       = COALESCE(notes || E'\n', '') ||
                       '[CANCELADA ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] ' ||
                       COALESCE(p_reason, 'Sem motivo informado')
   WHERE id = p_wave_id;
END;
$$;

CREATE OR REPLACE VIEW public.v_wave_orders AS
SELECT
  wi.wave_id,
  wis.sale_order_id,
  so.order_number,
  so.delivery_deadline,
  so.status               AS order_status,
  c.razao_social          AS client_name,
  c.nome_fantasia         AS client_fantasy,
  COUNT(DISTINCT wis.id)                  AS source_count,
  COALESCE(SUM(wis.quantity), 0)::numeric AS total_pairs
FROM production_wave_item_sources wis
JOIN production_wave_items wi ON wi.id = wis.wave_item_id
LEFT JOIN sale_orders so ON so.id = wis.sale_order_id
LEFT JOIN clients c ON c.id = so.client_id
GROUP BY wi.wave_id, wis.sale_order_id, so.order_number, so.delivery_deadline,
         so.status, c.razao_social, c.nome_fantasia;

GRANT SELECT ON public.v_wave_orders TO authenticated;