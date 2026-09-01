-- Evita a reentrada sale_orders -> sale_order_items -> sale_orders durante a
-- captura do snapshot comercial de variante na confirmação/promoção do PV.
--
-- Incidente PV-00168 (01/09/2026): o BEFORE UPDATE OF status do cabeçalho
-- atualiza exclusivamente material_variant_commercial_snapshot nos itens com
-- variante. O AFTER trigger de versionamento do item, criado depois da guarda
-- dos demais triggers genéricos, tentava tocar o mesmo cabeçalho ainda aberto
-- pelo comando externo. PostgreSQL abortava a mudança com SQLSTATE 27000:
-- "tuple to be updated was already modified by an operation triggered by the
-- current command".
--
-- A exceção abaixo é deliberadamente estreita: exige UPDATE aninhado, marcador
-- transacional do próprio PV e igualdade de todas as colunas exceto o snapshot.
-- INSERT/DELETE, edição real do item e revisão comercial explícita continuam
-- avançando order_version normalmente.

BEGIN;

DO $preflight$
DECLARE
  v_capture_def text;
BEGIN
  IF to_regprocedure(
       'public.tg_touch_sale_order_version_from_item()'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Pré-condição ausente: tg_touch_sale_order_version_from_item() não existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger trigger_catalog
     WHERE trigger_catalog.tgrelid = 'public.sale_order_items'::regclass
       AND trigger_catalog.tgname = 'trg_touch_sale_order_version_from_item'
       AND NOT trigger_catalog.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'Pré-condição ausente: trigger de versionamento do item do PV não existe';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
           'public.capture_material_variant_snapshots_on_sale_order_confirmation()'
             ::regprocedure
         )
    INTO v_capture_def;

  IF pg_catalog.strpos(
       v_capture_def,
       'app.material_variant_snapshot_confirmation_order_id'
     ) = 0
     OR pg_catalog.strpos(
       v_capture_def,
       'UPDATE public.sale_order_items'
     ) = 0 THEN
    RAISE EXCEPTION
      'Pré-condição divergente: captura de snapshot da confirmação mudou';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.tg_touch_sale_order_version_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_order_id uuid;
  v_old_sale_order_id uuid;
  v_new_sale_order_id uuid;
  v_previous text;
BEGIN
  -- O cabeçalho já avança a versão pela mudança de status. Tocar novamente o
  -- mesmo sale_orders a partir do snapshot interno produz reentrada na tupla e
  -- SQLSTATE 27000. A combinação marcador + profundidade + diff de uma única
  -- coluna prova que esta é exatamente a escrita técnica da confirmação.
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND COALESCE(
       current_setting(
         'app.material_variant_snapshot_confirmation_order_id',
         true
       ) = NEW.sale_order_id::text,
       false
     )
     AND (
       to_jsonb(OLD) - 'material_variant_commercial_snapshot'
     ) IS NOT DISTINCT FROM (
       to_jsonb(NEW) - 'material_variant_commercial_snapshot'
     ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_sale_order_id := OLD.sale_order_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_sale_order_id := NEW.sale_order_id;
  END IF;

  v_previous := current_setting('app.sale_order_version_touch', true);
  PERFORM set_config('app.sale_order_version_touch', '1', true);

  FOR v_sale_order_id IN
    SELECT DISTINCT candidate
      FROM unnest(ARRAY[v_old_sale_order_id, v_new_sale_order_id]) AS candidate
     WHERE candidate IS NOT NULL
     ORDER BY candidate
  LOOP
    UPDATE public.sale_orders
       SET updated_at = GREATEST(updated_at, now())
     WHERE id = v_sale_order_id;
  END LOOP;

  PERFORM set_config(
    'app.sale_order_version_touch',
    COALESCE(v_previous, ''),
    true
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_touch_sale_order_version_from_item()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_touch_sale_order_version_from_item() IS
  'Avança order_version quando o agregado-filho muda; ignora somente o refresh '
  'aninhado e snapshot-only executado pelo BEFORE de confirmação do próprio PV.';

DO $postconditions$
DECLARE
  v_touch_def text;
  v_guard_position integer;
  v_parent_update_position integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
           'public.tg_touch_sale_order_version_from_item()'::regprocedure
         )
    INTO v_touch_def;

  v_guard_position := pg_catalog.strpos(
    v_touch_def,
    'app.material_variant_snapshot_confirmation_order_id'
  );
  v_parent_update_position := pg_catalog.strpos(
    v_touch_def,
    'UPDATE public.sale_orders'
  );

  IF v_guard_position = 0
     OR pg_catalog.strpos(v_touch_def, 'pg_trigger_depth() > 1') = 0
     OR pg_catalog.strpos(
       v_touch_def,
       'material_variant_commercial_snapshot'
     ) = 0
     OR v_parent_update_position = 0
     OR v_guard_position > v_parent_update_position THEN
    RAISE EXCEPTION
      'Pós-condição falhou: a guarda de reentrada não precede o touch do PV';
  END IF;

  IF pg_catalog.strpos(
       v_touch_def,
       'unnest(ARRAY[v_old_sale_order_id, v_new_sale_order_id])'
     ) = 0
     OR pg_catalog.strpos(
       v_touch_def,
       'app.sale_order_version_touch'
     ) = 0 THEN
    RAISE EXCEPTION
      'Pós-condição falhou: semântica normal de versionamento foi perdida';
  END IF;
END;
$postconditions$;

COMMIT;
