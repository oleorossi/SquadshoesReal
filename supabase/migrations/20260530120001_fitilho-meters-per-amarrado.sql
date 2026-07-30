-- =============================================================================
-- Modo "Amarrado" — fitilho debitado em METROS por amarrado.
-- =============================================================================
--
-- Antes: o fitilho era tratado como uma "caixa" qualquer no debit_packaging_for_order.
--   - amarrados_needed = CEIL(qty / pairs_per_box_fitilho)
--   - debita 1 unidade da box_types.quantity por amarrado (semântica ambígua: rolo? metro?).
--
-- Realidade da fábrica: cada amarrado consome N metros de fitilho. O usuário cadastra
-- o fitilho como um box_type cujo "quantity" representa metros disponíveis no estoque
-- e quer informar quantos metros são usados por amarrado.
--
-- Mudanças desta migration:
--   1) Adiciona coluna `metros_fitilho_per_amarrado` em `product_groups` (default 1.0).
--   2) Atualiza `debit_packaging_for_order`:
--      - Para packaging_type='fitilho', resolve metros_per_amarrado via JOIN com
--        product_groups (através de technical_sheets.sole_group_id).
--      - Calcula meters_needed = amarrados_needed * metros_per_amarrado.
--      - Debita `meters_needed` (não amarrados) de box_types.quantity.
--   3) Mensagem de stock_movements explicita "metros" quando aplicável.
--
-- Fallback: se metros_per_amarrado for NULL (cadastro pré-migration), usa 1.0
-- e mantém o comportamento antigo (1 unidade por amarrado). Idempotente.
-- =============================================================================

-- 1) Coluna nova em product_groups
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS metros_fitilho_per_amarrado numeric;

COMMENT ON COLUMN public.product_groups.metros_fitilho_per_amarrado IS
  'Metros de fitilho consumidos por cada amarrado (modo individual_fitilho). '
  'Combinado com pairs_per_box_fitilho (= pares por amarrado), define o débito '
  'em metros: meters = CEIL(qty / pairs_per_amarrado) * metros_per_amarrado.';

-- 2) RPC atualizada
DROP FUNCTION IF EXISTS public.debit_packaging_for_order(p_sale_order_id uuid, p_order_id uuid, p_reference_id uuid, p_order_quantity integer, p_packaging_mode text) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id  uuid,
  p_order_id       uuid,
  p_reference_id   uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg              RECORD;
  v_sole_group_id  uuid;
  v_metros_per_amarrado numeric;
  amarrados_needed integer;
  boxes_needed     numeric;   -- agora pode ser fracionário (metros) ou inteiro (caixas)
  v_result         jsonb   := '[]'::jsonb;
  v_types_to_debit text[];
  v_box_stock      numeric;
  v_prod_stock     numeric;
  v_debit_qty      numeric;
  v_unit_label     text;
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

  -- Resolve sole_group_id da ficha técnica para puxar metros_per_amarrado.
  SELECT sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets
   WHERE id = p_reference_id;

  IF v_sole_group_id IS NOT NULL THEN
    SELECT metros_fitilho_per_amarrado INTO v_metros_per_amarrado
      FROM public.product_groups
     WHERE id = v_sole_group_id;
  END IF;

  -- Default 1.0 = comportamento antigo (1 unidade debitada por amarrado).
  v_metros_per_amarrado := COALESCE(v_metros_per_amarrado, 1.0);

  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box, pc.product_id, pc.box_type_id,
           p.name AS product_name,
           bt.nome AS box_name
    FROM packaging_configs pc
    LEFT JOIN products  p  ON p.id  = pc.product_id  AND p.active  = true
    LEFT JOIN box_types bt ON bt.id = pc.box_type_id AND bt.active = true
    WHERE pc.sheet_id       = p_reference_id
      AND pc.active         = true
      AND pc.packaging_type = ANY(v_types_to_debit)
  LOOP
    amarrados_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    IF cfg.packaging_type = 'fitilho' THEN
      -- Para fitilho: debitar METROS, não unidades.
      v_debit_qty := amarrados_needed * v_metros_per_amarrado;
      v_unit_label := 'metros';
    ELSE
      v_debit_qty := amarrados_needed;
      v_unit_label := 'caixas';
    END IF;

    boxes_needed := v_debit_qty;

    IF cfg.box_type_id IS NOT NULL THEN
      -- Lock the box_type row exclusively before reading stock
      SELECT quantity INTO v_box_stock
        FROM public.box_types
       WHERE id = cfg.box_type_id
       FOR UPDATE;

      IF v_box_stock IS NULL OR v_box_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível % %, necessário % %',
          COALESCE(cfg.box_name, cfg.nome), COALESCE(v_box_stock, 0), v_unit_label, boxes_needed, v_unit_label;
      END IF;

      UPDATE box_types
         SET quantity   = quantity - boxes_needed,
             updated_at = now()
       WHERE id = cfg.box_type_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.box_type_id, 'out', boxes_needed,
        v_box_stock, v_box_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.box_name, cfg.nome) || ' (' || cfg.packaging_type ||
        CASE WHEN cfg.packaging_type = 'fitilho'
             THEN ', ' || amarrados_needed || ' amarrados × ' || v_metros_per_amarrado || ' m'
             ELSE ''
        END || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'box_type_id',    cfg.box_type_id,
        'box_name',       COALESCE(cfg.box_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'amarrados_needed', amarrados_needed,
        'debited_qty',    boxes_needed,
        'unit',           v_unit_label,
        'status',         'debited_box_types'
      );

    ELSIF cfg.product_id IS NOT NULL THEN
      -- Lock the product row exclusively before reading stock
      SELECT quantity INTO v_prod_stock
        FROM public.products
       WHERE id = cfg.product_id
       FOR UPDATE;

      IF v_prod_stock IS NULL OR v_prod_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível % %, necessário % %',
          COALESCE(cfg.product_name, cfg.nome), COALESCE(v_prod_stock, 0), v_unit_label, boxes_needed, v_unit_label;
      END IF;

      UPDATE products
         SET quantity   = quantity - boxes_needed,
             updated_at = now()
       WHERE id = cfg.product_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.product_id, 'out', boxes_needed,
        v_prod_stock, v_prod_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type ||
        CASE WHEN cfg.packaging_type = 'fitilho'
             THEN ', ' || amarrados_needed || ' amarrados × ' || v_metros_per_amarrado || ' m'
             ELSE ''
        END || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'product_id',     cfg.product_id,
        'product_name',   COALESCE(cfg.product_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'amarrados_needed', amarrados_needed,
        'debited_qty',    boxes_needed,
        'unit',           v_unit_label,
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

COMMENT ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) IS
  'Debits packaging stock atomically. For fitilho mode, debits in METERS using '
  'product_groups.metros_fitilho_per_amarrado × amarrados_needed. Default 1.0 m/amarrado '
  'when not configured (preserves legacy behavior).';
