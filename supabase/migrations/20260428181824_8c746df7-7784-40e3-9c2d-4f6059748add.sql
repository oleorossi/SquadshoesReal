-- Embalagem por solado (trimodal + fitilho)

-- 1) Coluna fitilho que faltava em product_groups
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS box_type_fitilho_id uuid REFERENCES public.box_types(id) ON DELETE SET NULL;

-- 2) Coluna pairs_per_box por modo (override do default da box_type)
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS pairs_per_box_individual integer,
  ADD COLUMN IF NOT EXISTS pairs_per_box_master     integer,
  ADD COLUMN IF NOT EXISTS pairs_per_box_colmeia    integer,
  ADD COLUMN IF NOT EXISTS pairs_per_box_fitilho    integer;

-- 3) Migrar packaging_configs existentes (ligados a sheet) → grupo do solado da ficha
DO $$
DECLARE
  cfg RECORD;
  v_sole_group uuid;
BEGIN
  FOR cfg IN
    SELECT pc.id, pc.sheet_id, pc.packaging_type, pc.box_type_id, pc.pairs_per_box,
           ts.sole_group_id
    FROM public.packaging_configs pc
    JOIN public.technical_sheets ts ON ts.id = pc.sheet_id
    WHERE pc.sheet_id IS NOT NULL
      AND pc.box_type_id IS NOT NULL
      AND pc.active IS NOT FALSE
      AND ts.sole_group_id IS NOT NULL
  LOOP
    v_sole_group := cfg.sole_group_id;
    IF cfg.packaging_type = 'individual' THEN
      UPDATE public.product_groups
        SET box_type_id = COALESCE(box_type_id, cfg.box_type_id),
            pairs_per_box_individual = COALESCE(pairs_per_box_individual, cfg.pairs_per_box)
        WHERE id = v_sole_group;
    ELSIF cfg.packaging_type = 'master' THEN
      UPDATE public.product_groups
        SET box_type_master_id = COALESCE(box_type_master_id, cfg.box_type_id),
            pairs_per_box_master = COALESCE(pairs_per_box_master, cfg.pairs_per_box)
        WHERE id = v_sole_group;
    ELSIF cfg.packaging_type = 'colmeia' THEN
      UPDATE public.product_groups
        SET box_type_colmeia_id = COALESCE(box_type_colmeia_id, cfg.box_type_id),
            pairs_per_box_colmeia = COALESCE(pairs_per_box_colmeia, cfg.pairs_per_box)
        WHERE id = v_sole_group;
    ELSIF cfg.packaging_type = 'fitilho' THEN
      UPDATE public.product_groups
        SET box_type_fitilho_id = COALESCE(box_type_fitilho_id, cfg.box_type_id),
            pairs_per_box_fitilho = COALESCE(pairs_per_box_fitilho, cfg.pairs_per_box)
        WHERE id = v_sole_group;
    END IF;
  END LOOP;
END $$;

-- 4) RPC debit_packaging_for_order: passa a ler do solado da ficha
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid,
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sole_group_id uuid;
  v_types_to_debit text[];
  v_result jsonb := '[]'::jsonb;
  t text;
  v_box_type_id uuid;
  v_pairs integer;
  v_box_stock numeric;
  v_box_name text;
  v_boxes_needed integer;
BEGIN
  -- Resolve grupo do solado da ficha técnica
  SELECT sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets WHERE id = p_reference_id;

  IF v_sole_group_id IS NULL THEN
    RETURN jsonb_build_object('status','skipped','reason','sole_group_not_set');
  END IF;

  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual','master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual','fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  FOREACH t IN ARRAY v_types_to_debit
  LOOP
    SELECT
      CASE t
        WHEN 'individual' THEN pg.box_type_id
        WHEN 'master'     THEN pg.box_type_master_id
        WHEN 'colmeia'    THEN pg.box_type_colmeia_id
        WHEN 'fitilho'    THEN pg.box_type_fitilho_id
      END,
      CASE t
        WHEN 'individual' THEN pg.pairs_per_box_individual
        WHEN 'master'     THEN pg.pairs_per_box_master
        WHEN 'colmeia'    THEN pg.pairs_per_box_colmeia
        WHEN 'fitilho'    THEN pg.pairs_per_box_fitilho
      END
      INTO v_box_type_id, v_pairs
    FROM public.product_groups pg
    WHERE pg.id = v_sole_group_id;

    IF v_box_type_id IS NULL THEN
      v_result := v_result || jsonb_build_object(
        'packaging_type', t, 'status','skipped','reason','no_box_for_sole'
      );
      CONTINUE;
    END IF;

    SELECT quantity, nome INTO v_box_stock, v_box_name
      FROM public.box_types WHERE id = v_box_type_id AND active = true;

    v_pairs := COALESCE(NULLIF(v_pairs,0), 1);
    v_boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(v_pairs,1));

    IF v_box_stock IS NULL OR v_box_stock < v_boxes_needed THEN
      RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
        COALESCE(v_box_name,'?'), COALESCE(v_box_stock,0), v_boxes_needed;
    END IF;

    UPDATE public.box_types
      SET quantity = quantity - v_boxes_needed, updated_at = now()
      WHERE id = v_box_type_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock, description, order_id
    ) VALUES (
      v_box_type_id, 'out', v_boxes_needed,
      v_box_stock, v_box_stock - v_boxes_needed,
      'Débito embalagem ' || COALESCE(v_box_name,'?') || ' (' || t || ') — solado',
      p_order_id
    );

    v_result := v_result || jsonb_build_object(
      'box_type_id', v_box_type_id,
      'box_name', v_box_name,
      'packaging_type', t,
      'boxes_needed', v_boxes_needed,
      'status', 'debited_box_types'
    );
  END LOOP;

  RETURN v_result;
END;
$function$;