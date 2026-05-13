-- =============================================================================
-- Fix crítico: debit_packaging_for_order alinhado ao modelo atual.
-- =============================================================================
--
-- A UI nova (PackagingTab) escreve embalagens em product_groups
-- (box_type_id, box_type_master_id, box_type_colmeia_id, box_type_fitilho_id,
-- pairs_per_box_*, metros_fitilho_per_amarrado).
--
-- A RPC de débito (debit_packaging_for_order) lia SOMENTE de
-- packaging_configs.sheet_id. Resultado: fichas configuradas só pela UI nova
-- não tinham débito de embalagem ao processar OPs (loop não achava registros).
--
-- Esta migration faz a RPC ler PRIMEIRO de product_groups (resolvido via
-- technical_sheets.sole_group_id). Fallback: lê packaging_configs quando
-- product_groups não tem nenhum slot do modo escolhido (compat com fichas
-- antigas que ainda usam packaging_configs).
-- =============================================================================

DROP FUNCTION IF EXISTS public.debit_packaging_for_order(p_sale_order_id uuid, p_order_id uuid, p_reference_id uuid, p_order_quantity integer, p_packaging_mode text) CASCADE;

CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id  uuid,
  p_order_id       uuid,
  p_reference_id   uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sole_group_id  uuid;
  v_metros_per_amarrado numeric;
  v_pg              RECORD;
  v_types_to_debit  text[];
  v_result          jsonb := '[]'::jsonb;
  v_box_stock       numeric;
  v_box_id          uuid;
  v_box_name        text;
  v_pairs_per_box   integer;
  v_amarrados_needed integer;
  v_debit_qty       numeric;
  v_unit_label      text;
  v_pkg_type        text;
  v_handled         boolean := false;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  SELECT sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets
   WHERE id = p_reference_id;

  -- Caminho primário: product_groups (UI nova)
  IF v_sole_group_id IS NOT NULL THEN
    SELECT * INTO v_pg
      FROM public.product_groups
     WHERE id = v_sole_group_id;

    v_metros_per_amarrado := COALESCE(v_pg.metros_fitilho_per_amarrado, 1.0);

    FOREACH v_pkg_type IN ARRAY v_types_to_debit
    LOOP
      v_box_id := NULL;
      v_pairs_per_box := NULL;

      IF v_pkg_type = 'individual' THEN
        v_box_id := v_pg.box_type_id;
        v_pairs_per_box := COALESCE(v_pg.pairs_per_box_individual, 1);
      ELSIF v_pkg_type = 'master' THEN
        v_box_id := v_pg.box_type_master_id;
        v_pairs_per_box := COALESCE(v_pg.pairs_per_box_master, 12);
      ELSIF v_pkg_type = 'colmeia' THEN
        v_box_id := v_pg.box_type_colmeia_id;
        v_pairs_per_box := COALESCE(v_pg.pairs_per_box_colmeia, 12);
      ELSIF v_pkg_type = 'fitilho' THEN
        v_box_id := v_pg.box_type_fitilho_id;
        v_pairs_per_box := COALESCE(v_pg.pairs_per_box_fitilho, 12);
      END IF;

      IF v_box_id IS NULL THEN
        CONTINUE;
      END IF;

      v_handled := true;

      SELECT quantity, nome INTO v_box_stock, v_box_name
        FROM public.box_types
       WHERE id = v_box_id
       FOR UPDATE;

      v_amarrados_needed := CEIL(p_order_quantity::numeric / GREATEST(v_pairs_per_box, 1));

      IF v_pkg_type = 'fitilho' THEN
        v_debit_qty := v_amarrados_needed * v_metros_per_amarrado;
        v_unit_label := 'metros';
      ELSE
        v_debit_qty := v_amarrados_needed;
        v_unit_label := 'caixas';
      END IF;

      IF v_box_stock IS NULL OR v_box_stock < v_debit_qty THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível % %, necessário % %',
          v_box_name, COALESCE(v_box_stock, 0), v_unit_label, v_debit_qty, v_unit_label;
      END IF;

      UPDATE public.box_types
         SET quantity = quantity - v_debit_qty, updated_at = now()
       WHERE id = v_box_id;

      INSERT INTO public.stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        v_box_id, 'out', v_debit_qty,
        v_box_stock, v_box_stock - v_debit_qty,
        'Débito embalagem ' || v_box_name || ' (' || v_pkg_type ||
        CASE WHEN v_pkg_type = 'fitilho'
             THEN ', ' || v_amarrados_needed || ' amarrados x ' || v_metros_per_amarrado || ' m'
             ELSE ''
        END || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'box_type_id', v_box_id,
        'box_name', v_box_name,
        'packaging_type', v_pkg_type,
        'amarrados_needed', v_amarrados_needed,
        'debited_qty', v_debit_qty,
        'unit', v_unit_label,
        'source', 'product_groups',
        'status', 'debited_box_types'
      );
    END LOOP;
  END IF;

  -- Fallback: packaging_configs (legacy)
  IF NOT v_handled THEN
    DECLARE
      cfg RECORD;
    BEGIN
      FOR cfg IN
        SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box, pc.product_id, pc.box_type_id,
               p.name AS product_name, bt.nome AS box_name
        FROM public.packaging_configs pc
        LEFT JOIN public.products  p  ON p.id  = pc.product_id  AND p.active  = true
        LEFT JOIN public.box_types bt ON bt.id = pc.box_type_id AND bt.active = true
        WHERE (
          (v_sole_group_id IS NOT NULL AND pc.sole_group_id = v_sole_group_id)
          OR (v_sole_group_id IS NULL AND pc.sheet_id = p_reference_id)
        )
          AND pc.active        = true
          AND pc.packaging_type = ANY(v_types_to_debit)
      LOOP
        v_amarrados_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

        IF cfg.packaging_type = 'fitilho' THEN
          v_debit_qty := v_amarrados_needed * COALESCE(v_metros_per_amarrado, 1.0);
          v_unit_label := 'metros';
        ELSE
          v_debit_qty := v_amarrados_needed;
          v_unit_label := 'caixas';
        END IF;

        IF cfg.box_type_id IS NOT NULL THEN
          SELECT quantity INTO v_box_stock
            FROM public.box_types WHERE id = cfg.box_type_id FOR UPDATE;
          IF v_box_stock IS NULL OR v_box_stock < v_debit_qty THEN
            RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível % %, necessário % %',
              COALESCE(cfg.box_name, cfg.nome), COALESCE(v_box_stock, 0), v_unit_label, v_debit_qty, v_unit_label;
          END IF;

          UPDATE public.box_types
             SET quantity = quantity - v_debit_qty, updated_at = now()
           WHERE id = cfg.box_type_id;

          INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
          VALUES (cfg.box_type_id, 'out', v_debit_qty, v_box_stock, v_box_stock - v_debit_qty,
                  'Débito embalagem ' || COALESCE(cfg.box_name, cfg.nome) || ' (' || cfg.packaging_type || ')', p_order_id);

          v_result := v_result || jsonb_build_object(
            'box_type_id', cfg.box_type_id, 'box_name', COALESCE(cfg.box_name, cfg.nome),
            'packaging_type', cfg.packaging_type, 'amarrados_needed', v_amarrados_needed,
            'debited_qty', v_debit_qty, 'unit', v_unit_label,
            'source', 'packaging_configs', 'status', 'debited_box_types'
          );

        ELSIF cfg.product_id IS NOT NULL THEN
          DECLARE v_prod_stock numeric; BEGIN
            SELECT quantity INTO v_prod_stock
              FROM public.products WHERE id = cfg.product_id FOR UPDATE;
            IF v_prod_stock IS NULL OR v_prod_stock < v_debit_qty THEN
              RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível % %, necessário % %',
                COALESCE(cfg.product_name, cfg.nome), COALESCE(v_prod_stock, 0), v_unit_label, v_debit_qty, v_unit_label;
            END IF;
            UPDATE public.products
               SET quantity = quantity - v_debit_qty, updated_at = now()
             WHERE id = cfg.product_id;
            INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
            VALUES (cfg.product_id, 'out', v_debit_qty, v_prod_stock, v_prod_stock - v_debit_qty,
                    'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type || ')', p_order_id);
            v_result := v_result || jsonb_build_object(
              'product_id', cfg.product_id, 'product_name', COALESCE(cfg.product_name, cfg.nome),
              'packaging_type', cfg.packaging_type, 'amarrados_needed', v_amarrados_needed,
              'debited_qty', v_debit_qty, 'unit', v_unit_label,
              'source', 'packaging_configs', 'status', 'debited_products'
            );
          END;
        ELSE
          v_result := v_result || jsonb_build_object(
            'packaging_type', cfg.packaging_type, 'nome', cfg.nome,
            'source', 'packaging_configs', 'status', 'skipped', 'reason', 'no_stock_linked'
          );
        END IF;
      END LOOP;
    END;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) TO authenticated;

COMMENT ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) IS
  'Debita embalagem da OP. Lê primeiro de product_groups (modelo atual usado pela UI nova); fallback em packaging_configs (legacy). Para fitilho, debita metros via product_groups.metros_fitilho_per_amarrado.';
