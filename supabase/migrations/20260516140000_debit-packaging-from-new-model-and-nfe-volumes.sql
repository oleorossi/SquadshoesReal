-- =============================================================================
-- Atualiza debit_packaging_for_order pra ler do novo modelo
-- (technical_sheet_box_types + box_types.tipo/pairs_per_box_default), e cria
-- compute_sale_order_nfe_volumes(sale_order_id) que retorna o nº de volumes
-- correto pra emissão de NF-e segundo packaging_mode do PV.
--
-- Regras de volume na NF-e (confirmadas em 2026-05-16):
--   • individual_master            → 1 master = 1 volume (12 pares por master)
--   • colmeia                      → 1 colmeia = 1 volume (12 pares por colmeia)
--   • individual_fitilho/amarrado  → cada PAR = 1 volume (fitilho não agrupa)
-- =============================================================================

-- 1. RPC de débito atualizada: lê primeiro do novo modelo
DROP FUNCTION IF EXISTS public.debit_packaging_for_order(uuid, uuid, uuid, integer, text, boolean) CASCADE;

CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id  uuid,
  p_order_id       uuid,
  p_reference_id   uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_master',
  p_force_soft     boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sole_group_id    uuid;
  v_types_to_debit   text[];
  v_result           jsonb := '[]'::jsonb;
  v_box              RECORD;
  v_amarrados_needed integer;
  v_debit_qty        numeric;
  v_unit_label       text;
  v_metros           numeric;
  v_handled          boolean := false;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode IN ('individual_fitilho', 'individual_amarrado') THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  -- Caminho primário: novo modelo (technical_sheet_box_types + box_types.tipo)
  FOR v_box IN
    SELECT bt.id, bt.nome, bt.tipo::text AS tipo,
           COALESCE(bt.pairs_per_box_default, 1) AS pairs_per_box,
           COALESCE(bt.metros_per_amarrado_default, 1.0) AS metros_per_amarrado,
           bt.quantity
      FROM public.technical_sheet_box_types tsbt
      JOIN public.box_types bt ON bt.id = tsbt.box_type_id AND bt.active = true
     WHERE tsbt.sheet_id = p_reference_id
       AND bt.tipo::text = ANY(v_types_to_debit)
  LOOP
    v_handled := true;
    v_amarrados_needed := CEIL(p_order_quantity::numeric / GREATEST(v_box.pairs_per_box, 1));

    IF v_box.tipo = 'fitilho' THEN
      v_debit_qty := v_amarrados_needed * v_box.metros_per_amarrado;
      v_unit_label := 'metros';
    ELSE
      v_debit_qty := v_amarrados_needed;
      v_unit_label := 'caixas';
    END IF;

    IF p_force_soft THEN
      v_result := v_result || jsonb_build_object(
        'box_type_id', v_box.id, 'box_name', v_box.nome,
        'packaging_type', v_box.tipo,
        'amarrados_needed', v_amarrados_needed,
        'projected_qty', v_debit_qty, 'unit', v_unit_label,
        'source', 'technical_sheet_box_types',
        'status', 'soft_projected'
      );
      CONTINUE;
    END IF;

    -- Hard debit com lock (FOR UPDATE)
    PERFORM 1 FROM public.box_types WHERE id = v_box.id FOR UPDATE;

    IF v_box.quantity IS NULL OR v_box.quantity < v_debit_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível % %, necessário % %',
        v_box.nome, COALESCE(v_box.quantity, 0), v_unit_label, v_debit_qty, v_unit_label;
    END IF;

    UPDATE public.box_types
       SET quantity = quantity - v_debit_qty, updated_at = now()
     WHERE id = v_box.id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock, description, order_id
    ) VALUES (
      v_box.id, 'out', v_debit_qty,
      v_box.quantity, v_box.quantity - v_debit_qty,
      'Débito embalagem ' || v_box.nome || ' (' || v_box.tipo ||
      CASE WHEN v_box.tipo = 'fitilho'
           THEN ', ' || v_amarrados_needed || ' amarrados x ' || v_box.metros_per_amarrado || ' m'
           ELSE ''
      END || ')',
      p_order_id
    );

    v_result := v_result || jsonb_build_object(
      'box_type_id', v_box.id, 'box_name', v_box.nome,
      'packaging_type', v_box.tipo,
      'amarrados_needed', v_amarrados_needed,
      'debited_qty', v_debit_qty, 'unit', v_unit_label,
      'source', 'technical_sheet_box_types',
      'status', 'debited_box_types'
    );
  END LOOP;

  -- Fallback 1: modelo legado em product_groups (para fichas ainda não migradas)
  IF NOT v_handled THEN
    DECLARE
      v_pg            RECORD;
      v_box_id        uuid;
      v_pairs_per_box integer;
      v_box_stock     numeric;
      v_box_name      text;
      v_pkg_type      text;
    BEGIN
      SELECT sole_group_id INTO v_sole_group_id
        FROM public.technical_sheets WHERE id = p_reference_id;

      IF v_sole_group_id IS NOT NULL THEN
        SELECT * INTO v_pg
          FROM public.product_groups WHERE id = v_sole_group_id;

        v_metros := COALESCE(v_pg.metros_fitilho_per_amarrado, 1.0);

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
            FROM public.box_types WHERE id = v_box_id FOR UPDATE;

          v_amarrados_needed := CEIL(p_order_quantity::numeric / GREATEST(v_pairs_per_box, 1));

          IF v_pkg_type = 'fitilho' THEN
            v_debit_qty := v_amarrados_needed * v_metros;
            v_unit_label := 'metros';
          ELSE
            v_debit_qty := v_amarrados_needed;
            v_unit_label := 'caixas';
          END IF;

          IF p_force_soft THEN
            v_result := v_result || jsonb_build_object(
              'box_type_id', v_box_id, 'box_name', v_box_name,
              'packaging_type', v_pkg_type,
              'amarrados_needed', v_amarrados_needed,
              'projected_qty', v_debit_qty, 'unit', v_unit_label,
              'source', 'product_groups_legacy', 'status', 'soft_projected'
            );
            CONTINUE;
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
            'Débito embalagem ' || v_box_name || ' (' || v_pkg_type || ')',
            p_order_id
          );

          v_result := v_result || jsonb_build_object(
            'box_type_id', v_box_id, 'box_name', v_box_name,
            'packaging_type', v_pkg_type,
            'amarrados_needed', v_amarrados_needed,
            'debited_qty', v_debit_qty, 'unit', v_unit_label,
            'source', 'product_groups_legacy', 'status', 'debited_box_types'
          );
        END LOOP;
      END IF;
    END;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text, boolean) IS
  'Debita embalagem da OP. Lê primeiro de technical_sheet_box_types (modelo novo, multi-select); fallback em product_groups (legacy). Modo soft apenas projeta. individual_amarrado é sinônimo de individual_fitilho.';

-- =============================================================================
-- 2. Função pra cálculo de volumes da NF-e
-- =============================================================================

DROP FUNCTION IF EXISTS public.compute_sale_order_nfe_volumes(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.compute_sale_order_nfe_volumes(p_sale_order_id uuid)
RETURNS TABLE(volumes integer, mode text, breakdown jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mode        text;
  v_total_pairs integer;
  v_volumes     integer := 0;
  v_breakdown   jsonb := '[]'::jsonb;
  v_box         RECORD;
  v_target_type text;
BEGIN
  SELECT packaging_mode INTO v_mode FROM public.sale_orders WHERE id = p_sale_order_id;

  -- Modo fitilho/amarrado: cada par é um volume (fitilho amarra individuais mas
  -- não as agrupa em master — transportadora conta par a par).
  IF v_mode IN ('individual_fitilho', 'individual_amarrado') THEN
    SELECT COALESCE(SUM(quantity), 0) INTO v_total_pairs
      FROM public.sale_order_items WHERE sale_order_id = p_sale_order_id;

    v_breakdown := jsonb_build_array(jsonb_build_object(
      'kind', 'pair_as_volume',
      'pairs', v_total_pairs,
      'volumes', v_total_pairs,
      'reason', 'modo amarrado/fitilho: cada par = 1 volume'
    ));
    RETURN QUERY SELECT v_total_pairs, COALESCE(v_mode, 'individual_fitilho'), v_breakdown;
    RETURN;
  END IF;

  -- Modos com agrupamento: cada caixa do tipo agrupador (master ou colmeia) = 1 volume.
  v_target_type := CASE
    WHEN v_mode = 'colmeia'           THEN 'colmeia'
    WHEN v_mode = 'individual_master' THEN 'master'
    ELSE 'individual'
  END;

  -- Pra cada item do PV, pega caixa do tipo alvo vinculada à ficha técnica e
  -- soma CEIL(qty / pairs_per_box_default) — assim respeita box_types.pairs_per_box_default.
  FOR v_box IN
    WITH items AS (
      SELECT soi.reference_id, SUM(soi.quantity)::integer AS qty
        FROM public.sale_order_items soi
       WHERE soi.sale_order_id = p_sale_order_id
       GROUP BY soi.reference_id
    )
    SELECT i.reference_id, i.qty,
           bt.id AS box_id, bt.nome AS box_name,
           COALESCE(bt.pairs_per_box_default, 12) AS pairs_per_box
      FROM items i
      LEFT JOIN LATERAL (
        SELECT bt.id, bt.nome, bt.pairs_per_box_default
          FROM public.technical_sheet_box_types tsbt
          JOIN public.box_types bt ON bt.id = tsbt.box_type_id
                                  AND bt.active = true
                                  AND bt.tipo::text = v_target_type
         WHERE tsbt.sheet_id = i.reference_id
         LIMIT 1
      ) bt ON true
  LOOP
    DECLARE v_boxes integer; BEGIN
      v_boxes := CEIL(v_box.qty::numeric / GREATEST(v_box.pairs_per_box, 1));
      v_volumes := v_volumes + v_boxes;
      v_breakdown := v_breakdown || jsonb_build_object(
        'reference_id', v_box.reference_id,
        'pairs', v_box.qty,
        'box_name', v_box.box_name,
        'pairs_per_box', v_box.pairs_per_box,
        'volumes', v_boxes
      );
    END;
  END LOOP;

  -- Garantia: NF nunca pode ir com 0 volumes.
  IF v_volumes < 1 THEN v_volumes := 1; END IF;

  RETURN QUERY SELECT v_volumes, COALESCE(v_mode, 'individual_master'), v_breakdown;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_sale_order_nfe_volumes(uuid) TO authenticated;

COMMENT ON FUNCTION public.compute_sale_order_nfe_volumes(uuid) IS
  'Retorna nº de volumes pra emissão de NF-e segundo packaging_mode do PV. Modos master/colmeia agrupam 12 pares por volume; fitilho/amarrado cada par é 1 volume.';
