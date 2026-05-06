-- Lock debit_strap_stock against concurrent races.
--
-- Problem: the previous version (20260421090000_fix-strap-color-fallback.sql)
-- read products.quantity into v_current_qty WITHOUT a row lock, then later
-- ran UPDATE products SET quantity = quantity - v_required. Two concurrent
-- debits for the same strap color both passed the v_current_qty < v_required
-- guard and both ran the UPDATE, allowing quantity to drift negative
-- silently. The stock_movements rows also recorded new_stock = v_current_qty
-- - v_required for both calls, diverging from the real DB value.
--
-- This migration:
--   1. Adds FOR UPDATE to both SELECTs that fetch the strap product, so the
--      row is locked between the availability check and the debit.
--   2. Wraps the UPDATE in GREATEST(0, ...) as a defensive floor — the prior
--      check already raises if insufficient, but defending the invariant is
--      cheap and prevents future regressions if the check is ever loosened.

DROP FUNCTION IF EXISTS public.debit_strap_stock(p_strap_colors jsonb, p_order_quantity integer, p_order_id uuid, p_order_grade jsonb) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_strap_stock(
  p_strap_colors jsonb,
  p_order_quantity integer,
  p_order_id uuid DEFAULT NULL::uuid,
  p_order_grade jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_product_id uuid;
  v_product_name text;
  v_product_color text;
  v_current_qty numeric;
  v_required numeric;
  v_consumption numeric;
  v_per_size jsonb;
  v_size text;
  v_pairs numeric;
  v_cm_per_pair numeric;
  v_total_cm numeric;
  v_grade_total numeric;
  v_fichas numeric;
BEGIN
  -- Match the locking-aware approved-user guard used by the other debit RPCs.
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Unauthorized: user not approved';
  END IF;

  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) != 'array' OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';

    BEGIN
      v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_group_id := NULL;
    END;

    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN
      CONTINUE;
    END IF;

    -- Calculate consumption: prefer per-size with grade, fallback to flat
    v_per_size := v_strap -> 'consumption_per_size';
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 1);
    IF v_consumption <= 0 THEN v_consumption := 1; END IF;

    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0;
      v_grade_total := 0;

      FOR v_size, v_pairs IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;

      IF v_grade_total > 0 THEN
        v_fichas := GREATEST(1, round(p_order_quantity::numeric / v_grade_total));
      ELSE
        v_fichas := 1;
      END IF;

      v_required := (v_total_cm * v_fichas) / 100; -- cm → metros
    ELSE
      v_required := v_consumption * p_order_quantity;
    END IF;

    IF v_required <= 0 THEN CONTINUE; END IF;

    -- 1. Try exact color match — FOR UPDATE locks the row from competing debits
    --    until this transaction commits, so the v_current_qty check below
    --    cannot be invalidated by a concurrent debit.
    SELECT p.id, p.name, p.quantity, p.color
    INTO v_product_id, v_product_name, v_current_qty, v_product_color
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND lower(trim(p.color)) = lower(trim(v_color))
    LIMIT 1
    FOR UPDATE;

    -- 2. If not found, look for a generic (no-color) product in the same group
    IF v_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity, p.color
      INTO v_product_id, v_product_name, v_current_qty, v_product_color
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_group_id
        AND (p.color IS NULL OR trim(p.color) = '')
      LIMIT 1
      FOR UPDATE;
    END IF;

    -- 3. If still not found, check if only a wrong-color product exists — raise clear error
    IF v_product_id IS NULL THEN
      DECLARE v_wrong_name text; v_wrong_color text;
      BEGIN
        SELECT p.name, p.color INTO v_wrong_name, v_wrong_color
        FROM public.products p
        WHERE p.active = true AND p.group_id = v_group_id
        LIMIT 1;
        IF v_wrong_name IS NOT NULL THEN
          RAISE EXCEPTION
            'Tira "%" cor "%" não encontrada no estoque. Produto disponível no grupo: "%" (cor "%"). Cadastre o material na cor correta.',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_wrong_name, COALESCE(v_wrong_color, 'sem cor');
        ELSE
          RAISE EXCEPTION
            'Material da tira "%" (cor: %) não encontrado no estoque (grupo: %).',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_group_id;
        END IF;
      END;
    END IF;

    IF v_current_qty < v_required THEN
      RAISE EXCEPTION
        'Estoque insuficiente para tira "%" (cor: %): disponível %.4f, necessário %.4f metros.',
        v_product_name, v_color, v_current_qty, v_required;
    END IF;

    -- GREATEST(0, ...) defends the non-negative invariant even if the check
    -- above is ever loosened or bypassed.
    UPDATE public.products
    SET quantity = GREATEST(0, quantity - v_required), updated_at = now()
    WHERE id = v_product_id;

    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (
      v_product_id, 'out', v_required, v_current_qty, v_current_qty - v_required,
      'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color
        || ' - ' || round(v_required::numeric, 4) || 'm × ' || p_order_quantity || ' pares',
      p_order_id
    );
  END LOOP;
END;
$function$;
