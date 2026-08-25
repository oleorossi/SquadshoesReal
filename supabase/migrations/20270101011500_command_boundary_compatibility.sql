-- Compatibilidade estreita dos command boundaries 105/108/113.
--
-- Esta migration nao altera dados de negocio. Ela remonta apenas wrappers,
-- guards e ACLs para que writers legitimos continuem atomicos sem reabrir DML
-- generico para authenticated/service_role.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Excecoes de sale_order_items: alvo + delta exatos por comando
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_enforce_sale_order_command_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_marker text;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'sale_order_items' AND TG_OP = 'UPDATE' THEN
    -- Revisao comercial: um item e somente o snapshot congelado.
    v_marker := pg_catalog.current_setting(
      'app.sale_order_item_commercial_review_internal', true
    );
    IF v_marker = OLD.id::text
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND (
         pg_catalog.to_jsonb(NEW)
           - ARRAY['material_variant_commercial_snapshot']::text[]
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD)
           - ARRAY['material_variant_commercial_snapshot']::text[]
       ) THEN
      RETURN NEW;
    END IF;

    -- Resolucao tecnica em lote/helper: apenas itens da referencia marcada.
    v_marker := pg_catalog.current_setting(
      'app.sale_order_item_strap_context_reference_id', true
    );
    IF v_marker = OLD.reference_id::text
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND (
         pg_catalog.to_jsonb(NEW)
           - ARRAY[
               'strap_colors', 'strap_migration_status',
               'strap_migration_reason'
             ]::text[]
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD)
           - ARRAY[
               'strap_colors', 'strap_migration_status',
               'strap_migration_reason'
             ]::text[]
       ) THEN
      RETURN NEW;
    END IF;

    -- Escolha/override de sourcing: um item e somente o payload de sourcing.
    v_marker := pg_catalog.current_setting(
      'app.sale_order_item_strap_sourcing_item_id', true
    );
    IF v_marker = OLD.id::text
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND (
         pg_catalog.to_jsonb(NEW) - ARRAY['strap_sourcing']::text[]
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD) - ARRAY['strap_sourcing']::text[]
       ) THEN
      RETURN NEW;
    END IF;

    -- Worker/cron: somente fecha o estado da migracao de um item conhecido.
    v_marker := pg_catalog.current_setting(
      'app.sale_order_item_strap_reconcile_item_id', true
    );
    IF v_marker = OLD.id::text
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND (
         pg_catalog.to_jsonb(NEW)
           - ARRAY['strap_migration_status', 'strap_migration_reason']::text[]
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD)
           - ARRAY['strap_migration_status', 'strap_migration_reason']::text[]
       ) THEN
      RETURN NEW;
    END IF;

    -- Apply global: o item precisa apontar para um cutover do run marcado.
    v_marker := pg_catalog.current_setting(
      'app.sale_order_item_cutover_apply_run_id', true
    );
    IF NULLIF(v_marker, '') IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.artisanal_strap_migration_cutovers cutover
          WHERE cutover.migration_run_id::text = v_marker
            AND cutover.id = NEW.strap_migration_cutover_id
       )
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND (
         pg_catalog.to_jsonb(NEW)
           - ARRAY[
               'strap_sourcing', 'strap_migration_status',
               'strap_migration_reason', 'strap_migration_cutover_id'
             ]::text[]
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD)
           - ARRAY[
               'strap_sourcing', 'strap_migration_status',
               'strap_migration_reason', 'strap_migration_cutover_id'
             ]::text[]
       ) THEN
      RETURN NEW;
    END IF;

    -- Rollback: somente itens fotografados pelo cutover marcado e os cinco
    -- campos efetivamente restaurados pelo motor legado.
    v_marker := pg_catalog.current_setting(
      'app.sale_order_item_cutover_rollback_id', true
    );
    IF NULLIF(v_marker, '') IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.artisanal_strap_migration_entity_snapshots snapshot
          WHERE snapshot.cutover_id::text = v_marker
            AND snapshot.entity_type = 'sale_order_item'
            AND snapshot.entity_id = OLD.id
       )
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND (
         pg_catalog.to_jsonb(NEW)
           - ARRAY[
               'strap_colors', 'strap_sourcing', 'strap_migration_status',
               'strap_migration_reason', 'strap_migration_cutover_id'
             ]::text[]
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD)
           - ARRAY[
               'strap_colors', 'strap_sourcing', 'strap_migration_status',
               'strap_migration_reason', 'strap_migration_cutover_id'
             ]::text[]
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'sale_orders' AND TG_OP = 'UPDATE' THEN
    -- Picking humano: somente o carimbo de conclusao individual do PV alvo.
    v_marker := pg_catalog.current_setting(
      'app.sale_order_picking_internal', true
    );
    IF v_marker = OLD.id::text
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND (
         pg_catalog.to_jsonb(NEW)
           - ARRAY['picking_individually_done_at', 'updated_at']::text[]
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD)
           - ARRAY['picking_individually_done_at', 'updated_at']::text[]
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     OR NOT public.can_execute_sale_order_command('edit') THEN
    RAISE EXCEPTION
      'Permission denied: alteracao de PV exige Comercial/Gerencia e can_edit em /sales'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'sale_orders' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION
        'Transicao % -> % exige execute_sale_order_command e expected_version',
        OLD.status,
        NEW.status
        USING ERRCODE = 'PZ117';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Item de PV exige create/execute_sale_order_command; DML direto foi encerrado'
    USING ERRCODE = 'PZ117';
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_enforce_sale_order_command_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserva os corpos auditados como implementacoes privadas. Os wrappers
-- abaixo controlam o marcador por toda a chamada e o restauram tambem no erro.
DO $preserve_sale_item_compat_impls$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.review_legacy_material_variant_commercial_snapshot(uuid,jsonb,jsonb,text,boolean)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.review_legacy_material_variant_commercial_snapshot_impl_115(uuid,jsonb,jsonb,text,boolean)'
     ) IS NULL THEN
    ALTER FUNCTION public.review_legacy_material_variant_commercial_snapshot(
      uuid, jsonb, jsonb, text, boolean
    ) RENAME TO review_legacy_material_variant_commercial_snapshot_impl_115;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.resolve_technical_strap_context_from_sale_order(uuid,uuid,jsonb,text,timestamptz)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.resolve_technical_strap_context_from_sale_order_impl_115(uuid,uuid,jsonb,text,timestamptz)'
     ) IS NULL THEN
    ALTER FUNCTION public.resolve_technical_strap_context_from_sale_order(
      uuid, uuid, jsonb, text, timestamptz
    ) RENAME TO resolve_technical_strap_context_from_sale_order_impl_115;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.resolve_technical_strap_line_migration(uuid,uuid,text)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.resolve_technical_strap_line_migration_impl_115(uuid,uuid,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.resolve_technical_strap_line_migration(uuid, uuid, text)
      RENAME TO resolve_technical_strap_line_migration_impl_115;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.set_sale_order_item_strap_sourcing(uuid,integer,jsonb)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.set_sale_order_item_strap_sourcing_impl_115(uuid,integer,jsonb)'
     ) IS NULL THEN
    ALTER FUNCTION public.set_sale_order_item_strap_sourcing(uuid, integer, jsonb)
      RENAME TO set_sale_order_item_strap_sourcing_impl_115;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.override_sale_order_item_strap_sourcing(uuid,integer,jsonb,text,uuid)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.override_sale_order_item_strap_sourcing_impl_115(uuid,integer,jsonb,text,uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.override_sale_order_item_strap_sourcing(
      uuid, integer, jsonb, text, uuid
    ) RENAME TO override_sale_order_item_strap_sourcing_impl_115;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.try_resolve_open_sale_order_item_strap_migration(uuid,uuid)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.try_resolve_open_sale_order_item_strap_migration_impl_115(uuid,uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.try_resolve_open_sale_order_item_strap_migration(uuid, uuid)
      RENAME TO try_resolve_open_sale_order_item_strap_migration_impl_115;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.apply_artisanal_strap_migration(uuid,text,text,uuid)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.apply_artisanal_strap_migration_impl_115(uuid,text,text,uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.apply_artisanal_strap_migration(uuid, text, text, uuid)
      RENAME TO apply_artisanal_strap_migration_impl_115;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.rollback_artisanal_strap_migration(uuid,text,text,uuid)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.rollback_artisanal_strap_migration_impl_115(uuid,text,text,uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.rollback_artisanal_strap_migration(uuid, text, text, uuid)
      RENAME TO rollback_artisanal_strap_migration_impl_115;
  END IF;
END;
$preserve_sale_item_compat_impls$;

REVOKE ALL ON FUNCTION
  public.review_legacy_material_variant_commercial_snapshot_impl_115(uuid,jsonb,jsonb,text,boolean),
  public.resolve_technical_strap_context_from_sale_order_impl_115(uuid,uuid,jsonb,text,timestamptz),
  public.resolve_technical_strap_line_migration_impl_115(uuid,uuid,text),
  public.set_sale_order_item_strap_sourcing_impl_115(uuid,integer,jsonb),
  public.override_sale_order_item_strap_sourcing_impl_115(uuid,integer,jsonb,text,uuid),
  public.try_resolve_open_sale_order_item_strap_migration_impl_115(uuid,uuid),
  public.apply_artisanal_strap_migration_impl_115(uuid,text,text,uuid),
  public.rollback_artisanal_strap_migration_impl_115(uuid,text,text,uuid)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_legacy_material_variant_commercial_snapshot(
  p_sale_order_item_id uuid,
  p_expected_snapshot jsonb,
  p_attested_identity jsonb,
  p_reason text,
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous text;
  v_result jsonb;
BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();
  v_previous := pg_catalog.current_setting(
    'app.sale_order_item_commercial_review_internal', true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_commercial_review_internal',
    p_sale_order_item_id::text,
    true
  );
  BEGIN
    v_result := public.review_legacy_material_variant_commercial_snapshot_impl_115(
      p_sale_order_item_id,
      p_expected_snapshot,
      p_attested_identity,
      p_reason,
      p_apply
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.sale_order_item_commercial_review_internal',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_commercial_review_internal',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.review_legacy_material_variant_commercial_snapshot(
  uuid,jsonb,jsonb,text,boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_legacy_material_variant_commercial_snapshot(
  uuid,jsonb,jsonb,text,boolean
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_technical_strap_context_from_sale_order(
  p_reference_id uuid,
  p_base_group_id uuid,
  p_lines jsonb,
  p_reason text,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '1500ms'
AS $function$
DECLARE
  v_previous text;
  v_result jsonb;
BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();
  v_previous := pg_catalog.current_setting(
    'app.sale_order_item_strap_context_reference_id', true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_strap_context_reference_id',
    p_reference_id::text,
    true
  );
  BEGIN
    v_result := public.resolve_technical_strap_context_from_sale_order_impl_115(
      p_reference_id,
      p_base_group_id,
      p_lines,
      p_reason,
      p_expected_updated_at
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.sale_order_item_strap_context_reference_id',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_strap_context_reference_id',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_technical_strap_context_from_sale_order(
  uuid,uuid,jsonb,text,timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_technical_strap_context_from_sale_order(
  uuid,uuid,jsonb,text,timestamptz
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_technical_strap_line_migration(
  p_map_id uuid,
  p_measure_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '1500ms'
AS $function$
DECLARE
  v_reference_id uuid;
  v_previous text;
  v_result uuid;
BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();
  -- Mesma ordem fail-fast do wrapper 092, antes de descobrir a referencia.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('strap-pv-auto-intent', 0)
  ) THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE = pg_catalog.jsonb_build_object(
        'code', 'strap_pipeline_busy',
        'message', 'Outra alteracao de tiras ou pedido esta em andamento',
        'details', pg_catalog.format('scope=global; map_id=%s', p_map_id),
        'hint', 'Aguarde a operacao atual terminar e tente novamente uma vez.'
      )::text,
      DETAIL = '{"status":409}';
  END IF;

  SELECT map.technical_sheet_id
    INTO v_reference_id
    FROM public.technical_strap_line_identity_map map
   WHERE map.id = p_map_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha tecnica mapeada inexistente'
      USING ERRCODE = 'P0002';
  END IF;

  v_previous := pg_catalog.current_setting(
    'app.sale_order_item_strap_context_reference_id', true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_strap_context_reference_id',
    v_reference_id::text,
    true
  );
  BEGIN
    v_result := public.resolve_technical_strap_line_migration_impl_115(
      p_map_id,
      p_measure_id,
      p_reason
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.sale_order_item_strap_context_reference_id',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_strap_context_reference_id',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_technical_strap_line_migration(uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_technical_strap_line_migration(uuid,uuid,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_sale_order_item_strap_sourcing(
  p_sale_order_item_id uuid,
  p_expected_revision integer,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous text;
  v_result jsonb;
BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();
  v_previous := pg_catalog.current_setting(
    'app.sale_order_item_strap_sourcing_item_id', true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_strap_sourcing_item_id',
    p_sale_order_item_id::text,
    true
  );
  BEGIN
    v_result := public.set_sale_order_item_strap_sourcing_impl_115(
      p_sale_order_item_id,
      p_expected_revision,
      p_lines
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.sale_order_item_strap_sourcing_item_id',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_strap_sourcing_item_id',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

-- A escolha comum foi aposentada pela derivacao automatica em 055. O wrapper
-- existe apenas para dependencias owner antigas; nao volta a ser RPC.
REVOKE ALL ON FUNCTION public.set_sale_order_item_strap_sourcing(uuid,integer,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.override_sale_order_item_strap_sourcing(
  p_sale_order_item_id uuid,
  p_expected_revision integer,
  p_lines jsonb,
  p_reason text,
  p_correlation_id uuid DEFAULT pg_catalog.gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous text;
  v_result jsonb;
BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();
  v_previous := pg_catalog.current_setting(
    'app.sale_order_item_strap_sourcing_item_id', true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_strap_sourcing_item_id',
    p_sale_order_item_id::text,
    true
  );
  BEGIN
    -- A implementacao preservada continua exigindo admin, motivo, CAS da
    -- revision e neutralizacao atomica de promessas.
    v_result := public.override_sale_order_item_strap_sourcing_impl_115(
      p_sale_order_item_id,
      p_expected_revision,
      p_lines,
      p_reason,
      p_correlation_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.sale_order_item_strap_sourcing_item_id',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_strap_sourcing_item_id',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.override_sale_order_item_strap_sourcing(
  uuid,integer,jsonb,text,uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.override_sale_order_item_strap_sourcing(
  uuid,integer,jsonb,text,uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.try_resolve_open_sale_order_item_strap_migration(
  p_sale_order_item_id uuid,
  p_correlation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous text;
  v_result boolean;
BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();
  v_previous := pg_catalog.current_setting(
    'app.sale_order_item_strap_reconcile_item_id', true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_strap_reconcile_item_id',
    p_sale_order_item_id::text,
    true
  );
  BEGIN
    v_result := public.try_resolve_open_sale_order_item_strap_migration_impl_115(
      p_sale_order_item_id,
      p_correlation_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.sale_order_item_strap_reconcile_item_id',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_strap_reconcile_item_id',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.try_resolve_open_sale_order_item_strap_migration(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Recompila o trigger contra o nome publico novo. Assim uma sessao/plan cache
-- anterior ao rename nao conserva dependencia direta na implementacao privada.
CREATE OR REPLACE FUNCTION public.tg_resolve_open_sale_order_item_strap_migration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item_id uuid;
BEGIN
  IF NEW.source_type = 'sale_order'
     AND NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    FOR v_item_id IN
      SELECT item.id
        FROM public.sale_order_items item
       WHERE item.sale_order_id = NEW.source_id
         AND EXISTS (
           SELECT 1
             FROM public.artisanal_strap_migration_review_items review
            WHERE review.entity_type = 'open_sale_order_item_ambiguous'
              AND review.legacy_id = item.id::text
              AND review.status = 'review_required'
         )
       ORDER BY item.id
    LOOP
      PERFORM public.try_resolve_open_sale_order_item_strap_migration(
        v_item_id,
        NEW.correlation_id
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_resolve_open_sale_order_item_strap_migration()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_artisanal_strap_migration(
  p_run_id uuid,
  p_expected_checksum text,
  p_reason text,
  p_correlation_id uuid DEFAULT pg_catalog.gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous text;
  v_result jsonb;
BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();
  v_previous := pg_catalog.current_setting(
    'app.sale_order_item_cutover_apply_run_id', true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_cutover_apply_run_id',
    p_run_id::text,
    true
  );
  BEGIN
    v_result := public.apply_artisanal_strap_migration_impl_115(
      p_run_id,
      p_expected_checksum,
      p_reason,
      p_correlation_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.sale_order_item_cutover_apply_run_id',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_cutover_apply_run_id',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_artisanal_strap_migration(uuid,text,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_artisanal_strap_migration(uuid,text,text,uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.rollback_artisanal_strap_migration(
  p_cutover_id uuid,
  p_expected_post_checksum text,
  p_reason text,
  p_correlation_id uuid DEFAULT pg_catalog.gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous text;
  v_result jsonb;
BEGIN
  PERFORM public.lock_sale_order_purchase_allocation();
  v_previous := pg_catalog.current_setting(
    'app.sale_order_item_cutover_rollback_id', true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_cutover_rollback_id',
    p_cutover_id::text,
    true
  );
  BEGIN
    v_result := public.rollback_artisanal_strap_migration_impl_115(
      p_cutover_id,
      p_expected_post_checksum,
      p_reason,
      p_correlation_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.sale_order_item_cutover_rollback_id',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_cutover_rollback_id',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.rollback_artisanal_strap_migration(uuid,text,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rollback_artisanal_strap_migration(uuid,text,text,uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Excecoes de orders/order_stages com delta fisico invariavel
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_enforce_production_order_command_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_marker text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_marker := pg_catalog.current_setting(
      'app.outsource_order_metadata_internal', true
    );
    IF v_marker = OLD.id::text
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND (
         pg_catalog.to_jsonb(NEW)
           - ARRAY[
               'outsourced_to_contractor_id', 'outsourced_sector',
               'outsourced_at', 'updated_at'
             ]::text[]
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD)
           - ARRAY[
               'outsourced_to_contractor_id', 'outsourced_sector',
               'outsourced_at', 'updated_at'
             ]::text[]
       ) THEN
      RETURN NEW;
    END IF;

    v_marker := pg_catalog.current_setting(
      'app.material_gate_sale_orders_internal', true
    );
    IF pg_catalog.strpos(
         COALESCE(v_marker, ''),
         ',' || OLD.sale_order_id::text || ','
       ) > 0
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.sale_order_id IS NOT DISTINCT FROM OLD.sale_order_id
       AND (
         pg_catalog.to_jsonb(NEW)
           - ARRAY[
               'material_ready_date', 'material_gate_reason',
               'planned_start', 'updated_at'
             ]::text[]
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD)
           - ARRAY[
               'material_ready_date', 'material_gate_reason',
               'planned_start', 'updated_at'
             ]::text[]
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) = '1'
     OR COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) = '1'
     OR COALESCE(
       pg_catalog.current_setting('app.order_stage_command_internal', true),
       ''
     ) = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'DML direto em orders foi encerrado; use execute_production_order_command'
    USING ERRCODE = 'PZ215';
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_enforce_production_order_command_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_enforce_order_stage_command_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_marker text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_marker := pg_catalog.current_setting(
      'app.outsource_stage_block_internal', true
    );
    IF v_marker = OLD.order_id::text
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id
       AND (
         pg_catalog.to_jsonb(NEW)
           - ARRAY['blocked_until', 'blocked_reason', 'updated_at']::text[]
       ) IS NOT DISTINCT FROM (
         pg_catalog.to_jsonb(OLD)
           - ARRAY['blocked_until', 'blocked_reason', 'updated_at']::text[]
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR COALESCE(
       pg_catalog.current_setting('app.order_stage_command_internal', true),
       ''
     ) = '1'
     OR COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) = '1'
     OR COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'DML direto em order_stages foi encerrado; use execute_order_stage_command ou apontar_producao_setor'
    USING ERRCODE = 'PZ220';
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_enforce_order_stage_command_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

DO $preserve_order_compat_impls$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.create_op_service_order(uuid,text,uuid,numeric,numeric,date)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.create_op_service_order_impl_115(uuid,text,uuid,numeric,numeric,date)'
     ) IS NULL THEN
    ALTER FUNCTION public.create_op_service_order(uuid,text,uuid,numeric,numeric,date)
      RENAME TO create_op_service_order_impl_115;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.recompute_material_gate_for_sale_orders(uuid[])'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.recompute_material_gate_for_sale_orders_impl_115(uuid[])'
     ) IS NULL THEN
    ALTER FUNCTION public.recompute_material_gate_for_sale_orders(uuid[])
      RENAME TO recompute_material_gate_for_sale_orders_impl_115;
  END IF;

END;
$preserve_order_compat_impls$;

REVOKE ALL ON FUNCTION
  public.create_op_service_order_impl_115(uuid,text,uuid,numeric,numeric,date),
  public.recompute_material_gate_for_sale_orders_impl_115(uuid[])
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_op_service_order(
  p_order_id uuid,
  p_sector text,
  p_contractor_id uuid,
  p_quantity numeric DEFAULT NULL,
  p_unit_price numeric DEFAULT NULL,
  p_quoted_deadline date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_order_id uuid;
  v_locked_sale_order_id uuid;
  v_previous text;
  v_result jsonb;
BEGIN
  SELECT production_order.sale_order_id
    INTO v_sale_order_id
    FROM public.orders production_order
   WHERE production_order.id = p_order_id
     AND production_order.deleted_at IS NULL;
  IF NOT FOUND OR v_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'OP nao encontrada ou sem PV de origem'
      USING ERRCODE = 'P0002';
  END IF;

  -- Hierarquia viva do modulo: PV -> global de terceirizacao -> OP.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || v_sale_order_id::text,
    0
  ));
  PERFORM 1
    FROM public.sale_orders sale
   WHERE sale.id = v_sale_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV da OP nao encontrado' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'production-order:' || p_order_id::text,
    0
  ));
  SELECT production_order.sale_order_id
    INTO v_locked_sale_order_id
    FROM public.orders production_order
   WHERE production_order.id = p_order_id
     AND production_order.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND OR v_locked_sale_order_id IS DISTINCT FROM v_sale_order_id THEN
    RAISE EXCEPTION 'Escopo PV/OP mudou durante a criacao da OS; tente novamente'
      USING ERRCODE = '40001';
  END IF;

  v_previous := pg_catalog.current_setting(
    'app.outsource_order_metadata_internal', true
  );
  PERFORM pg_catalog.set_config(
    'app.outsource_order_metadata_internal',
    p_order_id::text,
    true
  );
  BEGIN
    v_result := public.create_op_service_order_impl_115(
      p_order_id,
      p_sector,
      p_contractor_id,
      p_quantity,
      p_unit_price,
      p_quoted_deadline
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.outsource_order_metadata_internal',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.outsource_order_metadata_internal',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_op_service_order(
  uuid,text,uuid,numeric,numeric,date
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_op_service_order(
  uuid,text,uuid,numeric,numeric,date
) TO service_role;

CREATE OR REPLACE FUNCTION public.recompute_material_gate_for_sale_orders(
  p_sale_order_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_order_ids uuid[] := '{}'::uuid[];
  v_order_ids uuid[] := '{}'::uuid[];
  v_current_order_ids uuid[] := '{}'::uuid[];
  v_id uuid;
  v_previous text;
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(scope_id ORDER BY scope_id),
           '{}'::uuid[]
         )
    INTO v_sale_order_ids
    FROM (
      SELECT DISTINCT input_id AS scope_id
        FROM pg_catalog.unnest(COALESCE(p_sale_order_ids, '{}'::uuid[]))
          AS input_ids(input_id)
       WHERE input_id IS NOT NULL
    ) scope;

  FOREACH v_id IN ARRAY v_sale_order_ids
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_id::text,
      0
    ));
  END LOOP;
  PERFORM 1
    FROM public.sale_orders sale
   WHERE sale.id = ANY(v_sale_order_ids)
   ORDER BY sale.id
   FOR UPDATE;

  SELECT COALESCE(
           pg_catalog.array_agg(scope_id ORDER BY scope_id),
           '{}'::uuid[]
         )
    INTO v_order_ids
    FROM (
      SELECT production_order.id AS scope_id
        FROM public.orders production_order
       WHERE production_order.sale_order_id = ANY(v_sale_order_ids)
         AND production_order.deleted_at IS NULL
    ) scope;

  FOREACH v_id IN ARRAY v_order_ids
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'production-order:' || v_id::text,
      0
    ));
  END LOOP;
  PERFORM 1
    FROM public.orders production_order
   WHERE production_order.id = ANY(v_order_ids)
   ORDER BY production_order.id
   FOR UPDATE;

  SELECT COALESCE(
           pg_catalog.array_agg(scope_id ORDER BY scope_id),
           '{}'::uuid[]
         )
    INTO v_current_order_ids
    FROM (
      SELECT production_order.id AS scope_id
        FROM public.orders production_order
       WHERE production_order.sale_order_id = ANY(v_sale_order_ids)
         AND production_order.deleted_at IS NULL
    ) scope;
  IF v_current_order_ids IS DISTINCT FROM v_order_ids THEN
    RAISE EXCEPTION 'Escopo de OPs do gate material mudou; tente novamente'
      USING ERRCODE = '40001';
  END IF;

  v_previous := pg_catalog.current_setting(
    'app.material_gate_sale_orders_internal', true
  );
  PERFORM pg_catalog.set_config(
    'app.material_gate_sale_orders_internal',
    ',' || COALESCE(pg_catalog.array_to_string(v_sale_order_ids, ','), '') || ',',
    true
  );
  BEGIN
    v_result := public.recompute_material_gate_for_sale_orders_impl_115(
      v_sale_order_ids
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.material_gate_sale_orders_internal',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.material_gate_sale_orders_internal',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_material_gate_for_sale_orders(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_material_gate_for_sale_orders(uuid[])
  TO authenticated, service_role;

-- Corpo pequeno remontado no mesmo OID/nome: todos os triggers continuam
-- apontando para este wrapper e nunca para uma implementacao sem marker.
CREATE OR REPLACE FUNCTION public.refresh_outsource_stage_blocks(
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous text;
BEGIN
  IF p_order_id IS NULL THEN RETURN; END IF;

  v_previous := pg_catalog.current_setting(
    'app.outsource_stage_block_internal', true
  );
  PERFORM pg_catalog.set_config(
    'app.outsource_stage_block_internal',
    p_order_id::text,
    true
  );
  BEGIN
    UPDATE public.order_stages stage
       SET blocked_until = NULL,
           blocked_reason = NULL,
           updated_at = pg_catalog.now()
     WHERE stage.order_id = p_order_id
       AND stage.blocked_reason ILIKE 'Aguardando OS terceirizada%';

    WITH distinct_reasons AS (
      SELECT DISTINCT
        dependency.service_order_id,
        dependency.block_stage,
        dependency.block_until,
        dependency.reason_item
      FROM public.get_outsource_open_stage_dependencies(p_order_id) dependency
    ),
    aggregated AS (
      SELECT
        block_stage,
        pg_catalog.max(block_until) AS blocked_until,
        pg_catalog.string_agg(reason_item, ', ' ORDER BY reason_item) AS reasons
      FROM distinct_reasons
      GROUP BY block_stage
    )
    UPDATE public.order_stages stage
       SET blocked_until = aggregated.blocked_until,
           blocked_reason = pg_catalog.format(
             'Aguardando OS terceirizada: %s — retorno maximo %s',
             aggregated.reasons,
             COALESCE(
               pg_catalog.to_char(aggregated.blocked_until, 'DD/MM/YYYY'),
               'sem prazo'
             )
           ),
           updated_at = pg_catalog.now()
      FROM aggregated
     WHERE stage.order_id = p_order_id
       AND stage.stage_name = aggregated.block_stage;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.outsource_stage_block_internal',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.outsource_stage_block_internal',
    COALESCE(v_previous, ''),
    true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_outsource_stage_blocks(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_outsource_stage_blocks(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3) sync_wave_from_kanban: gate humano e caminho trigger privado
-- ---------------------------------------------------------------------------

DO $preserve_wave_sync_impl$
BEGIN
  IF pg_catalog.to_regprocedure('public.sync_wave_from_kanban(uuid)') IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.sync_wave_from_kanban_impl_115(uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.sync_wave_from_kanban(uuid)
      RENAME TO sync_wave_from_kanban_impl_115;
  END IF;
END;
$preserve_wave_sync_impl$;

REVOKE ALL ON FUNCTION public.sync_wave_from_kanban_impl_115(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_wave_from_kanban_locked_internal_115(
  p_wave_id uuid
)
RETURNS public.production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_order_ids uuid[] := '{}'::uuid[];
  v_current_sale_order_ids uuid[] := '{}'::uuid[];
  v_order_ids uuid[] := '{}'::uuid[];
  v_current_order_ids uuid[] := '{}'::uuid[];
  v_id uuid;
  v_result public.production_stage_enum;
BEGIN
  IF pg_catalog.current_setting('app.wave_sync_internal', true)
       IS DISTINCT FROM p_wave_id::text THEN
    RAISE EXCEPTION 'Funcao interna: use sync_wave_from_kanban'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(scope_id ORDER BY scope_id),
           '{}'::uuid[]
         )
    INTO v_sale_order_ids
    FROM (
      SELECT DISTINCT source.sale_order_id AS scope_id
        FROM public.production_wave_items item
        JOIN public.production_wave_item_sources source
          ON source.wave_item_id = item.id
       WHERE item.wave_id = p_wave_id
         AND source.sale_order_id IS NOT NULL
    ) scope;

  FOREACH v_id IN ARRAY v_sale_order_ids
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_id::text,
      0
    ));
  END LOOP;
  PERFORM 1
    FROM public.sale_orders sale
   WHERE sale.id = ANY(v_sale_order_ids)
   ORDER BY sale.id
   FOR UPDATE;

  SELECT COALESCE(
           pg_catalog.array_agg(scope_id ORDER BY scope_id),
           '{}'::uuid[]
         )
    INTO v_order_ids
    FROM (
      SELECT production_order.id AS scope_id
        FROM public.orders production_order
       WHERE production_order.sale_order_id = ANY(v_sale_order_ids)
         AND production_order.deleted_at IS NULL
    ) scope;

  FOREACH v_id IN ARRAY v_order_ids
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'production-order:' || v_id::text,
      0
    ));
  END LOOP;
  PERFORM 1
    FROM public.orders production_order
   WHERE production_order.id = ANY(v_order_ids)
   ORDER BY production_order.id
   FOR UPDATE;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'production-wave:' || p_wave_id::text,
    0
  ));
  PERFORM 1
    FROM public.production_waves wave
   WHERE wave.id = p_wave_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Onda % nao encontrada', p_wave_id
      USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1
    FROM public.production_wave_items item
   WHERE item.wave_id = p_wave_id
   ORDER BY item.id
   FOR UPDATE;
  PERFORM 1
    FROM public.production_wave_item_sources source
   WHERE source.wave_item_id IN (
     SELECT item.id
       FROM public.production_wave_items item
      WHERE item.wave_id = p_wave_id
   )
   ORDER BY source.id
   FOR UPDATE;

  SELECT COALESCE(
           pg_catalog.array_agg(scope_id ORDER BY scope_id),
           '{}'::uuid[]
         )
    INTO v_current_sale_order_ids
    FROM (
      SELECT DISTINCT source.sale_order_id AS scope_id
        FROM public.production_wave_items item
        JOIN public.production_wave_item_sources source
          ON source.wave_item_id = item.id
       WHERE item.wave_id = p_wave_id
         AND source.sale_order_id IS NOT NULL
    ) scope;
  IF v_current_sale_order_ids IS DISTINCT FROM v_sale_order_ids THEN
    RAISE EXCEPTION 'Escopo de PVs da onda mudou; tente novamente'
      USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(scope_id ORDER BY scope_id),
           '{}'::uuid[]
         )
    INTO v_current_order_ids
    FROM (
      SELECT production_order.id AS scope_id
        FROM public.orders production_order
       WHERE production_order.sale_order_id = ANY(v_sale_order_ids)
         AND production_order.deleted_at IS NULL
    ) scope;
  IF v_current_order_ids IS DISTINCT FROM v_order_ids THEN
    RAISE EXCEPTION 'Escopo de OPs da onda mudou; tente novamente'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
    FROM public.production_wave_stages wave_stage
   WHERE wave_stage.wave_id = p_wave_id
   ORDER BY public.stage_order(wave_stage.stage), wave_stage.stage
   FOR UPDATE;
  PERFORM 1
    FROM public.order_stages stage
   WHERE stage.order_id = ANY(v_order_ids)
   ORDER BY stage.order_id, stage.id
   FOR UPDATE;

  v_result := public.sync_wave_from_kanban_impl_115(p_wave_id);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_wave_from_kanban_locked_internal_115(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_wave_from_kanban(
  p_wave_id uuid
)
RETURNS public.production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous text;
  v_result public.production_stage_enum;
BEGIN
  IF COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '')
       <> 'service_role'
     AND NOT public.can_execute_production_pointing() THEN
    RAISE EXCEPTION
      'Permission denied: sincronizar onda exige permissao de apontamento'
      USING ERRCODE = '42501';
  END IF;
  IF p_wave_id IS NULL THEN
    RAISE EXCEPTION 'wave_id e obrigatorio' USING ERRCODE = '22004';
  END IF;

  v_previous := pg_catalog.current_setting('app.wave_sync_internal', true);
  PERFORM pg_catalog.set_config(
    'app.wave_sync_internal',
    p_wave_id::text,
    true
  );
  BEGIN
    v_result := public.sync_wave_from_kanban_locked_internal_115(p_wave_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.wave_sync_internal',
      COALESCE(v_previous, ''),
      true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.wave_sync_internal',
    COALESCE(v_previous, ''),
    true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_wave_from_kanban(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_wave_from_kanban(uuid)
  TO authenticated, service_role;

-- Trigger owner: nao passa pelo endpoint humano; abre o mesmo marker e usa o
-- mesmo lock/revalidation helper privado.
CREATE OR REPLACE FUNCTION public.fn_sync_wave_on_stage_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_wave_id uuid;
  v_previous text;
BEGIN
  IF NEW.status NOT IN ('concluido', 'completed', 'done', 'pronto')
     OR OLD.status IN ('concluido', 'completed', 'done', 'pronto') THEN
    RETURN NEW;
  END IF;

  SELECT DISTINCT item.wave_id
    INTO v_wave_id
    FROM public.orders production_order
    JOIN public.production_wave_item_sources source
      ON source.sale_order_id = production_order.sale_order_id
    JOIN public.production_wave_items item ON item.id = source.wave_item_id
    JOIN public.production_waves wave ON wave.id = item.wave_id
   WHERE production_order.id = NEW.order_id
     AND wave.status = 'running'
   ORDER BY item.wave_id
   LIMIT 1;

  IF v_wave_id IS NOT NULL THEN
    v_previous := pg_catalog.current_setting('app.wave_sync_internal', true);
    PERFORM pg_catalog.set_config(
      'app.wave_sync_internal',
      v_wave_id::text,
      true
    );
    BEGIN
      PERFORM public.sync_wave_from_kanban_locked_internal_115(v_wave_id);
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_catalog.set_config(
        'app.wave_sync_internal',
        COALESCE(v_previous, ''),
        true
      );
      RAISE;
    END;
    PERFORM pg_catalog.set_config(
      'app.wave_sync_internal',
      COALESCE(v_previous, ''),
      true
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_sync_wave_on_stage_complete()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) ACL: helpers crus de estoque/reserva/compra ficam owner-only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.initialize_order_material_reservations(uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.debit_strap_stock(jsonb,integer,uuid,jsonb,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.debit_packaging_for_order(uuid,uuid,uuid,integer,text,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_order_reservations(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.convert_reservation_to_out(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.try_reserve_materials(
  uuid,uuid,numeric,text,date,boolean,boolean,text,boolean,boolean
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.process_order_stock_out(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_sole_grade_for_order(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_product_stocks_for_order(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_missing_materials_for_order(uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resync_reservations_for_sheet(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.refresh_order_reservations(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_qty_devolvida(uuid,numeric)
  FROM PUBLIC, anon, authenticated, service_role;
-- Job semanal de lead time: somente o owner/cron via service_role pode
-- reescrever o cadastro que alimenta o MRP. Usuario humano nao dispara o
-- recalculo SECURITY DEFINER fora da agenda operacional.
REVOKE ALL ON FUNCTION public.recalc_supplier_lead_from_history()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_supplier_lead_from_history()
  TO service_role;

-- Endpoint experimental sem migration/caller vivo e com ledger incompatível.
-- DROP evita que um grant futuro ressuscite a baixa fora do command canonico.
DROP FUNCTION IF EXISTS public.consume_from_lot(uuid,uuid,numeric,text);

-- ---------------------------------------------------------------------------
-- 4b) Picking: epoch -> PV/sessao -> produtos UUID -> itens/implementacao
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.commit_picking_for_sale_order(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_previous text;
  v_product_ids uuid[];
  v_result jsonb;
BEGIN
  PERFORM public.assert_strap_picking_writer();
  PERFORM public.lock_sale_order_purchase_allocation();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || p_sale_order_id::text,
    0
  ));
  PERFORM sale_order.id
    FROM public.sale_orders sale_order
   WHERE sale_order.id = p_sale_order_id
     AND sale_order.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de Venda nao encontrado: %', p_sale_order_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(
           pg_catalog.array_agg(scope.product_id ORDER BY scope.product_id),
           ARRAY[]::uuid[]
         )
    INTO v_product_ids
    FROM (
      SELECT DISTINCT reservation.product_id
        FROM public.material_reservations reservation
        JOIN public.orders production_order
          ON production_order.id = reservation.order_id
        JOIN public.products product ON product.id = reservation.product_id
       WHERE production_order.sale_order_id = p_sale_order_id
         AND reservation.status IN ('reserved', 'partially_consumed')
    ) scope;
  PERFORM public.lock_sale_order_purchase_products(v_product_ids);

  v_previous := pg_catalog.current_setting('app.sale_order_picking_internal', true);
  PERFORM pg_catalog.set_config(
    'app.sale_order_picking_internal', p_sale_order_id::text, true
  );
  BEGIN
    v_result := public.commit_picking_for_sale_order_legacy_202701(p_sale_order_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.sale_order_picking_internal', COALESCE(v_previous, ''), true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.sale_order_picking_internal', COALESCE(v_previous, ''), true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_picking_for_sale_order(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.commit_picking_for_sale_order(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.commit_picking_session(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_order_hint uuid;
  v_sale_order_id uuid;
  v_product_ids uuid[];
  v_previous text;
  v_result jsonb;
BEGIN
  PERFORM public.assert_strap_picking_writer();
  PERFORM public.lock_sale_order_purchase_allocation();

  SELECT session.sale_order_id
    INTO v_sale_order_hint
    FROM public.picking_sessions session
   WHERE session.id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessao de picking nao encontrada: %', p_session_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_sale_order_hint IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_sale_order_hint::text,
      0
    ));
    PERFORM sale_order.id
      FROM public.sale_orders sale_order
     WHERE sale_order.id = v_sale_order_hint
       AND sale_order.deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PV da sessao de picking nao encontrado'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'picking-session:' || p_session_id::text,
    0
  ));
  SELECT session.sale_order_id
    INTO v_sale_order_id
    FROM public.picking_sessions session
   WHERE session.id = p_session_id
   FOR UPDATE;
  IF NOT FOUND OR v_sale_order_id IS DISTINCT FROM v_sale_order_hint THEN
    RAISE EXCEPTION 'Escopo da sessao de picking mudou durante os locks'
      USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(scope.product_id ORDER BY scope.product_id),
           ARRAY[]::uuid[]
         )
    INTO v_product_ids
    FROM (
      SELECT DISTINCT item.product_id
        FROM public.picking_items item
        JOIN public.products product ON product.id = item.product_id
       WHERE item.picking_session_id = p_session_id
         AND item.picked_qty > item.committed_qty
    ) scope;
  PERFORM public.lock_sale_order_purchase_products(v_product_ids);

  v_previous := pg_catalog.current_setting('app.sale_order_picking_internal', true);
  PERFORM pg_catalog.set_config(
    'app.sale_order_picking_internal', COALESCE(v_sale_order_id::text, ''), true
  );
  BEGIN
    v_result := public.commit_picking_session_legacy_202701(p_session_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.sale_order_picking_internal', COALESCE(v_previous, ''), true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.sale_order_picking_internal', COALESCE(v_previous, ''), true
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_picking_session(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.commit_picking_session(uuid)
  TO authenticated;

-- Corte de cabedal terceirizado debita napa e cria OS. A implementacao legada
-- fica owner-only; o wrapper fecha RBAC e a ordem epoch -> PV -> OPs -> produtos.
DO $preserve_upper_cut_impl_115$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.create_upper_cut_service_order(uuid,uuid,text,uuid,integer,text,text,numeric,date)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.create_upper_cut_service_order_impl_115(uuid,uuid,text,uuid,integer,text,text,numeric,date)'
     ) IS NULL THEN
    ALTER FUNCTION public.create_upper_cut_service_order(
      uuid,uuid,text,uuid,integer,text,text,numeric,date
    ) RENAME TO create_upper_cut_service_order_impl_115;
  END IF;
END;
$preserve_upper_cut_impl_115$;

REVOKE ALL ON FUNCTION public.create_upper_cut_service_order_impl_115(
  uuid,uuid,text,uuid,integer,text,text,numeric,date
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_upper_cut_service_order(
  p_sale_order_id uuid,
  p_reference_id uuid,
  p_color text,
  p_contractor_id uuid,
  p_pairs integer,
  p_description text,
  p_order_number text,
  p_unit_price numeric DEFAULT 0,
  p_service_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order_id uuid;
  v_product_ids uuid[];
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
     OR NOT public.can_execute_production_pointing() THEN
    RAISE EXCEPTION
      'Permission denied: OS de corte exige permissao operacional de Producao'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.lock_sale_order_purchase_allocation();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || p_sale_order_id::text,
    0
  ));
  PERFORM sale_order.id
    FROM public.sale_orders sale_order
   WHERE sale_order.id = p_sale_order_id
     AND sale_order.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % nao encontrado para OS de corte', p_sale_order_id
      USING ERRCODE = 'P0002';
  END IF;
  FOR v_order_id IN
    SELECT production_order.id
      FROM public.orders production_order
     WHERE production_order.sale_order_id = p_sale_order_id
       AND production_order.deleted_at IS NULL
     ORDER BY production_order.id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'production-order:' || v_order_id::text,
      0
    ));
  END LOOP;
  PERFORM production_order.id
    FROM public.orders production_order
   WHERE production_order.sale_order_id = p_sale_order_id
     AND production_order.deleted_at IS NULL
   ORDER BY production_order.id
   FOR UPDATE;

  SELECT COALESCE(
           pg_catalog.array_agg(scope.product_id ORDER BY scope.product_id),
           ARRAY[]::uuid[]
         )
    INTO v_product_ids
    FROM (
      SELECT DISTINCT NULLIF(line.value ->> 'product_id', '')::uuid AS product_id
        FROM public.sale_order_items item
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
          public.calculate_order_consumption(
            p_reference_id,
            item.quantity::numeric,
            item.color,
            NULL,
            item.material_variant_id
          )
        ) line(value)
       WHERE item.sale_order_id = p_sale_order_id
         AND item.reference_id = p_reference_id
         AND pg_catalog.lower(pg_catalog.btrim(extensions.unaccent(COALESCE(item.color, ''))))
           = pg_catalog.lower(pg_catalog.btrim(extensions.unaccent(COALESCE(p_color, ''))))
         AND COALESCE(item.quantity, 0) > 0
         AND line.value ->> 'component' = 'Cabedal'
         AND NULLIF(line.value ->> 'product_id', '') IS NOT NULL
    ) scope
   WHERE scope.product_id IS NOT NULL;
  PERFORM public.lock_sale_order_purchase_products(v_product_ids);

  RETURN public.create_upper_cut_service_order_impl_115(
    p_sale_order_id,
    p_reference_id,
    p_color,
    p_contractor_id,
    p_pairs,
    p_description,
    p_order_number,
    p_unit_price,
    p_service_date
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_upper_cut_service_order(
  uuid,uuid,text,uuid,integer,text,text,numeric,date
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_upper_cut_service_order(
  uuid,uuid,text,uuid,integer,text,text,numeric,date
) TO authenticated;

-- Nao ha caller UI/Edge dos compactadores. O wrapper autenticado e os helpers
-- deixam de ser atalhos para escrita de PV/OP fora dos commands 105/108.
REVOKE ALL ON FUNCTION public.compact_sale_order(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.compact_sale_order_items(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.compact_orders_by_ref_color(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Writer de compra auto_pv orfao e forjavel pelo payload: somente owner.
REVOKE ALL ON FUNCTION public.upsert_open_purchase_order(uuid,text,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) consume_all: lock canonico e OP terminal recusada antes da embalagem
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lock_order_reservation_destinations_115(
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_destination_id uuid;
  v_locked_id uuid;
BEGIN
  -- Uma unica ordem UUID para products e box_types. O loop antigo por
  -- kind/created_at podia tomar P1 -> P2 enquanto outra OP tomava P2 -> P1.
  FOR v_destination_id IN
    SELECT DISTINCT reservation.product_id
      FROM public.material_reservations reservation
     WHERE reservation.order_id = p_order_id
       AND reservation.status IN ('reserved', 'partially_consumed')
       AND reservation.product_id IS NOT NULL
     ORDER BY reservation.product_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'reservation-stock:' || v_destination_id::text,
      0
    ));
    v_locked_id := NULL;
    SELECT product.id
      INTO v_locked_id
      FROM public.products product
     WHERE product.id = v_destination_id
     FOR UPDATE;
    IF v_locked_id IS NOT NULL THEN
      CONTINUE;
    END IF;
    SELECT box_type.id
      INTO v_locked_id
      FROM public.box_types box_type
     WHERE box_type.id = v_destination_id
     FOR UPDATE;
    IF v_locked_id IS NULL THEN
      RAISE EXCEPTION
        'Destino % de reserva da OP % nao existe em products/box_types',
        v_destination_id,
        p_order_id
        USING ERRCODE = 'PZ212';
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.lock_order_reservation_destinations_115(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

DO $preserve_consume_all_impl$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.consume_all_reservations_for_order(uuid,text)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.consume_all_reservations_for_order_impl_115(uuid,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.consume_all_reservations_for_order(uuid,text)
      RENAME TO consume_all_reservations_for_order_impl_115;
  END IF;
END;
$preserve_consume_all_impl$;

REVOKE ALL ON FUNCTION public.consume_all_reservations_for_order_impl_115(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_all_reservations_for_order(
  p_order_id uuid,
  p_picked_by text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id e obrigatorio' USING ERRCODE = '22004';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'production-order:' || p_order_id::text,
    0
  ));
  SELECT production_order.status
    INTO v_status
    FROM public.orders production_order
   WHERE production_order.id = p_order_id
     AND production_order.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % nao encontrada', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF pg_catalog.lower(pg_catalog.btrim(COALESCE(v_status, ''))) IN (
    'cancelada', 'cancelado', 'cancelled',
    'finalizado', 'finalizada', 'concluido', 'concluida',
    'concluído', 'concluída'
  ) THEN
    RAISE EXCEPTION
      'OP % esta terminal e nao aceita consumo/picking de reservas',
      p_order_id
      USING ERRCODE = 'PZ216';
  END IF;

  PERFORM public.lock_order_reservation_destinations_115(p_order_id);

  RETURN public.consume_all_reservations_for_order_impl_115(
    p_order_id,
    p_picked_by
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_all_reservations_for_order(uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_all_reservations_for_order(uuid,text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Writers vivos de OC: SECURITY DEFINER respeita RBAC admin/gerente
-- ---------------------------------------------------------------------------

DO $preserve_purchase_writer_impls$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.create_purchase_order_normalized(text,uuid,text,text,jsonb)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.create_purchase_order_normalized_impl_115(text,uuid,text,text,jsonb)'
     ) IS NULL THEN
    ALTER FUNCTION public.create_purchase_order_normalized(
      text,uuid,text,text,jsonb
    ) RENAME TO create_purchase_order_normalized_impl_115;
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.upsert_po_item_atomic(uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.upsert_po_item_atomic_impl_115(uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.upsert_po_item_atomic(
      uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text
    ) RENAME TO upsert_po_item_atomic_impl_115;
  END IF;
END;
$preserve_purchase_writer_impls$;

REVOKE ALL ON FUNCTION
  public.create_purchase_order_normalized_impl_115(text,uuid,text,text,jsonb),
  public.upsert_po_item_atomic_impl_115(
    uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text
  )
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_purchase_order_normalized(
  p_supplier_name text,
  p_supplier_id uuid,
  p_notes text,
  p_idempotency_key text,
  p_items jsonb
)
RETURNS public.purchase_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result public.purchase_orders;
  v_product_ids uuid[];
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION
      'Permission denied: criar OC exige Administracao ou Gerencia'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.lock_sale_order_purchase_allocation();

  SELECT COALESCE(
           pg_catalog.array_agg(scope_id ORDER BY scope_id),
           '{}'::uuid[]
         )
    INTO v_product_ids
    FROM (
      SELECT DISTINCT NULLIF(item.value ->> 'product_id', '')::uuid AS scope_id
        FROM pg_catalog.jsonb_array_elements(
          CASE
            WHEN pg_catalog.jsonb_typeof(p_items) = 'array' THEN p_items
            ELSE '[]'::jsonb
          END
        ) AS item(value)
       WHERE NULLIF(item.value ->> 'product_id', '') IS NOT NULL
    ) scope;
  PERFORM public.lock_sale_order_purchase_products(v_product_ids);

  v_result := public.create_purchase_order_normalized_impl_115(
    p_supplier_name,
    p_supplier_id,
    p_notes,
    p_idempotency_key,
    p_items
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_purchase_order_normalized(
  text,uuid,text,text,jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order_normalized(
  text,uuid,text,text,jsonb
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_po_item_atomic(
  p_po_id uuid,
  p_product_id uuid,
  p_qty_delta numeric,
  p_unit_price numeric,
  p_unit text DEFAULT 'un',
  p_current_stock numeric DEFAULT 0,
  p_min_stock numeric DEFAULT 0,
  p_max_stock numeric DEFAULT 0,
  p_grade_delta jsonb DEFAULT NULL,
  p_color text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_locked_po_id uuid;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION
      'Permission denied: alterar item de OC exige Administracao ou Gerencia'
      USING ERRCODE = '42501';
  END IF;

  -- Ordem comum da 111: produto -> cabecalho da OC -> itens.
  PERFORM public.lock_sale_order_purchase_allocation();
  PERFORM public.lock_sale_order_purchase_products(ARRAY[p_product_id]);
  SELECT purchase_order.id
    INTO v_locked_po_id
    FROM public.purchase_orders purchase_order
   WHERE purchase_order.id = p_po_id
   FOR UPDATE;
  IF NOT FOUND OR v_locked_po_id IS DISTINCT FROM p_po_id THEN
    RAISE EXCEPTION 'OC % nao encontrada ou mudou durante o upsert', p_po_id
      USING ERRCODE = '40001';
  END IF;
  PERFORM 1
    FROM public.purchase_order_items item
   WHERE item.purchase_order_id = p_po_id
     AND item.product_id = p_product_id
   ORDER BY item.id
   FOR UPDATE;

  RETURN public.upsert_po_item_atomic_impl_115(
    p_po_id,
    p_product_id,
    p_qty_delta,
    p_unit_price,
    p_unit,
    p_current_stock,
    p_min_stock,
    p_max_stock,
    p_grade_delta,
    p_color
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_po_item_atomic(
  uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_po_item_atomic(
  uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6b) Callers de terceirizacao: PV(s) sempre antes do advisory global
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lock_outsource_sale_orders_before_global_115(
  p_sale_order_ids uuid[]
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
BEGIN
  SELECT COALESCE(
           pg_catalog.array_agg(scope_id ORDER BY scope_id),
           '{}'::uuid[]
         )
    INTO v_ids
    FROM (
      SELECT DISTINCT input_id AS scope_id
        FROM pg_catalog.unnest(COALESCE(p_sale_order_ids, '{}'::uuid[]))
          AS input_ids(input_id)
       WHERE input_id IS NOT NULL
    ) scope;

  FOREACH v_id IN ARRAY v_ids
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_id::text,
      0
    ));
  END LOOP;
  PERFORM 1
    FROM public.sale_orders sale
   WHERE sale.id = ANY(v_ids)
   ORDER BY sale.id
   FOR UPDATE;

  RETURN v_ids;
END;
$function$;

REVOKE ALL ON FUNCTION public.lock_outsource_sale_orders_before_global_115(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

DO $preserve_outsource_callers$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.commit_capacity_overflow_outsourcing(jsonb)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.commit_capacity_overflow_outsourcing_impl_115(jsonb)'
     ) IS NULL THEN
    ALTER FUNCTION public.commit_capacity_overflow_outsourcing(jsonb)
      RENAME TO commit_capacity_overflow_outsourcing_impl_115;
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.send_item_sector_os(uuid,text,uuid)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.send_item_sector_os_impl_115(uuid,text,uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.send_item_sector_os(uuid,text,uuid)
      RENAME TO send_item_sector_os_impl_115;
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.generate_configured_outsource_orders_for_order(uuid)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.generate_configured_outsource_orders_for_order_impl_115(uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.generate_configured_outsource_orders_for_order(uuid)
      RENAME TO generate_configured_outsource_orders_for_order_impl_115;
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.generate_op_service_orders(uuid,jsonb)'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.generate_op_service_orders_impl_115(uuid,jsonb)'
     ) IS NULL THEN
    ALTER FUNCTION public.generate_op_service_orders(uuid,jsonb)
      RENAME TO generate_op_service_orders_impl_115;
  END IF;
END;
$preserve_outsource_callers$;

REVOKE ALL ON FUNCTION
  public.commit_capacity_overflow_outsourcing_impl_115(jsonb),
  public.send_item_sector_os_impl_115(uuid,text,uuid),
  public.generate_configured_outsource_orders_for_order_impl_115(uuid),
  public.generate_op_service_orders_impl_115(uuid,jsonb)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commit_capacity_overflow_outsourcing(
  p_assignments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_order_ids uuid[];
BEGIN
  SELECT COALESCE(
           pg_catalog.array_agg(scope_id ORDER BY scope_id),
           '{}'::uuid[]
         )
    INTO v_sale_order_ids
    FROM (
      SELECT DISTINCT production_order.sale_order_id AS scope_id
        FROM pg_catalog.jsonb_array_elements(
          CASE
            WHEN pg_catalog.jsonb_typeof(p_assignments) = 'array'
              THEN p_assignments
            ELSE '[]'::jsonb
          END
        ) AS assignment(value)
        JOIN public.orders production_order
          ON production_order.id::text = NULLIF(
               pg_catalog.btrim(assignment.value ->> 'order_id'),
               ''
             )
       WHERE production_order.sale_order_id IS NOT NULL
    ) scope;
  PERFORM public.lock_outsource_sale_orders_before_global_115(v_sale_order_ids);
  RETURN public.commit_capacity_overflow_outsourcing_impl_115(p_assignments);
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_capacity_overflow_outsourcing(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_capacity_overflow_outsourcing(jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_item_sector_os(
  p_order_id uuid,
  p_sector text,
  p_contractor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_order_id uuid;
BEGIN
  SELECT production_order.sale_order_id
    INTO v_sale_order_id
    FROM public.orders production_order
   WHERE production_order.id = p_order_id
     AND production_order.deleted_at IS NULL;
  IF v_sale_order_id IS NOT NULL THEN
    PERFORM public.lock_outsource_sale_orders_before_global_115(
      ARRAY[v_sale_order_id]
    );
  END IF;
  RETURN public.send_item_sector_os_impl_115(
    p_order_id,
    p_sector,
    p_contractor_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.send_item_sector_os(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_item_sector_os(uuid,text,uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generate_configured_outsource_orders_for_order(
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_order_id uuid;
BEGIN
  SELECT production_order.sale_order_id
    INTO v_sale_order_id
    FROM public.orders production_order
   WHERE production_order.id = p_order_id
     AND production_order.deleted_at IS NULL;
  IF v_sale_order_id IS NOT NULL THEN
    PERFORM public.lock_outsource_sale_orders_before_global_115(
      ARRAY[v_sale_order_id]
    );
  END IF;
  PERFORM public.generate_configured_outsource_orders_for_order_impl_115(
    p_order_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_configured_outsource_orders_for_order(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_configured_outsource_orders_for_order(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.generate_op_service_orders(
  p_sale_order_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_sale_order_id IS NOT NULL THEN
    PERFORM public.lock_outsource_sale_orders_before_global_115(
      ARRAY[p_sale_order_id]
    );
  END IF;
  RETURN public.generate_op_service_orders_impl_115(
    p_sale_order_id,
    p_lines
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_op_service_orders(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_op_service_orders(uuid,jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_resync_outsource_orders_after_item_intent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order_id uuid;
BEGIN
  IF NEW.outsourced_sectors IS NOT DISTINCT FROM OLD.outsourced_sectors THEN
    RETURN NEW;
  END IF;
  FOR v_order_id IN
    SELECT production_order.id
      FROM public.orders production_order
     WHERE production_order.sale_order_item_id = NEW.id
       AND production_order.deleted_at IS NULL
       AND NOT public.is_inactive_production_order_status(production_order.status)
     ORDER BY production_order.id
  LOOP
    BEGIN
      PERFORM public.generate_configured_outsource_orders_for_order(v_order_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'Resync de terceirizacao pendente apos editar intencao (item % / OP %): %',
        NEW.id,
        v_order_id,
        SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_resync_outsource_orders_after_item_intent()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) Cancelamento aceita estorno parcial e completa somente o debito liquido
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_production_order_internal(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_parent_status text;
  v_has_physical_sole boolean := false;
  v_has_positive_net_debit boolean := false;
  v_has_invalid_ledger boolean := false;
  v_missing_destination uuid;
  v_status_before text;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('app.production_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('app.sale_order_command_internal', true),
       ''
     ) <> '1'
     AND COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role' THEN
    RAISE EXCEPTION 'Funcao interna: use execute_production_order_command'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'production-order:' || p_order_id::text,
    0
  ));
  SELECT * INTO v_order
    FROM public.orders production_order
   WHERE production_order.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % nao encontrada', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  v_status_before := v_order.status;

  IF v_order.status IN ('Cancelada', 'Cancelado') THEN
    RETURN pg_catalog.jsonb_build_object(
      'order_id', v_order.id,
      'status_before', v_status_before,
      'status', 'Cancelada',
      'already_cancelled', true
    );
  END IF;

  SELECT sale.status
    INTO v_parent_status
    FROM public.sale_orders sale
   WHERE sale.id = v_order.sale_order_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV vinculado a OP % nao encontrado', p_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_parent_status IN (
    'Faturado', 'Expedido', 'Concluído', 'Finalizado s/ NF'
  ) THEN
    RAISE EXCEPTION
      'OP vinculada a PV faturado/finalizado; reverta NF/PV antes de cancelar a OP'
      USING ERRCODE = 'PZ211';
  END IF;

  SELECT EXISTS (
           SELECT 1
             FROM public.stock_movements movement
            WHERE movement.order_id = v_order.id
              AND movement.movement_type = 'out'
              AND (
                movement.description ILIKE 'Debito Solado por grade%'
                OR movement.description ILIKE 'Débito Solado por grade%'
                OR movement.description ILIKE 'Baixa na finalização — Solado por grade%'
                OR movement.description ILIKE 'Picking Solado por grade%'
              )
         ),
         EXISTS (
           SELECT 1
             FROM (
               SELECT movement.product_id,
                      pg_catalog.sum(CASE
                        WHEN movement.movement_type = 'out' THEN movement.quantity
                        WHEN movement.movement_type = 'in' THEN -movement.quantity
                        ELSE 0
                      END) AS net_debit
                 FROM public.stock_movements movement
                WHERE movement.order_id = v_order.id
                GROUP BY movement.product_id
             ) ledger
            WHERE ledger.net_debit > 0.0001
         ),
         EXISTS (
           SELECT 1
             FROM public.stock_movements movement
            WHERE movement.order_id = v_order.id
              AND movement.movement_type IN ('in', 'out')
              AND (movement.quantity IS NULL OR movement.quantity <= 0)
         ) OR EXISTS (
           SELECT 1
             FROM (
               SELECT movement.product_id,
                      pg_catalog.sum(CASE
                        WHEN movement.movement_type = 'out' THEN movement.quantity
                        WHEN movement.movement_type = 'in' THEN -movement.quantity
                        ELSE 0
                      END) AS net_debit
                 FROM public.stock_movements movement
                WHERE movement.order_id = v_order.id
                GROUP BY movement.product_id
             ) ledger
            WHERE ledger.net_debit < -0.0001
         )
    INTO v_has_physical_sole,
         v_has_positive_net_debit,
         v_has_invalid_ledger;

  IF v_has_invalid_ledger THEN
    RAISE EXCEPTION
      'Ledger da OP % e invalido; reconciliacao manual obrigatoria',
      v_order.id
      USING ERRCODE = 'PZ212';
  END IF;

  SELECT ledger.product_id
    INTO v_missing_destination
    FROM (
      SELECT movement.product_id,
             pg_catalog.sum(CASE
               WHEN movement.movement_type = 'out' THEN movement.quantity
               WHEN movement.movement_type = 'in' THEN -movement.quantity
               ELSE 0
             END) AS net_debit
        FROM public.stock_movements movement
       WHERE movement.order_id = v_order.id
       GROUP BY movement.product_id
    ) ledger
    LEFT JOIN public.products product ON product.id = ledger.product_id
    LEFT JOIN public.box_types box_type ON box_type.id = ledger.product_id
   WHERE ledger.net_debit > 0.0001
     AND product.id IS NULL
     AND box_type.id IS NULL
   ORDER BY ledger.product_id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'Destino % do ledger da OP % nao existe em products/box_types',
      v_missing_destination,
      v_order.id
      USING ERRCODE = 'PZ212';
  END IF;

  PERFORM public.release_order_reservations(v_order.id);

  -- Os restores 112 calculam SUM(out)-SUM(in), travam os destinos e sao
  -- idempotentes. Uma entrada parcial deixa somente o saldo para esta chamada.
  IF v_has_physical_sole THEN
    PERFORM public.restore_sole_grade_for_order(v_order.id);
  END IF;
  IF v_has_positive_net_debit THEN
    PERFORM public.restore_product_stocks_for_order(v_order.id);
  END IF;

  -- Nenhum warning de destino ausente pode permitir cancelar com ledger aberto.
  IF EXISTS (
    SELECT 1
      FROM public.stock_movements movement
     WHERE movement.order_id = v_order.id
     GROUP BY movement.product_id
    HAVING pg_catalog.sum(CASE
      WHEN movement.movement_type = 'out' THEN movement.quantity
      WHEN movement.movement_type = 'in' THEN -movement.quantity
      ELSE 0
    END) > 0.0001
  ) THEN
    RAISE EXCEPTION
      'Estorno liquido da OP % permaneceu incompleto', v_order.id
      USING ERRCODE = 'PZ212';
  END IF;

  UPDATE public.orders
     SET status = 'Cancelada',
         updated_at = pg_catalog.now()
   WHERE id = v_order.id;

  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order.id,
    'status_before', v_status_before,
    'status', 'Cancelada',
    'already_cancelled', false,
    'restored_sole_grade', v_has_physical_sole,
    'restored_product_stock', v_has_positive_net_debit,
    'restore_basis', 'net_ledger'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_production_order_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7b) Comandos de cancelamento fiscal: epoch antes de NF/PV
-- ---------------------------------------------------------------------------

DO $patch_nfe_cancellation_epoch_115$
DECLARE
  v_signature text;
  v_definition text;
  v_begin_pos integer;
  v_marker text := E'\nBEGIN\n';
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.begin_nfe_cancellation_command(uuid,text)',
    'public.abort_nfe_cancellation_command(uuid,text)',
    'public.complete_nfe_cancellation_command(uuid,text,text)'
  ]
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_signature::regprocedure);
    IF pg_catalog.strpos(v_definition, 'lock_sale_order_purchase_allocation') > 0 THEN
      CONTINUE;
    END IF;
    v_begin_pos := pg_catalog.strpos(v_definition, v_marker);
    IF v_begin_pos = 0 THEN
      RAISE EXCEPTION 'BEGIN nao encontrado ao serializar %', v_signature;
    END IF;
    v_definition := pg_catalog.substr(
      v_definition, 1, v_begin_pos - 1
    ) || E'\nBEGIN\n  PERFORM public.lock_sale_order_purchase_allocation();\n'
      || pg_catalog.substr(
        v_definition, v_begin_pos + pg_catalog.length(v_marker)
      );
    EXECUTE v_definition;
  END LOOP;
END;
$patch_nfe_cancellation_epoch_115$;

-- ---------------------------------------------------------------------------
-- 8) Contrato executavel, somente introspeccao
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_command_boundary_compatibility_contract_tests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_guard text;
  v_order_guard text;
  v_stage_guard text;
  v_wave text;
  v_wave_trigger text;
  v_consume text;
  v_cancel text;
  v_create_po text;
  v_upsert_item text;
  v_create_op text;
  v_outsource_def text;
  v_failures text[] := '{}'::text[];
  v_signature text;
BEGIN
  v_sale_guard := pg_catalog.pg_get_functiondef(
    'public.tg_enforce_sale_order_command_boundary()'::regprocedure
  );
  v_order_guard := pg_catalog.pg_get_functiondef(
    'public.tg_enforce_production_order_command_boundary()'::regprocedure
  );
  v_stage_guard := pg_catalog.pg_get_functiondef(
    'public.tg_enforce_order_stage_command_boundary()'::regprocedure
  );
  v_wave := pg_catalog.pg_get_functiondef(
    'public.sync_wave_from_kanban(uuid)'::regprocedure
  );
  v_wave_trigger := pg_catalog.pg_get_functiondef(
    'public.fn_sync_wave_on_stage_complete()'::regprocedure
  );
  v_consume := pg_catalog.pg_get_functiondef(
    'public.consume_all_reservations_for_order(uuid,text)'::regprocedure
  );
  v_cancel := pg_catalog.pg_get_functiondef(
    'public.cancel_production_order_internal(uuid)'::regprocedure
  );
  v_create_po := pg_catalog.pg_get_functiondef(
    'public.create_purchase_order_normalized(text,uuid,text,text,jsonb)'::regprocedure
  );
  v_upsert_item := pg_catalog.pg_get_functiondef(
    'public.upsert_po_item_atomic(uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text)'::regprocedure
  );
  v_create_op := pg_catalog.pg_get_functiondef(
    'public.create_op_service_order(uuid,text,uuid,numeric,numeric,date)'::regprocedure
  );

  IF pg_catalog.strpos(v_sale_guard, 'pg_trigger_depth') > 0
     OR pg_catalog.strpos(v_order_guard, 'pg_trigger_depth') > 0
     OR pg_catalog.strpos(v_stage_guard, 'pg_trigger_depth') > 0 THEN
    v_failures := pg_catalog.array_append(v_failures, 'guard_aceita_trigger_depth');
  END IF;
  IF pg_catalog.strpos(v_sale_guard, 'sale_order_item_commercial_review_internal') = 0
     OR pg_catalog.strpos(v_sale_guard, 'sale_order_item_strap_context_reference_id') = 0
     OR pg_catalog.strpos(v_sale_guard, 'sale_order_item_strap_sourcing_item_id') = 0
     OR pg_catalog.strpos(v_sale_guard, 'sale_order_item_strap_reconcile_item_id') = 0
     OR pg_catalog.strpos(v_sale_guard, 'material_variant_commercial_snapshot') = 0
     OR pg_catalog.strpos(v_sale_guard, 'strap_migration_status') = 0 THEN
    v_failures := pg_catalog.array_append(v_failures, 'sale_item_marker_ou_delta_ausente');
  END IF;
  IF pg_catalog.strpos(v_order_guard, 'outsource_order_metadata_internal') = 0
     OR pg_catalog.strpos(v_order_guard, 'material_gate_sale_orders_internal') = 0
     OR pg_catalog.strpos(v_order_guard, 'outsourced_to_contractor_id') = 0
     OR pg_catalog.strpos(v_order_guard, 'material_ready_date') = 0 THEN
    v_failures := pg_catalog.array_append(v_failures, 'orders_marker_ou_delta_ausente');
  END IF;
  IF pg_catalog.strpos(v_stage_guard, 'outsource_stage_block_internal') = 0
     OR pg_catalog.strpos(v_stage_guard, 'blocked_until') = 0
     OR pg_catalog.strpos(v_stage_guard, 'blocked_reason') = 0 THEN
    v_failures := pg_catalog.array_append(v_failures, 'stage_outsource_delta_ausente');
  END IF;

  IF pg_catalog.strpos(v_wave, 'can_execute_production_pointing') = 0
     OR pg_catalog.strpos(v_wave, 'wave_sync_internal') = 0
     OR pg_catalog.strpos(v_wave_trigger, 'sync_wave_from_kanban_locked_internal_115') = 0
     OR has_function_privilege(
          'authenticated',
          'public.sync_wave_from_kanban_impl_115(uuid)',
          'EXECUTE'
        ) THEN
    v_failures := pg_catalog.array_append(v_failures, 'wave_sync_boundary_incompleto');
  END IF;

  IF pg_catalog.strpos(v_consume, 'production-order:') = 0
     OR pg_catalog.strpos(v_consume, 'FOR UPDATE') = 0
     OR pg_catalog.strpos(v_consume, 'esta terminal') = 0 THEN
    v_failures := pg_catalog.array_append(v_failures, 'consume_all_sem_lock_terminal');
  END IF;

  IF pg_catalog.strpos(v_cancel, 'net_debit') = 0
     OR pg_catalog.strpos(v_cancel, 'restore_basis') = 0
     OR pg_catalog.strpos(v_cancel, 'v_has_prior_inbound') > 0
     OR pg_catalog.strpos(v_cancel, 'estorno parcial anterior') > 0 THEN
    v_failures := pg_catalog.array_append(v_failures, 'cancelamento_nao_liquido');
  END IF;

  IF pg_catalog.strpos(v_create_po, 'ARRAY[''admin'', ''gerente'']') = 0
     OR pg_catalog.strpos(v_create_po, 'is_approved_user') = 0
     OR pg_catalog.strpos(v_upsert_item, 'ARRAY[''admin'', ''gerente'']') = 0
     OR pg_catalog.strpos(v_upsert_item, 'is_approved_user') = 0
     OR pg_catalog.strpos(v_create_po, 'lock_sale_order_purchase_products') = 0
     OR pg_catalog.strpos(v_create_po, 'lock_sale_order_purchase_products')
          > pg_catalog.strpos(v_create_po, 'create_purchase_order_normalized_impl_115')
     OR pg_catalog.strpos(v_upsert_item, 'lock_sale_order_purchase_products') = 0
     OR pg_catalog.strpos(v_upsert_item, 'lock_sale_order_purchase_products')
          > pg_catalog.strpos(v_upsert_item, 'FOR UPDATE')
     OR pg_catalog.strpos(v_upsert_item, 'FOR UPDATE')
          > pg_catalog.strpos(v_upsert_item, 'upsert_po_item_atomic_impl_115') THEN
    v_failures := pg_catalog.array_append(v_failures, 'purchase_writer_sem_rbac');
  END IF;

  IF pg_catalog.strpos(v_create_op, 'sale-order-command:') = 0
     OR pg_catalog.strpos(v_create_op, 'outsource_service_order_generation') = 0
     OR pg_catalog.strpos(v_create_op, 'production-order:') = 0
     OR pg_catalog.strpos(v_create_op, 'sale-order-command:')
          > pg_catalog.strpos(v_create_op, 'outsource_service_order_generation')
     OR pg_catalog.strpos(v_create_op, 'outsource_service_order_generation')
          > pg_catalog.strpos(v_create_op, 'production-order:') THEN
    v_failures := pg_catalog.array_append(v_failures, 'create_op_lock_order');
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.commit_capacity_overflow_outsourcing(jsonb)',
    'public.send_item_sector_os(uuid,text,uuid)',
    'public.generate_configured_outsource_orders_for_order(uuid)',
    'public.generate_op_service_orders(uuid,jsonb)'
  ]
  LOOP
    v_outsource_def := pg_catalog.pg_get_functiondef(v_signature::regprocedure);
    IF pg_catalog.strpos(
         v_outsource_def, 'lock_outsource_sale_orders_before_global_115'
       ) = 0
       OR pg_catalog.strpos(
         v_outsource_def, 'lock_outsource_sale_orders_before_global_115'
       ) > pg_catalog.strpos(v_outsource_def, '_impl_115') THEN
      v_failures := pg_catalog.array_append(
        v_failures,
        'outsource_caller_lock_order:' || v_signature
      );
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.initialize_order_material_reservations(uuid,boolean)',
    'public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)',
    'public.debit_strap_stock(jsonb,integer,uuid,jsonb,boolean)',
    'public.debit_packaging_for_order(uuid,uuid,uuid,integer,text,boolean)',
    'public.release_order_reservations(uuid)',
    'public.convert_reservation_to_out(uuid,uuid)',
    'public.try_reserve_materials(uuid,uuid,numeric,text,date,boolean,boolean,text,boolean,boolean)',
    'public.process_order_stock_out(uuid,uuid,integer)',
    'public.restore_sole_grade_for_order(uuid)',
    'public.restore_product_stocks_for_order(uuid)',
    'public.reserve_missing_materials_for_order(uuid,boolean)',
    'public.resync_reservations_for_sheet(uuid)',
    'public.refresh_order_reservations(uuid)',
    'public.increment_qty_devolvida(uuid,numeric)',
    'public.compact_sale_order(uuid)',
    'public.upsert_open_purchase_order(uuid,text,uuid,text,jsonb)'
  ]
  LOOP
    IF has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      v_failures := pg_catalog.array_append(
        v_failures,
        'acl_externo:' || v_signature
      );
    END IF;
  END LOOP;

  IF has_function_privilege(
       'authenticated',
       'public.recalc_supplier_lead_from_history()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.recalc_supplier_lead_from_history()',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.recalc_supplier_lead_from_history()',
       'EXECUTE'
     ) THEN
    v_failures := pg_catalog.array_append(
      v_failures,
      'acl_recalc_supplier_lead'
    );
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.consume_from_lot(uuid,uuid,numeric,text)'
     ) IS NOT NULL THEN
    v_failures := pg_catalog.array_append(v_failures, 'consume_from_lot_sobreviveu');
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.consume_all_reservations_for_order(uuid,text)',
       'EXECUTE'
     )
     OR NOT (
       -- Estado no ponto da 115: wrappers humanos ainda são os boundaries.
       (
         has_function_privilege(
           'authenticated',
           'public.create_purchase_order_normalized(text,uuid,text,text,jsonb)',
           'EXECUTE'
         )
         AND has_function_privilege(
           'authenticated',
           'public.upsert_po_item_atomic(uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text)',
           'EXECUTE'
         )
       )
       OR
       -- Estado final após a 121: a command única substitui os dois wrappers
       -- legados, que precisam ficar owner-only para não haver bypass.
       (
         NOT has_function_privilege(
           'authenticated',
           'public.create_purchase_order_normalized(text,uuid,text,text,jsonb)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'authenticated',
           'public.upsert_po_item_atomic(uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text)',
           'EXECUTE'
         )
         AND pg_catalog.to_regprocedure(
           'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'
         ) IS NOT NULL
         AND COALESCE(has_function_privilege(
           'authenticated',
           pg_catalog.to_regprocedure(
             'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'
           ),
           'EXECUTE'
         ), false)
         AND COALESCE(has_function_privilege(
           'service_role',
           pg_catalog.to_regprocedure(
             'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'
           ),
           'EXECUTE'
         ), false)
         AND NOT COALESCE(has_function_privilege(
           'anon',
           pg_catalog.to_regprocedure(
             'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'
           ),
           'EXECUTE'
         ), false)
       )
     ) THEN
    v_failures := pg_catalog.array_append(v_failures, 'entrypoint_humano_revogado');
  END IF;

  IF pg_catalog.cardinality(v_failures) > 0 THEN
    RAISE EXCEPTION 'Contrato 115 falhou: %',
      pg_catalog.array_to_string(v_failures, ', ');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'checks', 8,
    'writes_business_data', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_command_boundary_compatibility_contract_tests()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_command_boundary_compatibility_contract_tests()
  TO service_role;

SELECT public.run_command_boundary_compatibility_contract_tests();

COMMIT;
