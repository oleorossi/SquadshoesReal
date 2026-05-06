-- Packaging configured per sole PRODUCT (not per group).
-- Each sole product (e.g. "Solado 01 Preto 20-28") holds its own individual/
-- master/colmeia box links with pairs_per_box. debit_packaging_for_order prefers
-- a sole_product_id match, then falls back to sole_group_id, then sheet_id.

-- ─── 1. Add sole_product_id to packaging_configs ─────────────────────────────

ALTER TABLE public.packaging_configs
  ADD COLUMN IF NOT EXISTS sole_product_id UUID
    REFERENCES public.products(id) ON DELETE CASCADE;

-- Allow sole_product_id as a valid anchor (alongside sheet_id / sole_group_id)
ALTER TABLE public.packaging_configs
  DROP CONSTRAINT IF EXISTS packaging_configs_anchor_check;
ALTER TABLE public.packaging_configs
  ADD CONSTRAINT packaging_configs_anchor_check
    CHECK (
      sheet_id IS NOT NULL
      OR sole_group_id IS NOT NULL
      OR sole_product_id IS NOT NULL
    );

-- ─── 2. Update debit_packaging_for_order ─────────────────────────────────────
-- Priority (highest first):
--   1. packaging_configs with sole_product_id matching the exact sole for this order
--   2. packaging_configs with sole_product_id matching any sibling in the same group
--   3. packaging_configs with sole_group_id = sheet's sole_group_id (legacy)
--   4. packaging_configs with sheet_id = p_reference_id (oldest fallback)

DROP FUNCTION IF EXISTS public.debit_packaging_for_order(p_sale_order_id  uuid, p_order_id       uuid, p_reference_id   uuid, p_order_quantity integer, p_packaging_mode text) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id  uuid,
  p_order_id       uuid,
  p_reference_id   uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg                RECORD;
  boxes_needed       integer;
  v_result           jsonb := '[]'::jsonb;
  v_types_to_debit   text[];
  -- anchor resolution
  v_sole_group_id    uuid;
  v_order_color      text;
  v_sole_product_id  uuid;
  v_cfg_sole_id      uuid;   -- sole_product_id actually used for the query
BEGIN
  -- ── Packaging types from mode ─────────────────────────────────────────────
  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  -- ── Resolve sole product for this specific order ──────────────────────────
  SELECT sole_group_id INTO v_sole_group_id
    FROM technical_sheets WHERE id = p_reference_id;

  SELECT COALESCE(color, '') INTO v_order_color
    FROM sale_orders WHERE id = p_sale_order_id;

  SELECT sole_product_id INTO v_sole_product_id
    FROM resolve_sole_color(p_reference_id, v_order_color)
   LIMIT 1;

  -- ── Priority 1: exact sole_product_id ────────────────────────────────────
  IF v_sole_product_id IS NOT NULL THEN
    SELECT sole_product_id INTO v_cfg_sole_id
      FROM packaging_configs
     WHERE sole_product_id = v_sole_product_id
       AND active = true
     LIMIT 1;
  END IF;

  -- ── Priority 2: any sibling in the same group ─────────────────────────────
  IF v_cfg_sole_id IS NULL AND v_sole_product_id IS NOT NULL THEN
    SELECT pc.sole_product_id INTO v_cfg_sole_id
      FROM packaging_configs pc
      JOIN products sib ON sib.id = pc.sole_product_id
      JOIN products anchor ON anchor.id = v_sole_product_id
                           AND sib.group_id = anchor.group_id
     WHERE pc.active = true
     LIMIT 1;
  END IF;

  -- ── Debit loop: use product configs (priority 1/2), group, or sheet ───────
  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box,
           pc.product_id, pc.box_type_id,
           p.name    AS product_name, p.quantity AS current_stock,
           bt.quantity AS box_stock,  bt.nome    AS box_name
      FROM packaging_configs pc
      LEFT JOIN products  p  ON p.id  = pc.product_id  AND p.active  = true
      LEFT JOIN box_types bt ON bt.id = pc.box_type_id AND bt.active = true
     WHERE (
             -- Product-level (highest priority)
             (v_cfg_sole_id IS NOT NULL AND pc.sole_product_id = v_cfg_sole_id)
             -- Group-level fallback (only when no product configs found)
          OR (v_cfg_sole_id IS NULL AND v_sole_group_id IS NOT NULL
              AND pc.sole_group_id = v_sole_group_id)
             -- Sheet-level fallback (oldest, when no group either)
          OR (v_cfg_sole_id IS NULL AND v_sole_group_id IS NULL
              AND pc.sheet_id = p_reference_id)
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

    -- Legacy path: debit from products table
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
