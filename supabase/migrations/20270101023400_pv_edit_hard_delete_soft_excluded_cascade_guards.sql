-- =============================================================================
-- Hard-delete de item soft-excluded: guards de cascata (SET NULL + enqueue)
-- =============================================================================
-- Descoberto ao apagar I702 do PV-00169 no SQL Editor:
--   1) ON DELETE SET NULL em sale_order_strap_demands.sale_order_item_id dispara
--      tg_guard_excluded_sale_order_strap_demand, que fazia SELECT no item e
--      RAISEava "Item do PV da demanda de tira nao encontrado" quando o id
--      já era NULL.
--   2) trg_enqueue_strap_demands_on_item_change (DEFERRED) reenfileirava
--      demanda no DELETE e falhava com Permission denied fora do writer atomico.
--   3) finalize/SQL Editor precisa ligar app.sale_order_command_internal=1
--      (boundary de comando) alem do GUC de production_exclusion.
--
-- Marcador: pv_edit_hard_delete_soft_excluded_cascade_20270101023400
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_guard_excluded_sale_order_strap_demand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_excluded_at timestamptz;
BEGIN
  -- Hard-delete do item faz ON DELETE SET NULL em sale_order_item_id.
  -- Demanda historica permanece amarrada em sale_order_id; NULL no item e valido.
  -- pv_edit_hard_delete_soft_excluded_cascade_20270101023400
  IF NEW.sale_order_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT soi.production_excluded_at
    INTO v_excluded_at
    FROM public.sale_order_items soi
   WHERE soi.id = NEW.sale_order_item_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item do PV da demanda de tira nao encontrado'
      USING ERRCODE = '23503';
  END IF;

  IF v_excluded_at IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR (
         NEW.is_current
         AND NEW.status NOT IN ('cancelled', 'superseded', 'fulfilled')
       )
     ) THEN
    RAISE EXCEPTION 'Item do PV foi retirado da producao e nao pode gerar/reativar demanda de tira'
      USING ERRCODE = 'PZ238';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_sale_order_id uuid;
BEGIN
  -- pv_edit_hard_delete_soft_excluded_cascade_20270101023400:
  -- item ja soft-excluded nao reabre demanda ao ser hard-deleted.
  IF TG_OP = 'DELETE' AND OLD.production_excluded_at IS NOT NULL THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.sale_order_id IS NOT DISTINCT FROM OLD.sale_order_id
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.material_variant_id IS NOT DISTINCT FROM OLD.material_variant_id
     AND NEW.color IS NOT DISTINCT FROM OLD.color
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
     AND NEW.grade IS NOT DISTINCT FROM OLD.grade
     AND NEW.strap_colors IS NOT DISTINCT FROM OLD.strap_colors
     AND NEW.strap_sourcing IS NOT DISTINCT FROM OLD.strap_sourcing
     AND NEW.strap_sourcing_revision IS NOT DISTINCT FROM
         OLD.strap_sourcing_revision THEN
    RETURN NEW;
  END IF;

  v_sale_order_id := CASE WHEN TG_OP = 'DELETE'
    THEN OLD.sale_order_id ELSE NEW.sale_order_id END;

  IF EXISTS (
    SELECT 1
      FROM public.sale_order_atomic_writer_contexts context
     WHERE context.backend_pid = pg_backend_pid()
       AND context.transaction_id = txid_current()
       AND context.sale_order_id = v_sale_order_id
       AND context.operation IN ('create', 'update', 'override')
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT status INTO v_status
    FROM public.sale_orders
   WHERE id = v_sale_order_id;

  IF v_status IN ('Aprovado', 'Em Produção') THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      v_sale_order_id,
      CASE WHEN TG_OP = 'INSERT' THEN 'approved' ELSE 'item_updated' END,
      gen_random_uuid()
    );
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DO $$
DECLARE
  v_guard text;
  v_enqueue text;
BEGIN
  v_guard := pg_get_functiondef(
    'public.tg_guard_excluded_sale_order_strap_demand()'::regprocedure
  );
  IF position('NEW.sale_order_item_id IS NULL' IN v_guard) = 0 THEN
    RAISE EXCEPTION 'Guard: tg_guard_excluded nao aceita sale_order_item_id NULL';
  END IF;

  v_enqueue := pg_get_functiondef(
    'public.tg_enqueue_strap_demands_on_item_change()'::regprocedure
  );
  IF position('OLD.production_excluded_at IS NOT NULL' IN v_enqueue) = 0 THEN
    RAISE EXCEPTION 'Guard: enqueue nao pula DELETE de soft-excluded';
  END IF;
END;
$$;
