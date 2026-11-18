-- Separar um job aguardando corte num lote próprio.
--
-- O lote aberto é único por referência × cor × variante. O corte debita a
-- napa de TODAS as demandas daquele lote. Dois PVs da mesma cor dividem a
-- faca. Esta RPC tira um pedido (todos os setores dele nessa cor) para um
-- lote novo, marcado manual_split, que o agrupamento automático não reabsorve.
--
-- Não corta, não envia, não recebe. Não mexe em PV nenhum por conta própria.

ALTER TABLE public.atelier_lots
  ADD COLUMN IF NOT EXISTS manual_split boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.atelier_lots.manual_split IS
  'Lote criado para um pedido só. O agrupamento automático não coloca demanda nova aqui nem devolve o pedido ao lote compartilhado.';

DROP INDEX IF EXISTS public.uq_atelier_lots_open;
CREATE UNIQUE INDEX uq_atelier_lots_open
  ON public.atelier_lots (
    reference_id,
    color_norm,
    COALESCE(material_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'open' AND manual_split = false;

-- Lote manual aberto continua sendo o lote da demanda que já aponta para ele.
-- A busca de "qualquer lote aberto desta cor" ignora os manuais.
CREATE OR REPLACE FUNCTION public.atelier_assign_lot_for_demand(p_demand_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d public.cabedal_prep_demands%ROWTYPE;
  v_variant uuid;
  v_norm text;
  v_lot public.atelier_lots%ROWTYPE;
BEGIN
  SELECT * INTO v_d FROM public.cabedal_prep_demands WHERE id = p_demand_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT soi.material_variant_id INTO v_variant
    FROM public.sale_order_items soi WHERE soi.id = v_d.sale_order_item_id;
  v_norm := lower(btrim(COALESCE(v_d.color, '')));

  IF v_d.lot_id IS NOT NULL THEN
    SELECT * INTO v_lot FROM public.atelier_lots WHERE id = v_d.lot_id;
    IF FOUND AND (
      v_lot.status = 'cut'
      OR (v_lot.status = 'open'
          AND v_lot.reference_id = v_d.technical_sheet_id
          AND v_lot.color_norm = v_norm
          AND v_lot.material_variant_id IS NOT DISTINCT FROM v_variant)
    ) THEN
      RETURN v_lot.id;
    END IF;
  END IF;

  SELECT * INTO v_lot
    FROM public.atelier_lots l
   WHERE l.status = 'open'
     AND l.manual_split = false
     AND l.reference_id = v_d.technical_sheet_id
     AND l.color_norm = v_norm
     AND l.material_variant_id IS NOT DISTINCT FROM v_variant
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.atelier_lots (reference_id, color, color_norm, material_variant_id)
    VALUES (v_d.technical_sheet_id, NULLIF(btrim(COALESCE(v_d.color, '')), ''), v_norm, v_variant)
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_lot;
    IF v_lot.id IS NULL THEN
      SELECT * INTO v_lot
        FROM public.atelier_lots l
       WHERE l.status = 'open'
         AND l.manual_split = false
         AND l.reference_id = v_d.technical_sheet_id
         AND l.color_norm = v_norm
         AND l.material_variant_id IS NOT DISTINCT FROM v_variant
       LIMIT 1;
    END IF;
  END IF;

  UPDATE public.cabedal_prep_demands SET lot_id = v_lot.id, updated_at = now() WHERE id = p_demand_id;
  UPDATE public.cabedal_prep_jobs SET lot_id = v_lot.id, updated_at = now()
   WHERE demand_id = p_demand_id AND pipeline_status = 'awaiting_cut';
  RETURN v_lot.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.atelier_split_job_to_own_lot(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_lot public.atelier_lots%ROWTYPE;
  v_new public.atelier_lots%ROWTYPE;
  v_job_ids uuid[];
  v_demand_ids uuid[];
  v_stay int;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'Job do Ateliê é obrigatório' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.lot_id IS NULL THEN
    RAISE EXCEPTION 'Este job ainda não está num lote' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = v_job.lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lot.status = 'cut' THEN
    RAISE EXCEPTION 'O lote % já foi cortado. A napa deste corte não se separa.', v_lot.lot_number
      USING ERRCODE = '22023';
  END IF;
  IF v_lot.status <> 'open' THEN
    RAISE EXCEPTION 'Lote % está %. Só lote aberto se separa.', v_lot.lot_number, v_lot.status
      USING ERRCODE = '22023';
  END IF;
  IF v_job.pipeline_status <> 'awaiting_cut' THEN
    RAISE EXCEPTION 'Só dá para separar job que ainda aguarda corte (status=%)', v_job.pipeline_status
      USING ERRCODE = '22023';
  END IF;

  -- Mesmo pedido nesta cor (o lote já é uma cor). Todos os setores saem juntos,
  -- porque o corte debita a napa pelas demandas do lote.
  SELECT COALESCE(array_agg(j.id ORDER BY j.sector, j.id), ARRAY[]::uuid[])
    INTO v_job_ids
    FROM public.cabedal_prep_jobs j
   WHERE j.lot_id = v_lot.id
     AND j.sale_order_id = v_job.sale_order_id
     AND j.pipeline_status = 'awaiting_cut';

  IF NOT (p_job_id = ANY (v_job_ids)) THEN
    RAISE EXCEPTION 'Este job não está aguardando corte neste lote' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT j.demand_id), ARRAY[]::uuid[])
    INTO v_demand_ids
    FROM public.cabedal_prep_jobs j
   WHERE j.id = ANY (v_job_ids);

  IF EXISTS (
    SELECT 1
      FROM public.cabedal_prep_jobs j
     WHERE j.demand_id = ANY (v_demand_ids)
       AND j.lot_id = v_lot.id
       AND j.pipeline_status <> 'cancelled'
       AND NOT (j.id = ANY (v_job_ids))
  ) THEN
    RAISE EXCEPTION 'Este pedido tem job neste lote que já passou do corte'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_stay
    FROM public.cabedal_prep_jobs j
   WHERE j.lot_id = v_lot.id
     AND j.pipeline_status <> 'cancelled'
     AND NOT (j.id = ANY (v_job_ids));

  IF v_stay = 0 THEN
    IF v_lot.manual_split THEN
      RETURN jsonb_build_object(
        'ok', true,
        'already_own_lot', true,
        'lot_id', v_lot.id,
        'lot_number', v_lot.lot_number,
        'job_ids', to_jsonb(v_job_ids)
      );
    END IF;
    RAISE EXCEPTION 'Este pedido já é o único deste lote' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.atelier_lots (
    reference_id, color, color_norm, material_variant_id, manual_split
  ) VALUES (
    v_lot.reference_id, v_lot.color, v_lot.color_norm, v_lot.material_variant_id, true
  )
  RETURNING * INTO v_new;

  UPDATE public.cabedal_prep_demands
     SET lot_id = v_new.id, updated_at = now()
   WHERE id = ANY (v_demand_ids);

  UPDATE public.cabedal_prep_jobs
     SET lot_id = v_new.id, updated_at = now()
   WHERE id = ANY (v_job_ids);

  UPDATE public.cabedal_prep_stock_debits
     SET lot_id = v_new.id
   WHERE lot_id = v_lot.id
     AND sale_order_id = v_job.sale_order_id;

  PERFORM public.atelier_refresh_lot_kit_gate(v_lot.id);
  PERFORM public.atelier_refresh_lot_kit_gate(v_new.id);

  INSERT INTO public.audit_logs (user_id, action, resource, resource_id, new_data, success, created_at)
  VALUES (
    auth.uid(),
    'atelier_split_job_to_own_lot',
    'atelier_lots',
    v_new.id,
    jsonb_build_object(
      'job_id', p_job_id,
      'sale_order_id', v_job.sale_order_id,
      'from_lot_id', v_lot.id,
      'from_lot_number', v_lot.lot_number,
      'to_lot_id', v_new.id,
      'to_lot_number', v_new.lot_number,
      'job_ids', to_jsonb(v_job_ids),
      'demand_ids', to_jsonb(v_demand_ids)
    ),
    true,
    now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_own_lot', false,
    'lot_id', v_new.id,
    'lot_number', v_new.lot_number,
    'from_lot_id', v_lot.id,
    'from_lot_number', v_lot.lot_number,
    'job_ids', to_jsonb(v_job_ids),
    'demand_ids', to_jsonb(v_demand_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_split_job_to_own_lot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_split_job_to_own_lot(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_split_job_to_own_lot(uuid) IS
  'Tira o pedido de um lote aberto compartilhado para um lote próprio. Não corta.';

DO $patch_list$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.list_atelier_lots()'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'list_atelier_lots() não encontrada';
  END IF;
  IF strpos(v_def, 'manual_split') > 0 THEN
    RETURN;
  END IF;
  v_def := regexp_replace(
    v_def,
    '''status'',[[:space:]]*l\.status',
    '''status'', l.status, ''manual_split'', COALESCE(l.manual_split, false)'
  );
  IF strpos(v_def, 'manual_split') = 0 THEN
    RAISE EXCEPTION 'list_atelier_lots sem status para expor o lote próprio';
  END IF;
  EXECUTE v_def;
END
$patch_list$;
