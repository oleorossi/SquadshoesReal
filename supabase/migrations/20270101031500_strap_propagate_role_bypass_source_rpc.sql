-- strap_propagate_role_bypass_315
-- Sintoma: save da ficha I704 (Produção) troca TRASEIRA OVERLOCK→ELÁSTICO FORRADO,
-- propagate_sheet_straps_to_open_pvs roda (aceita producao) e seta
-- app.strap_source_rpc='1', mas prepare + ensure exigem comercial/gerente/admin
-- e IGNORAM a flag → item do PV fica congelado (PV-00195).
--
-- Fix: liberar prepare/ensure somente quando app.strap_source_rpc='1'
-- (caminho do propagate). Chamada direta no PV continua Comercial.
-- Não adiciona 'producao' na allow-list ampla do ensure.

DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  -- 1) prepare_sale_order_item_internal_straps
  v_def := pg_get_functiondef('public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure);
  v_old := $old$IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     ) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode preparar as tiras do PV';
  END IF;$old$;
  v_new := $new$-- strap_propagate_role_bypass_315: propagate seta app.strap_source_rpc='1'
  IF current_setting('app.strap_source_rpc', true) IS DISTINCT FROM '1'
     AND auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     ) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode preparar as tiras do PV';
  END IF;$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Gate prepare não encontrado para patch 315 (corpo divergiu)';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'Gate prepare não é único no corpo vivo';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);

  -- 2) ensure_sale_order_internal_strap_materials
  v_def := pg_get_functiondef(
    'private.ensure_sale_order_internal_strap_materials(uuid,uuid,uuid,uuid[],jsonb)'::regprocedure
  );
  v_old := $old$IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode definir as tiras do PV';
  END IF;$old$;
  v_new := $new$-- strap_propagate_role_bypass_315: propagate seta app.strap_source_rpc='1'
  IF current_setting('app.strap_source_rpc', true) IS DISTINCT FROM '1'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     ) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode definir as tiras do PV';
  END IF;$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Gate ensure não encontrado para patch 315 (corpo divergiu)';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'Gate ensure não é único no corpo vivo';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

-- One-shot: realinha PV-00195 / I704 TRASEIRA após o bypass.
DO $repair$
DECLARE
  v_sheet_id uuid := 'f8e88e36-934e-4d7e-a9de-ff0650494049';
  v_so_id uuid;
  v_actor uuid := '49371f4d-641f-466d-be26-686ef57743ec';
  v_elastico uuid := '4d61042d-ce46-4887-b306-623c0a63317c';
  v_7mm uuid := '9292a467-992e-4097-8dd5-5fb2f94abb15';
  v_traseira_line uuid := '2b5594d3-4031-4cdd-8aaf-971f899970c5';
  v_result jsonb;
  v_job_id uuid;
  v_type uuid;
  v_measure uuid;
  v_demand_type text;
  v_demand_measure text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'service_role', 'sub', v_actor::text)::text,
    true
  );

  v_result := public.auto_resync_unstarted_ops_for_sheet(v_sheet_id);

  SELECT (x->>'strap_type_id')::uuid, (x->>'measure_id')::uuid
    INTO v_type, v_measure
  FROM public.sale_order_items soi
  JOIN public.sale_orders so ON so.id = soi.sale_order_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(soi.strap_colors, '[]'::jsonb)) x
  WHERE so.order_number = 'PV-00195'
    AND soi.color = 'CHAMPAGNE'
    AND x->>'label' = 'TRASEIRA'
  LIMIT 1;

  IF v_type IS DISTINCT FROM v_elastico OR v_measure IS DISTINCT FROM v_7mm THEN
    RAISE EXCEPTION
      'Repair 315 falhou: TRASEIRA ficou type=% measure=% (esperado ELÁSTICO/7mm). auto_resync=%',
      v_type, v_measure, v_result;
  END IF;

  -- Propagate atualiza item/sourcing; demanda operacional vem da fila.
  SELECT id INTO v_so_id FROM public.sale_orders WHERE order_number = 'PV-00195';
  v_job_id := public.enqueue_sale_order_strap_demands(
    v_so_id, 'item_changed', gen_random_uuid()
  );

  UPDATE public.strap_demand_jobs
     SET status = 'processing',
         locked_at = now(),
         locked_by = 'repair-315',
         updated_at = now()
   WHERE id = v_job_id
     AND status IN ('queued', 'retry');

  PERFORM public.process_strap_demand_job(v_job_id, 'repair-315');

  SELECT d.identity_snapshot #>> '{resolved,catalog,strap_type_id}',
         d.identity_snapshot #>> '{resolved,measure_name}'
    INTO v_demand_type, v_demand_measure
  FROM public.sale_order_strap_demands d
  JOIN public.sale_order_items soi ON soi.id = d.sale_order_item_id
  JOIN public.sale_orders so ON so.id = d.sale_order_id
  WHERE so.order_number = 'PV-00195'
    AND soi.color = 'CHAMPAGNE'
    AND d.technical_strap_line_id = v_traseira_line
    AND d.status NOT IN ('superseded', 'cancelled', 'canceled')
  ORDER BY d.updated_at DESC
  LIMIT 1;

  IF v_demand_type IS DISTINCT FROM v_elastico::text
     OR v_demand_measure IS DISTINCT FROM '7 mm' THEN
    RAISE EXCEPTION
      'Repair 315 falhou: demanda TRASEIRA type=% measure=% (esperado ELÁSTICO/7mm). job=% resync=%',
      v_demand_type, v_demand_measure, v_job_id, v_result;
  END IF;
END;
$repair$;
