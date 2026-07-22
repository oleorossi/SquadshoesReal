-- =============================================================================
-- Fix: create_product_with_initial_stock inseria a coluna `description` em
-- `products`, que NÃO existe → todo "Criar novo produto" a partir de NF de
-- entrada (AddToStockDialog, modo create) estourava com
--   ERROR: column "description" of relation "products" does not exist
-- e o item da NF nunca saía de PENDENTE (spec: nf-lancar-produto-novo).
--
-- Além do fix, o produto passa a nascer COMPLETO no primeiro lançamento:
--   - `color`          → desempata o match automático das próximas NFs
--   - `supplier_id`    → liga o produto ao fornecedor da NF (antes era null fixo)
--   - `purchase_unit`  + `conversion_rate` → quando a unidade da NF é embalagem
--     (CX/RL/FD) ≠ unidade de estoque, a próxima importação já converte sozinha
--     em vez de bloquear (needsConfig).
--
-- Como a assinatura muda (3 params novos ao final), NÃO dá pra CREATE OR REPLACE
-- em cima da antiga (viraria um overload duplicado). Fazemos DROP da assinatura
-- antiga + CREATE da nova + re-GRANT (mantendo SECURITY DEFINER, search_path,
-- is_approved_user() e a mesma postura de segurança: revoke anon / grant
-- authenticated — mesmas migrations 20260519170000 / 20260721250000 / 20260830120000).
--
-- `p_description` é MANTIDO na assinatura por compatibilidade, mas deixa de ir
-- pra `products`; se preenchido, serve de fallback do "reason" do stock_movement.
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_product_with_initial_stock(
  text, text, text, text, text, numeric, numeric, numeric, numeric, uuid, text, uuid, text
);

CREATE OR REPLACE FUNCTION public.create_product_with_initial_stock(
  p_name            text,
  p_sku             text    DEFAULT NULL,
  p_category        text    DEFAULT 'material',
  p_unit            text    DEFAULT 'un',
  p_location        text    DEFAULT 'Almoxarifado A',
  p_quantity        numeric DEFAULT 0,
  p_unit_price      numeric DEFAULT 0,
  p_min_stock       numeric DEFAULT 0,
  p_max_stock       numeric DEFAULT 0,
  p_group_id        uuid    DEFAULT NULL,
  p_description     text    DEFAULT NULL,   -- compat: NÃO vai pra products (coluna não existe)
  p_supplier_id     uuid    DEFAULT NULL,
  p_reason          text    DEFAULT 'Entrada inicial de estoque',
  p_color           text    DEFAULT NULL,
  p_purchase_unit   text    DEFAULT NULL,
  p_conversion_rate numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  INSERT INTO public.products (
    name, sku, category, unit, location,
    quantity, unit_price, min_stock, max_stock,
    group_id, supplier_id, color, purchase_unit, conversion_rate, active
  ) VALUES (
    p_name, p_sku, p_category, p_unit, p_location,
    p_quantity, p_unit_price, p_min_stock, p_max_stock,
    p_group_id, p_supplier_id, p_color,
    -- invariante do projeto: purchase_unit == unit ⇒ conversion_rate = 1;
    -- conversion_rate = 0 é sempre inválido → cai pra 1.
    COALESCE(NULLIF(p_purchase_unit, ''), p_unit),
    COALESCE(NULLIF(p_conversion_rate, 0), 1),
    true
  ) RETURNING id INTO v_product_id;

  IF p_quantity > 0 THEN
    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description
    ) VALUES (
      v_product_id, 'in', p_quantity, 0, p_quantity,
      COALESCE(NULLIF(p_reason, ''), p_description, 'Entrada inicial de estoque')
    );
  END IF;

  RETURN v_product_id;
END;
$function$;

-- Segurança: mesma postura das migrations anteriores (anon não executa;
-- authenticated sim). A checagem is_approved_user() já barra usuário pendente.
REVOKE EXECUTE ON FUNCTION public.create_product_with_initial_stock(
  text, text, text, text, text, numeric, numeric, numeric, numeric, uuid, text, uuid, text, text, text, numeric
) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_product_with_initial_stock(
  text, text, text, text, text, numeric, numeric, numeric, numeric, uuid, text, uuid, text, text, text, numeric
) TO authenticated;
