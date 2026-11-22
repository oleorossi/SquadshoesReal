-- Preço da OS do Ateliê: tarifa da ficha com o prestador, depois a do
-- serviço, depois a sugestão da ficha. A transação termina em RAISE
-- EXCEPTION. Não altera PV-00249, PV-00250 nem LOTE-00004, nem o padrão
-- de uma ficha que já existe.

BEGIN;

CREATE TEMP TABLE atelie_preco_report (
  check_name text,
  ok boolean,
  detail text
);

DO $teste_atelie_preco$
DECLARE
  v_contractor uuid := gen_random_uuid();
  v_sheet uuid;
  v_ref_rate uuid := gen_random_uuid();
  v_sector_rate uuid := gen_random_uuid();
  v_stamp_249 text;
  v_stamp_250 text;
  v_stamp_lote text;
  v_price numeric;
  v_source text;
BEGIN
  SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
    INTO v_stamp_249
    FROM public.sale_orders WHERE order_number = 'PV-00249'
   ORDER BY created_at DESC LIMIT 1;
  SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
    INTO v_stamp_250
    FROM public.sale_orders WHERE order_number = 'PV-00250'
   ORDER BY created_at DESC LIMIT 1;
  SELECT coalesce(status, '') || '|' || coalesce(updated_at::text, '')
    INTO v_stamp_lote
    FROM public.atelier_lots WHERE lot_number = 'LOTE-00004' LIMIT 1;

  SELECT ts.id INTO v_sheet
    FROM public.technical_sheets ts
   WHERE NOT EXISTS (
     SELECT 1 FROM public.atelier_complex_references a
      WHERE a.reference_id = ts.id AND a.sector = 'costura_cabedal'
   )
   LIMIT 1;
  IF v_sheet IS NULL THEN
    RAISE EXCEPTION 'sem ficha livre para o teste do preço; não vou sobrescrever uma ficha cadastrada';
  END IF;

  PERFORM set_config('session_replication_role', 'replica', true);

  INSERT INTO public.contractors (id, name, payment_days)
  VALUES (v_contractor, 'TESTE PRECO ATELIE — apagar', 30);

  INSERT INTO public.contractor_reference_rates (
    id, contractor_id, technical_sheet_id, sector, price_per_pair, valid_from
  ) VALUES (
    v_ref_rate, v_contractor, v_sheet, 'costura', 11.50, CURRENT_DATE
  );

  INSERT INTO public.contractor_service_rates (
    id, contractor_id, sector, price_per_pair, valid_from
  ) VALUES (
    v_sector_rate, v_contractor, 'costura', 7.00, CURRENT_DATE
  );

  INSERT INTO public.atelier_complex_references (
    reference_id, sector, active, value_per_pair
  ) VALUES (
    v_sheet, 'costura_cabedal', true, 4.25
  );

  PERFORM set_config('session_replication_role', 'origin', true);

  SELECT s.price, s.source INTO v_price, v_source
    FROM public.atelier_suggested_pair_price(v_contractor, 'costura_cabedal', v_sheet, CURRENT_DATE) s
   LIMIT 1;
  INSERT INTO atelie_preco_report VALUES (
    'vence a tarifa da ficha com o prestador',
    v_price = 11.50 AND v_source = 'referencia',
    format('price=%s source=%s', v_price, v_source)
  );

  UPDATE public.contractor_reference_rates
     SET valid_to = CURRENT_DATE - 1
   WHERE id = v_ref_rate;

  SELECT s.price, s.source INTO v_price, v_source
    FROM public.atelier_suggested_pair_price(v_contractor, 'costura_cabedal', v_sheet, CURRENT_DATE) s
   LIMIT 1;
  INSERT INTO atelie_preco_report VALUES (
    'sem a ficha, vence o serviço',
    v_price = 7.00 AND v_source = 'setor',
    format('price=%s source=%s', v_price, v_source)
  );

  UPDATE public.contractor_service_rates
     SET valid_to = CURRENT_DATE - 1
   WHERE id = v_sector_rate;

  SELECT s.price, s.source INTO v_price, v_source
    FROM public.atelier_suggested_pair_price(v_contractor, 'costura_cabedal', v_sheet, CURRENT_DATE) s
   LIMIT 1;
  INSERT INTO atelie_preco_report VALUES (
    'sem tarifa, fica a sugestão da ficha',
    v_price = 4.25 AND v_source = 'ficha',
    format('price=%s source=%s', v_price, v_source)
  );

  IF (SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
        FROM public.sale_orders WHERE order_number = 'PV-00249'
       ORDER BY created_at DESC LIMIT 1) IS DISTINCT FROM v_stamp_249
     OR (SELECT coalesce(status, '') || '|' || coalesce(deleted_at::text, '')
           FROM public.sale_orders WHERE order_number = 'PV-00250'
          ORDER BY created_at DESC LIMIT 1) IS DISTINCT FROM v_stamp_250
     OR (SELECT coalesce(status, '') || '|' || coalesce(updated_at::text, '')
           FROM public.atelier_lots WHERE lot_number = 'LOTE-00004' LIMIT 1) IS DISTINCT FROM v_stamp_lote
  THEN
    RAISE EXCEPTION 'PV-00249, PV-00250 ou LOTE-00004 mudou de carimbo';
  END IF;
END;
$teste_atelie_preco$;

SELECT check_name, ok, detail FROM atelie_preco_report ORDER BY check_name;

DO $rollback_atelie_preco$
BEGIN
  IF EXISTS (SELECT 1 FROM atelie_preco_report WHERE NOT ok) THEN
    RAISE EXCEPTION 'teste do preço do ateliê falhou — veja atelie_preco_report';
  END IF;
  RAISE EXCEPTION 'rollback teste atelie preco';
END;
$rollback_atelie_preco$;
