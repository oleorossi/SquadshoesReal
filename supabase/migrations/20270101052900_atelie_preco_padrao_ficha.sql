-- atelie_preco_padrao_ficha_20270101052900
--
-- O preço sugerido da OS continua: tarifa da ficha com o prestador,
-- depois a tarifa do serviço. Se nenhuma das duas existe, entra a
-- sugestão já gravada na ficha de ateliê. Quem negocia o pedido grava
-- o valor na OS; esta função não altera o padrão.

CREATE OR REPLACE FUNCTION public.atelier_suggested_pair_price(
  p_contractor_id uuid,
  p_sector text,
  p_sheet_id uuid,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(price numeric, source text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (
    SELECT r.price_per_pair, 'referencia'::text
      FROM public.contractor_reference_rates r
     WHERE r.contractor_id = p_contractor_id
       AND r.technical_sheet_id = p_sheet_id
       AND lower(r.sector) = lower(COALESCE(public.atelier_rate_sector(p_sector), p_sector))
       AND r.valid_from <= p_date
       AND (r.valid_to IS NULL OR r.valid_to >= p_date)
     ORDER BY r.valid_from DESC
     LIMIT 1
  )
  UNION ALL
  (
    SELECT public.get_contractor_rate(
             p_contractor_id,
             COALESCE(public.atelier_rate_sector(p_sector), p_sector),
             p_date
           ),
           'setor'::text
     WHERE public.get_contractor_rate(
             p_contractor_id,
             COALESCE(public.atelier_rate_sector(p_sector), p_sector),
             p_date
           ) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.contractor_reference_rates r
          WHERE r.contractor_id = p_contractor_id
            AND r.technical_sheet_id = p_sheet_id
            AND lower(r.sector) = lower(COALESCE(public.atelier_rate_sector(p_sector), p_sector))
            AND r.valid_from <= p_date
            AND (r.valid_to IS NULL OR r.valid_to >= p_date)
       )
  )
  UNION ALL
  (
    SELECT a.value_per_pair, 'ficha'::text
      FROM public.atelier_complex_references a
     WHERE a.reference_id = p_sheet_id
       AND a.sector = p_sector
       AND a.active
       AND a.value_per_pair > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.contractor_reference_rates r
          WHERE r.contractor_id = p_contractor_id
            AND r.technical_sheet_id = p_sheet_id
            AND lower(r.sector) = lower(COALESCE(public.atelier_rate_sector(p_sector), p_sector))
            AND r.valid_from <= p_date
            AND (r.valid_to IS NULL OR r.valid_to >= p_date)
       )
       AND COALESCE(public.get_contractor_rate(
             p_contractor_id,
             COALESCE(public.atelier_rate_sector(p_sector), p_sector),
             p_date
           ), 0) <= 0
     LIMIT 1
  );
$$;
