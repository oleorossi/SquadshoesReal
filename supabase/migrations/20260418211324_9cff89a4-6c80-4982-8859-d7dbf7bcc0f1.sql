-- ============ 1) TABELA DE SNAPSHOTS ===================================
CREATE TABLE IF NOT EXISTS public.technical_sheet_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE RESTRICT,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  sale_order_item_id uuid,
  sheet_name text NOT NULL,
  sheet_version integer NOT NULL DEFAULT 1,
  primary_sole_id uuid,
  sole_drives_consumption boolean NOT NULL DEFAULT false,
  reference_size integer,
  bom_snapshot jsonb NOT NULL,
  consumption_snapshot jsonb NOT NULL,
  color text DEFAULT '',
  quantity numeric NOT NULL,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  frozen_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(sale_order_id, sale_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_ts_snapshots_sheet ON public.technical_sheet_snapshots(sheet_id);
CREATE INDEX IF NOT EXISTS idx_ts_snapshots_order ON public.technical_sheet_snapshots(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_ts_snapshots_frozen ON public.technical_sheet_snapshots(frozen_at DESC);

ALTER TABLE public.technical_sheet_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ts_snap_select ON public.technical_sheet_snapshots;
DROP POLICY IF EXISTS ts_snap_insert ON public.technical_sheet_snapshots;
DROP POLICY IF EXISTS ts_snap_update ON public.technical_sheet_snapshots;
DROP POLICY IF EXISTS ts_snap_delete ON public.technical_sheet_snapshots;

CREATE POLICY ts_snap_select ON public.technical_sheet_snapshots
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ts_snap_insert ON public.technical_sheet_snapshots
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY ts_snap_update ON public.technical_sheet_snapshots
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ts_snap_delete ON public.technical_sheet_snapshots
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- ============ 2) VERSIONAMENTO DE FICHA TÉCNICA =========================
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.fn_bump_sheet_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sheet uuid;
BEGIN
  v_sheet := COALESCE(NEW.sheet_id, OLD.sheet_id);
  IF v_sheet IS NOT NULL THEN
    UPDATE public.technical_sheets
       SET version = version + 1, updated_at = now()
     WHERE id = v_sheet;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_sheet_version ON public.sheet_materials;
CREATE TRIGGER trg_bump_sheet_version
AFTER INSERT OR UPDATE OR DELETE ON public.sheet_materials
FOR EACH ROW EXECUTE FUNCTION public.fn_bump_sheet_version();

-- ============ 3) FUNÇÃO DE SNAPSHOT =====================================
CREATE OR REPLACE FUNCTION public.freeze_technical_sheet(
  p_reference_id uuid,
  p_sale_order_id uuid,
  p_sale_order_item_id uuid,
  p_color text,
  p_quantity numeric,
  p_size integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_snap_id uuid;
  v_sheet record;
  v_bom jsonb;
  v_consumption jsonb;
BEGIN
  SELECT id, name, version, primary_sole_id, sole_drives_consumption, reference_size
    INTO v_sheet
    FROM public.technical_sheets
   WHERE id = p_reference_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(sm)), '[]'::jsonb)
    INTO v_bom
    FROM public.sheet_materials sm
   WHERE sm.sheet_id = p_reference_id;

  SELECT to_jsonb(c) INTO v_consumption
    FROM (
      SELECT * FROM public.calculate_order_consumption(p_reference_id, p_quantity, p_color, p_size)
    ) c;

  -- If RPC returns table, aggregate
  IF v_consumption IS NULL OR jsonb_typeof(v_consumption) <> 'array' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      INTO v_consumption
      FROM public.calculate_order_consumption(p_reference_id, p_quantity, p_color, p_size) c;
  END IF;

  INSERT INTO public.technical_sheet_snapshots (
    sheet_id, sale_order_id, sale_order_item_id,
    sheet_name, sheet_version, primary_sole_id, sole_drives_consumption,
    reference_size, bom_snapshot, consumption_snapshot,
    color, quantity, frozen_by
  ) VALUES (
    v_sheet.id, p_sale_order_id, p_sale_order_item_id,
    v_sheet.name, v_sheet.version, v_sheet.primary_sole_id, v_sheet.sole_drives_consumption,
    COALESCE(p_size, v_sheet.reference_size), v_bom, v_consumption,
    COALESCE(p_color, ''), p_quantity, auth.uid()
  )
  ON CONFLICT (sale_order_id, sale_order_item_id)
  DO UPDATE SET
    bom_snapshot = EXCLUDED.bom_snapshot,
    consumption_snapshot = EXCLUDED.consumption_snapshot,
    sheet_version = EXCLUDED.sheet_version,
    frozen_at = now(),
    frozen_by = auth.uid()
  RETURNING id INTO v_snap_id;

  RETURN v_snap_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.freeze_technical_sheet(uuid, uuid, uuid, text, numeric, integer) TO authenticated;

-- ============ 4) hybrid_debit_stock_for_order COM LOCK ==================
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_order_id uuid,
  p_order_grade jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_required numeric;
  v_available numeric;
  v_mode text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
BEGIN
  v_size := NULL;
  IF p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
    SELECT key::integer INTO v_size
      FROM jsonb_each_text(p_order_grade)
     WHERE key ~ '^[0-9]+$'
     ORDER BY value::numeric DESC
     LIMIT 1;
  END IF;

  -- Resolve sale_order_id from orders
  SELECT sale_order_id INTO v_sale_order_id
    FROM public.orders
   WHERE id = p_order_id;

  -- Try to find a matching sale_order_item
  IF v_sale_order_id IS NOT NULL THEN
    SELECT id INTO v_soi_id
      FROM public.sale_order_items
     WHERE sale_order_id = v_sale_order_id
       AND reference_id = p_reference_id
       AND COALESCE(color,'') = COALESCE(p_color,'')
     LIMIT 1;
  END IF;

  -- Reuse snapshot if exists, else freeze now
  IF v_sale_order_id IS NOT NULL THEN
    SELECT consumption_snapshot, id
      INTO v_items, v_snap_id
      FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_sale_order_id
       AND (sale_order_item_id IS NOT DISTINCT FROM v_soi_id)
     LIMIT 1;
  END IF;

  IF v_items IS NULL THEN
    IF v_sale_order_id IS NOT NULL THEN
      v_snap_id := public.freeze_technical_sheet(
        p_reference_id, v_sale_order_id, v_soi_id, p_color, p_order_quantity, v_size
      );
      SELECT consumption_snapshot INTO v_items
        FROM public.technical_sheet_snapshots
       WHERE id = v_snap_id;
    ELSE
      -- No sale order link — compute on the fly without persisting snapshot
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        INTO v_items
        FROM public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size) c;
    END IF;
  END IF;

  -- Phase 1: lock + fail-fast
  FOR v_item IN
    SELECT value
      FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid := (v_item ->> 'product_id')::uuid;

    SELECT id, quantity, name INTO v_product
      FROM public.products
     WHERE id = v_pid
     FOR UPDATE;

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

  -- Phase 2: actual debit
  FOR v_item IN
    SELECT value
      FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid := (v_item ->> 'product_id')::uuid;
    v_name := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode := v_item ->> 'debit_mode';

    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;

    IF v_mode = 'hard' THEN
      UPDATE public.products
         SET quantity = quantity - v_required, updated_at = now()
       WHERE id = v_pid;

      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP ' || COALESCE(v_name,'') ||
         CASE WHEN COALESCE(p_color,'') <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, v_required, 'consumed', 'hard');

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited'
      );
    ELSE
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft');

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'reserved'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'snapshot_id', v_snap_id,
    'items', v_result
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb) TO authenticated;