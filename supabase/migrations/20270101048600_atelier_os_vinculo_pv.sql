-- O clique Enviar cria a OS em atelier_send_shipment ANTES de gravar o item.
-- Esse INSERT não levava PV, e o gatilho de OS órfã recusava
-- ("OS precisa de vínculo com um PV ou OP — ou ser marcada como avulsa").
-- Continua uma OS por prestador por remessa, sem is_avulsa.
-- Um PV preenche sale_order_id e source_sale_order_id.
-- Vários PVs ficam em linked_sale_order_ids; cada job leva o seu PV na linha.
-- target_end do job continua sendo a âncora de corte. A volta prevista é
-- essa data mais o offset do setor (corte → prestador → volta).

CREATE OR REPLACE FUNCTION public.atelier_job_return_date(
  p_anchor date,
  p_sector text
)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_offset int;
BEGIN
  IF p_anchor IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT CASE
           WHEN p_sector = 'aviamento' THEN s.aviamento_offset_days
           ELSE s.costura_offset_days
         END
    INTO v_offset
    FROM public.atelier_settings s
   WHERE s.id = 1;
  v_offset := GREATEST(0, COALESCE(v_offset, 5));
  RETURN public.add_business_days(p_anchor, v_offset);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_job_return_date(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_job_return_date(date, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_job_return_date(date, text) IS
  'Volta prevista do Ateliê: âncora de corte (target_end) + offset do setor em dias úteis. Não é a data do corte.';

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
  v_label text;
  v_price numeric;
  v_order text;
  v_lot text;
BEGIN
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.execution_mode = 'internal' THEN
    RAISE EXCEPTION 'Job interno não entra em ordem de serviço' USING ERRCODE = '22023';
  END IF;

  v_sector := public.atelier_rate_sector(v_job.sector);
  v_label := CASE v_sector
    WHEN 'costura' THEN 'Costura de cabedal'
    WHEN 'mesa' THEN 'Aviamento'
    ELSE COALESCE(v_sector, v_job.sector)
  END;
  v_price := public.get_contractor_rate(p_contractor_id, v_sector, CURRENT_DATE);
  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'Cadastre a tarifa vigente de % deste prestador antes de enviar', v_label
      USING ERRCODE = '22023';
  END IF;

  SELECT so.order_number INTO v_order
    FROM public.sale_orders so
   WHERE so.id = v_job.sale_order_id;
  SELECT l.lot_number INTO v_lot
    FROM public.atelier_lots l
   WHERE l.id = v_job.lot_id;

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
      v_label,
      NULLIF(btrim(v_lot), ''),
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
  v_orders uuid[];
  v_items uuid[];
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
    IF v_job.sale_order_id IS NULL THEN
      RAISE EXCEPTION 'A OS do Ateliê precisa do PV do job. Há job sem pedido nesta remessa.'
        USING ERRCODE = '22023';
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

  SELECT
    COALESCE(array_agg(DISTINCT j.sale_order_id), '{}'::uuid[]),
    COALESCE(array_agg(DISTINCT j.sale_order_item_id) FILTER (WHERE j.sale_order_item_id IS NOT NULL), '{}'::uuid[])
    INTO v_orders, v_items
    FROM public.cabedal_prep_jobs j
   WHERE j.id = ANY (p_job_ids);

  IF COALESCE(cardinality(v_orders), 0) = 0 THEN
    RAISE EXCEPTION 'A OS do Ateliê precisa do PV do job.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.service_orders (
    contractor_id, status, service_date, description, notes,
    dispatch_tracked, quantity, unit_price, total_value,
    service_order_domain, material_requirements, is_avulsa,
    sale_order_id, source_sale_order_id,
    linked_sale_order_ids, selected_sale_order_item_ids
  ) VALUES (
    p_contractor_id,
    'Em Andamento',
    CURRENT_DATE,
    'Remessa do Ateliê',
    'Uma OS para os jobs enviados juntos neste clique.',
    true,
    0, 0, 0,
    'generic',
    '{}'::jsonb,
    false,
    CASE WHEN cardinality(v_orders) = 1 THEN v_orders[1] ELSE NULL END,
    CASE WHEN cardinality(v_orders) = 1 THEN v_orders[1] ELSE NULL END,
    v_orders,
    CASE WHEN cardinality(v_items) = 0 THEN NULL ELSE v_items END
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
    'jobs', v_count,
    'sale_order_ids', to_jsonb(v_orders)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_send_shipment(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_send_shipment(uuid[], uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_send_shipment(uuid[], uuid) IS
  'Uma OS por prestador por remessa, vinculada aos PVs dos jobs. Não marca avulsa e não envia sozinho.';

-- O caminho de um job só também grava o PV singular, não só o array.
DO $patch_sent$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.atelier_mark_job_sent(uuid, uuid, uuid)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'atelier_mark_job_sent(uuid, uuid, uuid) não encontrada';
  END IF;
  IF strpos(v_def, 'source_sale_order_id') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, 'linked_sale_order_ids') = 0 THEN
    RAISE EXCEPTION 'atelier_mark_job_sent sem linked_sale_order_ids para gravar o PV';
  END IF;
  v_def := replace(
    v_def,
    'selected_sale_order_item_ids, linked_sale_order_ids',
    'is_avulsa, sale_order_id, source_sale_order_id, selected_sale_order_item_ids, linked_sale_order_ids'
  );
  v_def := replace(
    v_def,
    $v$'{}'::jsonb,
      CASE WHEN v_job.sale_order_item_id IS NULL THEN NULL
           ELSE ARRAY[v_job.sale_order_item_id] END,$v$,
    $v$'{}'::jsonb,
      false,
      v_job.sale_order_id,
      v_job.sale_order_id,
      CASE WHEN v_job.sale_order_item_id IS NULL THEN NULL
           ELSE ARRAY[v_job.sale_order_item_id] END,$v$
  );
  IF strpos(v_def, 'source_sale_order_id') = 0 OR strpos(v_def, 'false,') = 0 THEN
    RAISE EXCEPTION 'atelier_mark_job_sent: não achei o INSERT da OS para gravar o PV';
  END IF;
  EXECUTE v_def;
END
$patch_sent$;

-- Atraso do relatório usa a volta, não a âncora de corte.
DO $patch_report$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.atelier_period_report(date, date)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'atelier_period_report(date, date) não encontrada';
  END IF;
  IF strpos(v_def, 'atelier_job_return_date') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, 'j.target_end < CURRENT_DATE') = 0 THEN
    RAISE EXCEPTION 'atelier_period_report sem o predicado de atraso';
  END IF;
  IF strpos(v_def, 'j.sector') = 0 THEN
    v_def := replace(
      v_def,
      'j.target_end,' || E'\n      j.contractor_id,',
      'j.target_end,' || E'\n      j.sector,' || E'\n      j.contractor_id,'
    );
  END IF;
  v_def := replace(
    v_def,
    'j.target_end < CURRENT_DATE',
    'public.atelier_job_return_date(j.target_end, j.sector) < CURRENT_DATE'
  );
  IF strpos(v_def, 'atelier_job_return_date') = 0 OR strpos(v_def, 'j.sector') = 0 THEN
    RAISE EXCEPTION 'atelier_period_report: o atraso não passou a usar a volta prevista';
  END IF;
  EXECUTE v_def;
END
$patch_report$;
