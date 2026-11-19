-- Produção interna no Gerir envios.
-- A OS nasce sem prestador (internal_execution) e não gera conta a pagar,
-- mesmo que haja um custo interno gravado no R$/par. Um prestador "Fábrica"
-- entraria na lista e no financeiro. OS de prestador continua exigindo contractor_id.

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS internal_execution boolean NOT NULL DEFAULT false;

ALTER TABLE public.service_orders
  ALTER COLUMN contractor_id DROP NOT NULL;

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_contractor_or_internal;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_contractor_or_internal
  CHECK (
    (internal_execution AND contractor_id IS NULL)
    OR (NOT internal_execution AND contractor_id IS NOT NULL)
  );

COMMENT ON COLUMN public.service_orders.internal_execution IS
  'Ateliê feito na fábrica. Sem prestador e sem conta a pagar. O custo, se houver, fica no valor da OS.';

DO $patch_dispatch_internal$
DECLARE
  v_def text;
  v_old text := $old$  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de serviço não encontrada.'; END IF;

  SELECT * INTO v_contractor$old$;
  v_new text := $new$  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de serviço não encontrada.'; END IF;
  IF COALESCE(v_so.internal_execution, false) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_contractor$new$;
BEGIN
  SELECT pg_get_functiondef('public.tg_service_order_dispatch_preflight()'::regprocedure) INTO v_def;
  IF strpos(v_def, 'internal_execution') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei o preflight do despacho para a produção interna';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_dispatch_internal$;

DO $patch_emit_internal$
DECLARE
  v_def text;
  v_old text := $old$  IF NEW.artisanal_recipe_id IS NULL
     AND NEW.target_sector IS NOT NULL$old$;
  v_new text := $new$  IF COALESCE(NEW.internal_execution, false) THEN
    NEW.dispatch_tracked := true;
    RETURN NEW;
  END IF;
  IF NEW.artisanal_recipe_id IS NULL
     AND NEW.target_sector IS NOT NULL$new$;
BEGIN
  SELECT pg_get_functiondef('public.tg_service_order_enable_tracked_dispatch()'::regprocedure) INTO v_def;
  IF strpos(v_def, 'internal_execution') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei a emissão da OS para a produção interna';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_emit_internal$;

DO $patch_ap_internal$
DECLARE
  v_def text;
  v_old text := $old$  IF NOT FOUND OR NOT COALESCE(v_so.dispatch_tracked, false) OR COALESCE(NEW.qty_good, 0) <= 0 THEN
    RETURN NEW;
  END IF;$old$;
  v_new text := $new$  IF NOT FOUND OR COALESCE(v_so.internal_execution, false) OR NOT COALESCE(v_so.dispatch_tracked, false) OR COALESCE(NEW.qty_good, 0) <= 0 THEN
    RETURN NEW;
  END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.tg_ap_per_service_order_return()'::regprocedure) INTO v_def;
  IF strpos(v_def, 'internal_execution') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei a conta a pagar do retorno para pular a produção interna';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_ap_internal$;

DO $patch_post_internal$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.atelier_post_receipt_return(uuid)'::regprocedure) INTO v_def;
  IF strpos(v_def, 'internal_execution') = 0 THEN
    IF strpos(v_def, 'v_part.execution_mode = ''internal'' OR v_part.service_order_id IS NULL') = 0 THEN
      RAISE EXCEPTION 'não achei a saída da conferência interna';
    END IF;
    v_def := replace(
      v_def,
      'v_part.execution_mode = ''internal'' OR v_part.service_order_id IS NULL',
      'v_part.service_order_id IS NULL'
    );
    v_def := replace(
      v_def,
      'WHERE so.id = v_os AND COALESCE(c.payment_days, 30) < 999',
      'WHERE so.id = v_os AND NOT COALESCE(so.internal_execution, false) AND COALESCE(c.payment_days, 30) < 999'
    );
  END IF;
  IF strpos(v_def, 'NOT COALESCE(so.internal_execution, false)') = 0 THEN
    RAISE EXCEPTION 'a conferência interna ainda geraria conta a pagar';
  END IF;
  EXECUTE v_def;
END
$patch_post_internal$;


DROP FUNCTION IF EXISTS public.atelier_send_remessa(uuid, text, uuid, jsonb, numeric);
CREATE OR REPLACE FUNCTION public.atelier_send_remessa(
  p_lot_id uuid,
  p_sector text,
  p_contractor_id uuid,
  p_grade jsonb,
  p_unit_price numeric,
  p_internal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_qty int;
  v_left int;
  v_have int;
  v_take int;
  v_row record;
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_os uuid;
  v_os_number text;
  v_reused boolean := false;
  v_price numeric;
  v_suggested numeric;
  v_source text;
  v_edited boolean;
  v_part uuid;
  v_pairs int;
  v_grade jsonb;
  v_orders uuid[] := ARRAY[]::uuid[];
  v_items uuid[] := ARRAY[]::uuid[];
  v_part_ids uuid[] := ARRAY[]::uuid[];
  v_label text;
  v_lot text;
  v_order text;
  v_sector text;
  v_offset int;
  v_capacity int;
  v_due date;
  v_alloc int;
  v_sheet uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_internal, false) THEN
    p_contractor_id := NULL;
  ELSIF p_contractor_id IS NULL THEN
    RAISE EXCEPTION 'Escolha o prestador' USING ERRCODE = '22023';
  ELSIF NOT public.atelier_contractor_can_take(p_contractor_id, p_sector) THEN
    RAISE EXCEPTION 'Este prestador não atende este setor' USING ERRCODE = '22023';
  END IF;
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' THEN
    RAISE EXCEPTION 'Informe a grade da remessa' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS atelier_remessa_remain (
    ord int PRIMARY KEY,
    job_id uuid NOT NULL,
    remain jsonb NOT NULL
  ) ON COMMIT DROP;
  DELETE FROM atelier_remessa_remain;
  CREATE TEMP TABLE IF NOT EXISTS atelier_remessa_take (
    job_id uuid PRIMARY KEY,
    take jsonb NOT NULL
  ) ON COMMIT DROP;
  DELETE FROM atelier_remessa_take;

  PERFORM 1
    FROM public.cabedal_prep_jobs j
   WHERE j.lot_id = p_lot_id
     AND j.sector = p_sector
     AND j.pipeline_status IN ('cut', 'partially_sent')
     AND COALESCE(j.execution_mode, 'contractor') <> 'internal'
   ORDER BY j.created_at, j.id
   FOR UPDATE;

  INSERT INTO atelier_remessa_remain (ord, job_id, remain)
  SELECT row_number() OVER (ORDER BY j.created_at, j.id)::int,
         j.id,
         public.atelier_job_remaining_grade(j.id)
    FROM public.cabedal_prep_jobs j
   WHERE j.lot_id = p_lot_id
     AND j.sector = p_sector
     AND j.pipeline_status IN ('cut', 'partially_sent')
     AND COALESCE(j.execution_mode, 'contractor') <> 'internal';

  IF NOT EXISTS (SELECT 1 FROM atelier_remessa_remain) THEN
    RAISE EXCEPTION 'Este lote não tem saldo cortado para enviar nesta etapa' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cabedal_prep_jobs j
     WHERE j.lot_id = p_lot_id
       AND NOT public.atelier_lot_kit_is_closed(j.lot_id)
  ) THEN
    RAISE EXCEPTION 'O kit ainda não fechou. O envio espera isso' USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_qty IN
    SELECT g.key, trunc(COALESCE(NULLIF(g.value, '')::numeric, 0))::int
      FROM jsonb_each_text(p_grade) g
  LOOP
    IF v_qty < 0 OR (p_grade ->> v_key)::numeric <> trunc((p_grade ->> v_key)::numeric) THEN
      RAISE EXCEPTION 'A grade só aceita pares inteiros, sem fração e sem negativo' USING ERRCODE = '22023';
    END IF;
    IF v_qty = 0 THEN
      CONTINUE;
    END IF;
    v_left := v_qty;
    FOR v_row IN SELECT * FROM atelier_remessa_remain ORDER BY ord LOOP
      EXIT WHEN v_left <= 0;
      v_have := COALESCE((v_row.remain ->> v_key)::int, 0);
      v_take := LEAST(v_left, v_have);
      IF v_take <= 0 THEN
        CONTINUE;
      END IF;
      UPDATE atelier_remessa_remain
         SET remain = jsonb_set(remain, ARRAY[v_key], to_jsonb(v_have - v_take), true)
       WHERE job_id = v_row.job_id;
      INSERT INTO atelier_remessa_take (job_id, take)
      VALUES (v_row.job_id, jsonb_build_object(v_key, v_take))
      ON CONFLICT (job_id) DO UPDATE
        SET take = atelier_remessa_take.take || EXCLUDED.take;
      v_left := v_left - v_take;
    END LOOP;
    IF v_left > 0 THEN
      RAISE EXCEPTION 'O tamanho % passa do saldo', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM atelier_remessa_take) THEN
    RAISE EXCEPTION 'Informe ao menos 1 par' USING ERRCODE = '22023';
  END IF;

  SELECT so.id, so.order_number, so.unit_price
    INTO v_os, v_os_number, v_price
    FROM public.service_orders so
   WHERE so.accepting_shipments
     AND (
       (COALESCE(p_internal, false) AND so.internal_execution AND so.contractor_id IS NULL)
       OR (NOT COALESCE(p_internal, false) AND so.contractor_id = p_contractor_id AND NOT so.internal_execution)
     )
     AND public.normalize_service_order_status(so.status) NOT IN ('Concluído', 'Cancelado')
     AND EXISTS (
       SELECT 1
         FROM public.atelier_job_parts p
         JOIN public.cabedal_prep_jobs j ON j.id = p.job_id
        WHERE p.service_order_id = so.id
          AND j.lot_id = p_lot_id
          AND j.sector = p_sector
     )
   ORDER BY so.created_at, so.id
   LIMIT 1
   FOR UPDATE OF so;

  SELECT j.technical_sheet_id INTO v_sheet
    FROM public.cabedal_prep_jobs j
    JOIN atelier_remessa_take t ON t.job_id = j.id
   ORDER BY j.created_at, j.id
   LIMIT 1;

  IF NOT COALESCE(p_internal, false) THEN
    SELECT s.price, s.source INTO v_suggested, v_source
      FROM public.atelier_suggested_pair_price(p_contractor_id, p_sector, v_sheet, CURRENT_DATE) s
     LIMIT 1;
  END IF;

  IF v_os IS NULL THEN
    IF COALESCE(p_internal, false) THEN
      v_price := round(COALESCE(p_unit_price, 0), 2);
      IF v_price < 0 THEN
        RAISE EXCEPTION 'O custo interno não pode ser negativo' USING ERRCODE = '22023';
      END IF;
    ELSE
      v_price := round(COALESCE(p_unit_price, v_suggested), 2);
      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'Informe o R$/par deste prestador' USING ERRCODE = '22023';
      END IF;
      v_edited := v_suggested IS NULL OR round(v_suggested, 2) IS DISTINCT FROM v_price;
      IF v_edited AND NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
        RAISE EXCEPTION 'Só admin ou gerência altera o R$/par' USING ERRCODE = '42501';
      END IF;
    END IF;
    SELECT COALESCE(array_agg(DISTINCT j.sale_order_id), '{}'::uuid[]),
           COALESCE(array_agg(DISTINCT j.sale_order_item_id) FILTER (WHERE j.sale_order_item_id IS NOT NULL), '{}'::uuid[])
      INTO v_orders, v_items
      FROM public.cabedal_prep_jobs j
      JOIN atelier_remessa_take t ON t.job_id = j.id;
    INSERT INTO public.service_orders (
      contractor_id, status, service_date, description, notes,
      dispatch_tracked, quantity, unit_price, total_value,
      service_order_domain, material_requirements, is_avulsa,
      sale_order_id, source_sale_order_id,
      linked_sale_order_ids, selected_sale_order_item_ids,
      accepting_shipments, internal_execution
    ) VALUES (
      p_contractor_id, 'Em Andamento', CURRENT_DATE,
      CASE WHEN COALESCE(p_internal, false) THEN 'Produção interna do Ateliê' ELSE 'Remessa do Ateliê' END,
      CASE WHEN COALESCE(p_internal, false)
        THEN 'OS interna aberta. Não gera conta a pagar.'
        ELSE 'OS aberta para novas remessas deste lote e etapa.' END,
      true, 0, v_price, 0, 'generic', '{}'::jsonb, false,
      CASE WHEN cardinality(v_orders) = 1 THEN v_orders[1] ELSE NULL END,
      CASE WHEN cardinality(v_orders) = 1 THEN v_orders[1] ELSE NULL END,
      v_orders,
      CASE WHEN cardinality(v_items) = 0 THEN NULL ELSE v_items END,
      true, COALESCE(p_internal, false)
    )
    RETURNING id, order_number INTO v_os, v_os_number;
  ELSE
    v_reused := true;
    IF NOT COALESCE(p_internal, false) AND (v_price IS NULL OR v_price <= 0) THEN
      RAISE EXCEPTION 'A OS aberta não tem R$/par' USING ERRCODE = '22023';
    END IF;
    v_price := COALESCE(v_price, 0);
  END IF;

  SELECT l.lot_number INTO v_lot FROM public.atelier_lots l WHERE l.id = p_lot_id;
  v_sector := public.atelier_rate_sector(p_sector);
  v_label := CASE v_sector
    WHEN 'costura' THEN 'Costura de cabedal'
    WHEN 'mesa' THEN 'Aviamento'
    ELSE COALESCE(v_sector, p_sector)
  END;
  SELECT CASE WHEN p_sector = 'aviamento' THEN s.aviamento_offset_days ELSE s.costura_offset_days END
    INTO v_offset FROM public.atelier_settings s WHERE s.id = 1;
  v_offset := GREATEST(0, COALESCE(v_offset, 5));

  FOR v_row IN SELECT job_id, take FROM atelier_remessa_take LOOP
    SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = v_row.job_id;
    v_grade := v_row.take;
    SELECT COALESCE(sum(trunc(g.value::numeric)::int), 0)
      INTO v_pairs
      FROM jsonb_each_text(v_grade) g;
    IF v_pairs <= 0 THEN
      CONTINUE;
    END IF;
    SELECT so.order_number INTO v_order FROM public.sale_orders so WHERE so.id = v_job.sale_order_id;
    SELECT c.capacity_pairs_per_day INTO v_capacity
      FROM public.contractor_model_capacities c
     WHERE c.contractor_id = p_contractor_id
       AND c.technical_sheet_id = v_job.technical_sheet_id
       AND c.sector = p_sector
     LIMIT 1;
    v_due := public.add_business_days(
      CURRENT_DATE,
      CASE WHEN v_capacity IS NOT NULL AND v_capacity > 0
        THEN CEIL(v_pairs::numeric / v_capacity)::int ELSE v_offset END
    );
    INSERT INTO public.atelier_job_parts (
      job_id, execution_mode, contractor_id, pairs, grade, service_order_id,
      unit_price, suggested_unit_price, price_source, return_on,
      pipeline_status, sent_at, created_by
    ) VALUES (
      v_job.id, CASE WHEN COALESCE(p_internal, false) THEN 'internal' ELSE 'contractor' END,
      p_contractor_id, v_pairs, v_grade, v_os,
      v_price, v_suggested, CASE WHEN v_reused THEN 'os' ELSE COALESCE(v_source, 'digitado') END,
      v_due, 'sent_to_contractor', now(), auth.uid()
    ) RETURNING id INTO v_part;
    v_part_ids := v_part_ids || v_part;

    INSERT INTO public.service_order_items (
      service_order_id, atelier_job_id, atelier_part_id, source_item_key,
      material_name, description, sale_order_id, color,
      target_sector, sector, quantity, unit, unit_price, total_value,
      line_status, sent_at
    ) VALUES (
      v_os, v_job.id, v_part, 'atelier-part:' || v_part::text,
      COALESCE(NULLIF(btrim(v_job.reference_code), ''), 'Ateliê'),
      trim(both ' · ' FROM concat_ws(' · ', v_label, NULLIF(btrim(v_lot), ''), NULLIF(btrim(v_job.color), ''), NULLIF(btrim(v_order), ''))),
      v_job.sale_order_id, NULLIF(btrim(v_job.color), ''),
      v_sector, v_sector, v_pairs, 'par', v_price, round(v_pairs * v_price, 2),
      'Pendente', now()
    );

    INSERT INTO public.service_order_dispatches (
      service_order_id, contractor_id, qty_dispatched, dispatched_at, notes, grade, created_by
    ) VALUES (
      v_os, p_contractor_id, v_pairs, now(), 'atelier-part:' || v_part::text, v_grade, auth.uid()
    );

    SELECT COALESCE(SUM(pairs), 0) INTO v_alloc
      FROM public.atelier_job_parts WHERE job_id = v_job.id;
    UPDATE public.cabedal_prep_jobs
       SET pipeline_status = CASE
             WHEN v_alloc + 1e-9 >= pairs THEN 'sent_to_contractor'
             ELSE 'partially_sent'
           END,
           sent_at = COALESCE(sent_at, now()),
           service_order_id = COALESCE(service_order_id, v_os),
           contractor_id = CASE
             WHEN COALESCE(p_internal, false) THEN contractor_id
             ELSE COALESCE(contractor_id, p_contractor_id)
           END,
           atelier_service_number = COALESCE(atelier_service_number, v_os_number),
           updated_at = now()
     WHERE id = v_job.id;
  END LOOP;

  UPDATE public.service_orders so
     SET quantity = src.qty,
         total_value = src.total,
         unit_price = CASE WHEN src.qty > 0 THEN round(src.total / src.qty, 4) ELSE so.unit_price END,
         quoted_deadline = COALESCE(so.quoted_deadline, src.due),
         linked_sale_order_ids = (
           SELECT ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(so.linked_sale_order_ids, '{}'::uuid[]) || src.orders) x)
         ),
         updated_at = now()
    FROM (
      SELECT COALESCE(SUM(i.quantity), 0) AS qty,
             COALESCE(SUM(i.total_value), 0) AS total,
             MIN(p.return_on) AS due,
             COALESCE(array_agg(DISTINCT i.sale_order_id) FILTER (WHERE i.sale_order_id IS NOT NULL), '{}'::uuid[]) AS orders
        FROM public.service_order_items i
        LEFT JOIN public.atelier_job_parts p ON p.id = i.atelier_part_id
       WHERE i.service_order_id = v_os
    ) src
   WHERE so.id = v_os;

  IF NOT v_reused AND NOT COALESCE(p_internal, false) AND (v_suggested IS NULL OR round(v_suggested, 2) IS DISTINCT FROM round(v_price, 2)) THEN
    INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
    VALUES (
      auth.uid(), 'preco_parte_atelie', 'service_orders', v_os::text,
      jsonb_build_object('order_number', v_os_number, 'suggested_unit_price', v_suggested, 'unit_price', v_price, 'contractor_id', p_contractor_id),
      true, now()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'service_order_id', v_os,
    'order_number', v_os_number,
    'reused', v_reused,
    'part_ids', to_jsonb(v_part_ids),
    'unit_price', v_price
  );
END;
$$;


REVOKE ALL ON FUNCTION public.atelier_send_remessa(uuid, text, uuid, jsonb, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_send_remessa(uuid, text, uuid, jsonb, numeric, boolean) TO authenticated, service_role;
