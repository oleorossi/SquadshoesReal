-- PV material commitments — wire anti-2× (hybrid adopt, atelier adopt, promote, cancel, cover)

-- ---------------------------------------------------------------------------
-- Gate: also skip OP soft when pv_commitment already covers same PV+product
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_block_op_reserve_if_atelier_debited()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so uuid;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Não interferir nas próprias reservas Ateliê / pv_commitment
  IF COALESCE(NEW.metadata ->> 'kind', '') IN ('atelier_prep', 'pv_commitment') THEN
    RETURN NEW;
  END IF;

  IF NEW.order_id IS NOT NULL THEN
    SELECT o.sale_order_id INTO v_so
      FROM public.orders o
     WHERE o.id = NEW.order_id;
  END IF;
  IF v_so IS NULL AND NEW.sale_order_id IS NOT NULL THEN
    v_so := NEW.sale_order_id;
  END IF;
  IF v_so IS NULL AND NEW.metadata ? 'sale_order_id' THEN
    v_so := (NEW.metadata ->> 'sale_order_id')::uuid;
  END IF;
  IF v_so IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.cabedal_prep_product_already_debited(v_so, NEW.product_id) THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.material_reservations mr
     WHERE mr.product_id = NEW.product_id
       AND mr.status IN ('reserved', 'partially_consumed')
       AND (
         (mr.metadata ->> 'kind' = 'atelier_prep'
           AND COALESCE(mr.sale_order_id, NULLIF(mr.metadata ->> 'sale_order_id', '')::uuid) = v_so)
         OR (mr.metadata ->> 'kind' = 'pv_commitment'
           AND mr.sale_order_id = v_so)
       )
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Atelier soft: adopt pv_commitment (no qty sum)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atelier_soft_reserve_for_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_pid uuid;
  v_need numeric;
  v_rid uuid;
  v_count int := 0;
  v_adopted int := 0;
BEGIN
  IF NOT public.is_approved_user()
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') NOT IN ('service_role', '')
     AND current_user NOT IN ('postgres', 'supabase_admin')
  THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'job_not_found');
  END IF;
  IF v_job.pipeline_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'job_cancelled');
  END IF;

  FOR v_pid IN
    SELECT s.product_id FROM public.atelier_resolve_sector_product_ids(v_job.sale_order_item_id, v_job.sector) s
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.material_reservations mr
       WHERE mr.product_id = v_pid
         AND mr.status = 'reserved'
         AND mr.metadata ->> 'kind' = 'atelier_prep'
         AND (mr.metadata ->> 'job_id')::uuid = p_job_id
    ) THEN
      CONTINUE;
    END IF;

    -- Adopt existing PV commitment / open soft for same PV+product
    UPDATE public.material_reservations mr
       SET sale_order_id = COALESCE(mr.sale_order_id, v_job.sale_order_id),
           metadata = COALESCE(mr.metadata, '{}'::jsonb) || jsonb_build_object(
             'kind', 'atelier_prep',
             'job_id', p_job_id,
             'sale_order_id', v_job.sale_order_id,
             'sale_order_item_id', v_job.sale_order_item_id,
             'sector', v_job.sector,
             'atelier_linked', true,
             'adopted_from', COALESCE(mr.metadata ->> 'kind', 'pv_commitment')
           ),
           notes = COALESCE(mr.notes, '') || ' · adopt Ateliê',
           updated_at = now()
     WHERE mr.product_id = v_pid
       AND mr.status IN ('reserved', 'partially_consumed')
       AND mr.sale_order_id = v_job.sale_order_id
       AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'component', 'atelier_prep')
       AND mr.strap_variant_id IS NULL
       AND mr.sale_order_strap_demand_id IS NULL
       AND NOT (
         mr.metadata ->> 'kind' = 'atelier_prep'
         AND (mr.metadata ->> 'job_id')::uuid = p_job_id
       );

    IF FOUND THEN
      v_adopted := v_adopted + 1;
      CONTINUE;
    END IF;

    v_need := GREATEST(COALESCE(v_job.pairs, 0), 0);
    IF v_need <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.material_reservations (
      order_id, sale_order_id, product_id, quantity_reserved, quantity_consumed,
      status, reservation_type, notes, metadata
    ) VALUES (
      NULL, v_job.sale_order_id, v_pid, v_need, 0,
      'reserved', 'soft',
      'Ateliê soft · job=' || p_job_id::text,
      jsonb_build_object(
        'kind', 'atelier_prep',
        'job_id', p_job_id,
        'sale_order_id', v_job.sale_order_id,
        'sale_order_item_id', v_job.sale_order_item_id,
        'sector', v_job.sector
      )
    )
    RETURNING id INTO v_rid;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reserved_rows', v_count, 'adopted_rows', v_adopted);
END;
$function$;

-- ---------------------------------------------------------------------------
-- hybrid_debit: commit PV first; soft adopt instead of duplicate insert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_order_id uuid,
  p_order_grade jsonb DEFAULT NULL::jsonb,
  p_force_soft boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_required numeric;
  v_available numeric;
  v_mode text;
  v_source text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_snap_outdated timestamptz;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
  v_sole_handled_by_grade boolean;
  v_already_debited boolean;
  v_eff_grade jsonb;
  v_packaging_mode text;
  v_adopted boolean;
BEGIN
  IF auth.role() <> 'service_role'
     AND current_setting('app.internal_stock_sync', true) IS DISTINCT FROM '1'
     AND NOT public.user_has_any_role(ARRAY['admin','gerente','producao']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('hybrid_debit:' || p_order_id::text));

  SELECT EXISTS (
    SELECT 1 FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status <> 'cancelled'
       AND strap_variant_id IS NULL
       AND sale_order_strap_demand_id IS NULL
       AND strap_stock_floor_contribution_id IS NULL
       AND strap_batch_item_id IS NULL
       AND service_order_item_id IS NULL
       AND COALESCE(metadata ->> 'kind', '') <> 'strap'
       AND COALESCE(source, '') NOT IN (
         'strap_engine_finished', 'strap_engine_base', 'strap_demand'
       )
  ) INTO v_already_debited;

  IF v_already_debited THEN
    RETURN jsonb_build_object('snapshot_id', NULL, 'items', '[]'::jsonb, 'idempotent_skip', true);
  END IF;

  v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object');
  v_eff_grade := CASE
    WHEN v_sole_handled_by_grade THEN public.scale_grade_to_total(p_order_grade, p_order_quantity)
    ELSE p_order_grade
  END;

  v_size := NULL;
  IF v_sole_handled_by_grade THEN
    SELECT split_part(key, '/', 1)::integer INTO v_size
      FROM jsonb_each_text(v_eff_grade)
     WHERE key ~ '^[0-9]+(/[0-9]+)?$'
     ORDER BY value::numeric DESC
     LIMIT 1;
  END IF;

  SELECT sale_order_id, sale_order_item_id INTO v_sale_order_id, v_soi_id
    FROM public.orders WHERE id = p_order_id;

  -- Soft pegging: garantir commitments do PV antes de criar soft da OP
  IF v_sale_order_id IS NOT NULL AND p_force_soft THEN
    PERFORM public.commit_sale_order_material_demand(v_sale_order_id);
  END IF;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT packaging_mode INTO v_packaging_mode
      FROM public.sale_orders
     WHERE id = v_sale_order_id;
  END IF;

  IF v_soi_id IS NULL AND v_sale_order_id IS NOT NULL THEN
    SELECT id INTO v_soi_id
      FROM public.sale_order_items
     WHERE sale_order_id = v_sale_order_id
       AND reference_id = p_reference_id
       AND COALESCE(color,'') = COALESCE(p_color,'')
     LIMIT 1;
  END IF;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT consumption_snapshot, id, outdated_at INTO v_items, v_snap_id, v_snap_outdated
      FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_sale_order_id
       AND (sale_order_item_id IS NOT DISTINCT FROM v_soi_id)
     LIMIT 1;
  END IF;

  IF v_items IS NOT NULL AND v_snap_outdated IS NOT NULL THEN
    RAISE WARNING 'hybrid_debit_stock_for_order: OP % debita snapshot DESATUALIZADO (outdated_at=%) do PV %',
      p_order_id, v_snap_outdated, v_sale_order_id;
  END IF;

  IF v_items IS NULL THEN
    IF v_sale_order_id IS NOT NULL THEN
      v_snap_id := public.freeze_technical_sheet(
        p_reference_id, v_sale_order_id, v_soi_id, p_color, p_order_quantity, v_size, v_eff_grade
      );
      SELECT consumption_snapshot INTO v_items
        FROM public.technical_sheet_snapshots WHERE id = v_snap_id;
    ELSE
      IF v_sole_handled_by_grade THEN
        v_items := public.calculate_order_consumption_by_grade(p_reference_id, v_eff_grade, p_color, NULL);
      ELSE
        v_items := public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size, NULL);
      END IF;
    END IF;
  END IF;

  v_items := public.filter_caixa_by_packaging_mode(v_items, v_packaging_mode);

  IF NOT p_force_soft THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_items) AS value
       ORDER BY value ->> 'product_id'
    LOOP
      IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
        CONTINUE;
      END IF;
      v_pid := (v_item ->> 'product_id')::uuid;
      v_source := v_item ->> 'source';
      IF v_sole_handled_by_grade AND v_source IN ('primary_sole', 'variant_sole') THEN
        CONTINUE;
      END IF;
      SELECT id, quantity, name INTO v_product
        FROM public.products WHERE id = v_pid FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto % do snapshot não encontrado', v_pid;
      END IF;
      v_required := (v_item ->> 'required')::numeric;
      IF v_product.quantity < v_required AND (v_item ->> 'debit_mode') = 'hard' THEN
        RAISE EXCEPTION
          'Estoque insuficiente para % "%": disponível %, necessário %',
          v_item ->> 'component', v_product.name, v_product.quantity, v_required;
      END IF;
    END LOOP;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid := (v_item ->> 'product_id')::uuid;
    v_name := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode := v_item ->> 'debit_mode';
    v_source := v_item ->> 'source';

    IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
      UPDATE public.orders
         SET material_status = 'erro_reserva',
             notes = COALESCE(NULLIF(notes, '') || E'\n', '')
               || '⚠ Reserva automática com erro — Cor "' || COALESCE(p_color, '')
               || '" não cadastrada no grupo ' || COALESCE(v_item ->> 'component', 'não identificado')
               || ' — componente não reservado; cadastre a cor e rode a reserva (MRP).'
       WHERE id = p_order_id
         AND (
           material_status IS DISTINCT FROM 'erro_reserva'
           OR COALESCE(notes, '') NOT LIKE '%Cor "' || COALESCE(p_color, '')
             || '" não cadastrada no grupo ' || COALESCE(v_item ->> 'component', 'não identificado')
             || ' — componente não reservado; cadastre a cor e rode a reserva (MRP).%'
         );
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name, 'required', v_required,
        'type', 'skipped_color_not_registered',
        'component', v_item ->> 'component', 'color', p_color);
      CONTINUE;
    END IF;

    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;

    IF v_sole_handled_by_grade AND v_source IN ('primary_sole', 'variant_sole') THEN
      IF p_force_soft THEN
        v_result := v_result || jsonb_build_object(
          'product_id', v_pid, 'product_name', v_name,
          'required', v_required, 'type', 'sole_deferred_to_grade_soft'
        );
        CONTINUE;
      END IF;
      INSERT INTO public.material_reservations
        (order_id, sale_order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_sale_order_id, v_pid, v_required, 0, 'reserved', 'soft',
              jsonb_build_object('kind', 'sole_pending_grade', 'component', v_item->>'component'));
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'sole_deferred_to_grade'
      );
      CONTINUE;
    END IF;

    IF p_force_soft OR v_mode = 'soft' THEN
      v_adopted := false;
      IF v_sale_order_id IS NOT NULL THEN
        UPDATE public.material_reservations mr
           SET order_id = COALESCE(mr.order_id, p_order_id),
               sale_order_id = COALESCE(mr.sale_order_id, v_sale_order_id),
               quantity_reserved = GREATEST(mr.quantity_reserved, v_required),
               metadata = COALESCE(mr.metadata, '{}'::jsonb) || jsonb_build_object(
                 'adopted_order_id', p_order_id,
                 'component', COALESCE(mr.metadata ->> 'component', v_item->>'component'),
                 'source', v_source,
                 'color', p_color
               ),
               updated_at = now()
         WHERE mr.product_id = v_pid
           AND mr.sale_order_id = v_sale_order_id
           AND mr.status IN ('reserved', 'partially_consumed')
           AND COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep', 'component')
           AND mr.strap_variant_id IS NULL
           AND mr.sale_order_strap_demand_id IS NULL;
        v_adopted := FOUND;
      END IF;

      IF v_adopted THEN
        v_result := v_result || jsonb_build_object(
          'product_id', v_pid, 'product_name', v_name,
          'required', v_required, 'type', 'adopted_commitment'
        );
      ELSE
        INSERT INTO public.material_reservations
          (order_id, sale_order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
        VALUES (p_order_id, v_sale_order_id, v_pid, v_required, 0, 'reserved', 'soft',
                jsonb_build_object(
                  'kind', CASE WHEN v_sale_order_id IS NOT NULL THEN 'pv_commitment' ELSE 'component' END,
                  'component', v_item->>'component',
                  'source', v_source,
                  'color', p_color,
                  'sale_order_id', v_sale_order_id
                ));
        v_result := v_result || jsonb_build_object(
          'product_id', v_pid, 'product_name', v_name,
          'required', v_required, 'type', 'reserved'
        );
      END IF;
    ELSE
      UPDATE public.products
         SET quantity = GREATEST(0, quantity - v_required), updated_at = now()
       WHERE id = v_pid;

      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP ' || COALESCE(v_name,'') ||
         CASE WHEN COALESCE(p_color,'') <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);

      INSERT INTO public.material_reservations
        (order_id, sale_order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_sale_order_id, v_pid, v_required, v_required, 'consumed', 'hard',
              jsonb_build_object('kind', 'component', 'component', v_item->>'component'));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'snapshot_id', v_snap_id,
    'items', v_result,
    'force_soft', p_force_soft,
    'snapshot_outdated_at', v_snap_outdated
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Inject commit into promote_sale_order_atomic_internal (live body)
-- ---------------------------------------------------------------------------
DO $wire$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure);
  IF position('commit_sale_order_material_demand' IN v_def) = 0 THEN
    IF position('PERFORM private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id);' IN v_def) = 0 THEN
      RAISE EXCEPTION 'Marker de inject promote não encontrado';
    END IF;
    v_def := replace(
      v_def,
      'PERFORM private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id);',
      $inj$PERFORM private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id);

  -- Soft pegging: commitments do PV antes do hybrid/OP
  PERFORM public.commit_sale_order_material_demand(p_sale_order_id);$inj$
    );
    EXECUTE v_def;
  END IF;
END;
$wire$;

-- ---------------------------------------------------------------------------
-- Inject recompute into process_sale_order_purchase_shortages
-- ---------------------------------------------------------------------------
DO $wire$
DECLARE
  v_def text;
  v_marker text;
BEGIN
  v_def := pg_get_functiondef('public.process_sale_order_purchase_shortages(uuid)'::regprocedure);
  IF position('recompute_sale_order_material_commitments' IN v_def) = 0 THEN
    -- Insert near start after DECLARE/BEGIN checks: look for typical status select
    IF position('SELECT status INTO v_status' IN v_def) > 0 THEN
      v_marker := 'SELECT status INTO v_status';
      v_def := replace(
        v_def,
        v_marker,
        $inj$-- Soft pegging: alinhar commitments antes de calcular falta/OC
  BEGIN
    PERFORM public.recompute_sale_order_material_commitments(p_sale_order_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'recompute commitments falhou para %: %', p_sale_order_id, SQLERRM;
  END;

  SELECT status INTO v_status$inj$
      );
      EXECUTE v_def;
    ELSE
      RAISE WARNING 'Não injetou recompute em process_sale_order_purchase_shortages (marker ausente)';
    END IF;
  END IF;
END;
$wire$;

-- ---------------------------------------------------------------------------
-- Cancel PV → release commitments + atelier soft
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_release_pv_commitments_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Cancelado'
     AND OLD.status IS DISTINCT FROM 'Cancelado' THEN
    PERFORM public.release_excess_sale_order_commitments(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_pv_commitments_on_cancel ON public.sale_orders;
CREATE TRIGGER trg_release_pv_commitments_on_cancel
  AFTER UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_release_pv_commitments_on_cancel();

-- ---------------------------------------------------------------------------
-- Cover after stock inbound (products quantity increase via movements 'in')
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_cover_commitments_on_stock_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.movement_type = 'in'
     AND NEW.product_id IS NOT NULL
     AND COALESCE(NEW.quantity, 0) > 0 THEN
    PERFORM public.cover_open_material_commitments(NEW.product_id, NEW.quantity, NEW.id);
    BEGIN
      PERFORM public.rebalance_material_commitments_for_product(NEW.product_id);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- best-effort
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cover_commitments_on_stock_in ON public.stock_movements;
CREATE TRIGGER trg_cover_commitments_on_stock_in
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_cover_commitments_on_stock_in();
