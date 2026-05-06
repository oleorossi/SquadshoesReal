-- ============================================================
-- Move packaging_configs linkage from technical_sheets to
-- product_groups (sole group), so packaging is configured once
-- per sole model rather than duplicated per technical sheet.
--
-- Strategy:
--   1. Add sole_group_id column (nullable FK → product_groups)
--   2. Backfill from existing sheet → sole_group_id relationship
--   3. Make sheet_id nullable (no longer mandatory)
--   4. Add CHECK: at least one of sheet_id / sole_group_id must be set
--   5. Update debit_packaging_for_order to prefer sole_group_id
-- ============================================================

-- 1. Add sole_group_id
ALTER TABLE public.packaging_configs
  ADD COLUMN IF NOT EXISTS sole_group_id UUID
    REFERENCES public.product_groups(id) ON DELETE SET NULL;

-- 2. Backfill: copy sole_group_id from the referenced technical sheet
UPDATE public.packaging_configs pc
SET    sole_group_id = ts.sole_group_id
FROM   public.technical_sheets ts
WHERE  ts.id = pc.sheet_id
  AND  ts.sole_group_id IS NOT NULL
  AND  pc.sole_group_id IS NULL;

-- 3. Make sheet_id nullable (was NOT NULL before)
ALTER TABLE public.packaging_configs
  ALTER COLUMN sheet_id DROP NOT NULL;

-- 4. Ensure at least one anchor is always set
ALTER TABLE public.packaging_configs
  DROP CONSTRAINT IF EXISTS packaging_configs_anchor_check;
ALTER TABLE public.packaging_configs
  ADD CONSTRAINT packaging_configs_anchor_check
    CHECK (sheet_id IS NOT NULL OR sole_group_id IS NOT NULL);

-- 5. Update debit function to prefer sole-level packaging
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid,
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg              RECORD;
  boxes_needed     integer;
  v_result         jsonb := '[]'::jsonb;
  v_types_to_debit text[];
  v_sole_group_id  uuid;
BEGIN
  -- Determine which packaging types to debit based on mode
  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  -- Look up the sole_group_id for this technical sheet
  SELECT sole_group_id INTO v_sole_group_id
  FROM   technical_sheets
  WHERE  id = p_reference_id;

  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box, pc.product_id, pc.box_type_id,
           p.name    AS product_name, p.quantity AS current_stock,
           bt.quantity AS box_stock,  bt.nome   AS box_name
    FROM packaging_configs pc
    LEFT JOIN products  p  ON p.id  = pc.product_id  AND p.active  = true
    LEFT JOIN box_types bt ON bt.id = pc.box_type_id AND bt.active = true
    WHERE (
      -- Prefer sole-level packaging when available
      (v_sole_group_id IS NOT NULL AND pc.sole_group_id = v_sole_group_id)
      -- Fallback: sheet-level packaging for sheets with no sole group
      OR (v_sole_group_id IS NULL AND pc.sheet_id = p_reference_id)
    )
      AND pc.active        = true
      AND pc.packaging_type = ANY(v_types_to_debit)
  LOOP
    boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    -- Primary path: debit box_types (centralised packaging stock)
    IF cfg.box_type_id IS NOT NULL THEN
      IF cfg.box_stock IS NULL OR cfg.box_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.box_name, cfg.nome), COALESCE(cfg.box_stock, 0), boxes_needed;
      END IF;

      UPDATE box_types
      SET quantity = quantity - boxes_needed, updated_at = now()
      WHERE id = cfg.box_type_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.box_type_id, 'out', boxes_needed,
        cfg.box_stock, cfg.box_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.box_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'box_type_id',    cfg.box_type_id,
        'box_name',       COALESCE(cfg.box_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_box_types'
      );

    -- Legacy path: debit from products table (direct product link)
    ELSIF cfg.product_id IS NOT NULL THEN
      IF cfg.current_stock IS NULL OR cfg.current_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.product_name, cfg.nome), COALESCE(cfg.current_stock, 0), boxes_needed;
      END IF;

      UPDATE products
      SET quantity = quantity - boxes_needed, updated_at = now()
      WHERE id = cfg.product_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.product_id, 'out', boxes_needed,
        cfg.current_stock, cfg.current_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'product_id',     cfg.product_id,
        'product_name',   COALESCE(cfg.product_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_products'
      );

    ELSE
      v_result := v_result || jsonb_build_object(
        'packaging_type', cfg.packaging_type,
        'nome',           cfg.nome,
        'status',         'skipped',
        'reason',         'no_stock_linked'
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) TO authenticated;
