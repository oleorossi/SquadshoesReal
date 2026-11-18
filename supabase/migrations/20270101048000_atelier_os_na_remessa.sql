-- Fase 2. O clique de envio abre UMA ordem de serviço por prestador
-- por remessa, com um item por job. O preço é a tarifa vigente, travada
-- na linha. Interno não vira OS. O kit fechado só habilita o clique:
-- a função recusa se atelier_lot_kit_is_closed for falso, e a baixa do
-- kit continua em atelier_confirm_lot_release (idempotente, mig 47800).
-- Não gera conta a pagar.

ALTER TABLE public.service_order_items
  ADD COLUMN IF NOT EXISTS atelier_job_id uuid REFERENCES public.cabedal_prep_jobs(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_order_items_atelier_job
  ON public.service_order_items (atelier_job_id);

COMMENT ON COLUMN public.service_order_items.atelier_job_id IS
  'Job do Ateliê desta linha. Um job, uma linha. O preço fica travado em unit_price.';

CREATE OR REPLACE FUNCTION public.atelier_rate_sector(p_sector text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_sector
    WHEN 'costura_cabedal' THEN 'costura'
    WHEN 'aviamento' THEN 'mesa'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.atelier_rate_sector(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_rate_sector(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_rate_sector(text) IS
  'Setor da tarifa do prestador. Aviamento do Ateliê lê a tarifa mesa. Espelho de ATELIER_RATE_SECTOR.';

CREATE OR REPLACE FUNCTION public.atelier_attach_job_line(
  p_service_order_id uuid,
  p_job_id uuid,
  p_contractor_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_sector text;
  v_price numeric;
  v_order text;
BEGIN
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.execution_mode = 'internal' THEN
    RAISE EXCEPTION 'Job interno não entra em ordem de serviço' USING ERRCODE = '22023';
  END IF;

  v_sector := public.atelier_rate_sector(v_job.sector);
  v_price := public.get_contractor_rate(p_contractor_id, v_sector, CURRENT_DATE);
  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'Cadastre a tarifa vigente de % deste prestador antes de enviar',
      COALESCE(v_sector, v_job.sector)
      USING ERRCODE = '22023';
  END IF;

  SELECT so.order_number INTO v_order
    FROM public.sale_orders so
   WHERE so.id = v_job.sale_order_id;

  INSERT INTO public.service_order_items (
    service_order_id, atelier_job_id, source_item_key,
    material_name, description, sale_order_id, color,
    target_sector, sector, quantity, unit, unit_price, total_value,
    line_status, sent_at
  ) VALUES (
    p_service_order_id,
    v_job.id,
    'atelier:' || v_job.id::text,
    COALESCE(NULLIF(btrim(v_job.reference_code), ''), 'Ateliê'),
    trim(both ' · ' FROM concat_ws(' · ',
      CASE v_job.sector WHEN 'costura_cabedal' THEN 'Costura' WHEN 'aviamento' THEN 'Aviamento' ELSE v_job.sector END,
      NULLIF(btrim(v_job.color), ''),
      NULLIF(btrim(v_order), '')
    )),
    v_job.sale_order_id,
    NULLIF(btrim(v_job.color), ''),
    v_sector,
    v_sector,
    v_job.pairs,
    'par',
    v_price,
    v_job.pairs * v_price,
    'Pendente',
    now()
  )
  ON CONFLICT (atelier_job_id) DO NOTHING;

  RETURN v_price;
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_attach_job_line(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_attach_job_line(uuid, uuid, uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.atelier_mark_job_sent(uuid, uuid);

CREATE OR REPLACE FUNCTION public.atelier_mark_job_sent(
  p_job_id uuid,
  p_contractor_id uuid DEFAULT NULL,
  p_service_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_num text;
  v_kit jsonb := '[]'::jsonb;
  v_lot_number text;
  v_contractor uuid;
  v_os uuid;
  v_os_number text;
  v_price numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.execution_mode = 'internal' THEN
    RAISE EXCEPTION 'Este job é interno — use Em realização / Concluído' USING ERRCODE = '22023';
  END IF;
  IF v_job.pipeline_status NOT IN ('cut', 'sent_to_contractor') THEN
    RAISE EXCEPTION 'Corte o lote antes do envio (status=%)', v_job.pipeline_status
      USING ERRCODE = '22023';
  END IF;

  v_contractor := COALESCE(p_contractor_id, v_job.contractor_id);
  IF v_contractor IS NULL THEN
    RAISE EXCEPTION 'Escolha o prestador' USING ERRCODE = '22023';
  END IF;
  IF NOT public.atelier_contractor_can_take(v_contractor, v_job.sector) THEN
    RAISE EXCEPTION 'Este prestador não atende este setor' USING ERRCODE = '22023';
  END IF;

  IF v_job.service_order_id IS NOT NULL
     AND p_service_order_id IS NOT NULL
     AND v_job.service_order_id IS DISTINCT FROM p_service_order_id THEN
    RAISE EXCEPTION 'Este job já está numa remessa' USING ERRCODE = '22023';
  END IF;

  IF v_job.lot_id IS NOT NULL THEN
    SELECT lot_number INTO v_lot_number FROM public.atelier_lots WHERE id = v_job.lot_id;
    IF NOT public.atelier_lot_kit_is_closed(v_job.lot_id) THEN
      RAISE EXCEPTION 'Lote % ainda não fechou o kit. O envio espera o corte sem falta e os componentes prontos',
        COALESCE(v_lot_number, '')
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.atelier_lot_release_lines(v_job.lot_id)) THEN
      PERFORM public.atelier_confirm_lot_release(v_job.lot_id);
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'product_id', d.product_id,
             'product_name', p.name,
             'unit', p.unit,
             'component', d.component,
             'quantity', d.quantity,
             'required_qty', d.required_qty,
             'pending_qty', d.pending_qty
           )
           ORDER BY p.name
         ), '[]'::jsonb)
    INTO v_kit
    FROM public.cabedal_prep_stock_debits d
    JOIN public.products p ON p.id = d.product_id
   WHERE d.lot_id = v_job.lot_id
     AND COALESCE(d.quantity, 0) > 0;

  v_num := COALESCE(v_job.atelier_service_number, public.next_atelier_service_number());
  v_os := COALESCE(p_service_order_id, v_job.service_order_id);

  IF v_os IS NULL THEN
    INSERT INTO public.service_orders (
      contractor_id, status, service_date, description, notes,
      dispatch_tracked, quantity, unit_price, total_value,
      service_order_domain, material_requirements,
      selected_sale_order_item_ids, linked_sale_order_ids
    ) VALUES (
      v_contractor,
      'Em Andamento',
      CURRENT_DATE,
      'Remessa do Ateliê',
      'Criada no clique de envio.',
      true,
      0,
      0,
      0,
      'generic',
      '{}'::jsonb,
      CASE WHEN v_job.sale_order_item_id IS NULL THEN NULL
           ELSE ARRAY[v_job.sale_order_item_id] END,
      CASE WHEN v_job.sale_order_id IS NULL THEN NULL
           ELSE ARRAY[v_job.sale_order_id] END
    )
    RETURNING id, order_number INTO v_os, v_os_number;
  ELSE
    SELECT order_number INTO v_os_number FROM public.service_orders WHERE id = v_os;
  END IF;

  v_price := public.atelier_attach_job_line(v_os, v_job.id, v_contractor);

  UPDATE public.service_orders so
     SET quantity = src.qty,
         total_value = src.total,
         unit_price = CASE WHEN src.qty > 0 THEN round(src.total / src.qty, 4) ELSE 0 END,
         selected_sale_order_item_ids = src.items,
         linked_sale_order_ids = src.orders,
         updated_at = now()
    FROM (
      SELECT
        COALESCE(SUM(i.quantity), 0) AS qty,
        COALESCE(SUM(i.total_value), 0) AS total,
        array_remove(array_agg(DISTINCT j.sale_order_item_id), NULL) AS items,
        array_remove(array_agg(DISTINCT j.sale_order_id), NULL) AS orders
      FROM public.service_order_items i
      JOIN public.cabedal_prep_jobs j ON j.id = i.atelier_job_id
      WHERE i.service_order_id = v_os
    ) src
   WHERE so.id = v_os;

  UPDATE public.cabedal_prep_jobs
     SET pipeline_status = 'sent_to_contractor',
         execution_mode = 'contractor',
         sent_at = COALESCE(sent_at, now()),
         contractor_id = v_contractor,
         atelier_service_number = v_num,
         sent_kit_lines = v_kit,
         service_order_id = v_os,
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'atelier_service_number', v_num,
    'kit_lines', v_kit,
    'service_order_id', v_os,
    'order_number', v_os_number,
    'unit_price', v_price
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_mark_job_sent(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_mark_job_sent(uuid, uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_send_shipment(
  p_job_ids uuid[],
  p_contractor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_os uuid;
  v_os_number text;
  v_count int := 0;
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_contractor_id IS NULL THEN
    RAISE EXCEPTION 'Escolha o prestador' USING ERRCODE = '22023';
  END IF;
  IF p_job_ids IS NULL OR cardinality(p_job_ids) = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um job' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY p_job_ids LOOP
    SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
    END IF;
    IF v_job.execution_mode = 'internal' THEN
      RAISE EXCEPTION 'Job interno não entra em ordem de serviço' USING ERRCODE = '22023';
    END IF;
    IF v_job.pipeline_status <> 'cut' THEN
      RAISE EXCEPTION 'A remessa só leva job cortado que ainda não foi enviado'
        USING ERRCODE = '22023';
    END IF;
    IF v_job.service_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'Este job já está numa remessa' USING ERRCODE = '22023';
    END IF;
    IF NOT public.atelier_contractor_can_take(p_contractor_id, v_job.sector) THEN
      RAISE EXCEPTION 'Este prestador não atende este setor' USING ERRCODE = '22023';
    END IF;
    IF v_job.lot_id IS NOT NULL AND NOT public.atelier_lot_kit_is_closed(v_job.lot_id) THEN
      RAISE EXCEPTION 'O kit ainda não fechou. O botão de envio espera isso'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO public.service_orders (
    contractor_id, status, service_date, description, notes,
    dispatch_tracked, quantity, unit_price, total_value,
    service_order_domain, material_requirements
  ) VALUES (
    p_contractor_id,
    'Em Andamento',
    CURRENT_DATE,
    'Remessa do Ateliê',
    'Uma OS para os jobs enviados juntos neste clique.',
    true,
    0, 0, 0,
    'generic',
    '{}'::jsonb
  )
  RETURNING id, order_number INTO v_os, v_os_number;

  FOREACH v_id IN ARRAY p_job_ids LOOP
    v_result := public.atelier_mark_job_sent(v_id, p_contractor_id, v_os);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'service_order_id', v_os,
    'order_number', v_os_number,
    'jobs', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_send_shipment(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_send_shipment(uuid[], uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_send_shipment(uuid[], uuid) IS
  'Clique de envio. Uma OS, um item por job. Não envia sozinho quando o kit fecha.';

-- A fila lê kit_closed da função única e o id da OS para imprimir.
DO $patch_list$
DECLARE
  v_def text;
  v_gate text := $o$'dispatch_signal', l.dispatch_signal,$o$;
  v_gate_new text := $n$'dispatch_signal', l.dispatch_signal, 'kit_closed', public.atelier_lot_kit_is_closed(l.id),$n$;
  v_job text := $o$'received_pairs', COALESCE(j.received_pairs, 0),$o$;
  v_job_new text := $n$'received_pairs', COALESCE(j.received_pairs, 0), 'service_order_id', j.service_order_id,$n$;
BEGIN
  SELECT pg_get_functiondef('public.list_atelier_lots()'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'list_atelier_lots() não encontrada';
  END IF;
  IF strpos(v_def, 'kit_closed') = 0 THEN
    IF strpos(v_def, v_gate) = 0 THEN
      RAISE EXCEPTION 'list_atelier_lots sem dispatch_signal para expor kit_closed';
    END IF;
    v_def := replace(v_def, v_gate, v_gate_new);
  END IF;
  IF strpos(v_def, 'service_order_id') = 0 THEN
    IF strpos(v_def, v_job) = 0 THEN
      RAISE EXCEPTION 'list_atelier_lots sem received_pairs para expor a OS';
    END IF;
    v_def := replace(v_def, v_job, v_job_new);
  END IF;
  EXECUTE v_def;
END
$patch_list$;
