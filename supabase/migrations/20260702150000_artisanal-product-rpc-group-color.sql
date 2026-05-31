-- =============================================================================
-- RPCs de criação de produto com estoque inicial — ausentes no banco + fix
-- =============================================================================
-- A auditoria confirmou que create_artisanal_product_with_stock e
-- create_product_with_initial_stock NÃO existiam no banco (só adjust_stock):
-- a entrada da tira em cor nova (produceArtisanalOutput → conclusão da OS)
-- quebrava em runtime.
--
-- Além de (re)criá-las, a versão artesanal é CORRIGIDA para:
--   • setar group_id (resolvido do nome do grupo) e color — antes criava produto
--     ÓRFÃO (sem grupo, sem cor na coluna, nome com " - "), inconsistente com as
--     tiras existentes e invisível ao match por group_id;
--   • nomear no padrão "GRUPO: COR" (igual aos produtos de tira já cadastrados);
--   • gravar order_id = NULL no movimento (FK stock_movements.order_id -> orders;
--     passar service_order.id violava 23503).
-- =============================================================================

-- 1. create_product_with_initial_stock (genérica — recebe group_id por parâmetro)
CREATE OR REPLACE FUNCTION public.create_product_with_initial_stock(
  p_name         text,
  p_sku          text DEFAULT NULL,
  p_category     text DEFAULT 'material',
  p_unit         text DEFAULT 'un',
  p_location     text DEFAULT 'Almoxarifado A',
  p_quantity     numeric DEFAULT 0,
  p_unit_price   numeric DEFAULT 0,
  p_min_stock    numeric DEFAULT 0,
  p_max_stock    numeric DEFAULT 0,
  p_group_id     uuid DEFAULT NULL,
  p_description  text DEFAULT NULL,
  p_supplier_id  uuid DEFAULT NULL,
  p_reason       text DEFAULT 'Entrada inicial de estoque'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  INSERT INTO public.products (
    name, sku, category, unit, location,
    quantity, unit_price, min_stock, max_stock,
    group_id, description, supplier_id, active
  ) VALUES (
    p_name, p_sku, p_category, p_unit, p_location,
    p_quantity, p_unit_price, p_min_stock, p_max_stock,
    p_group_id, p_description, p_supplier_id, true
  ) RETURNING id INTO v_product_id;

  IF p_quantity > 0 THEN
    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description
    ) VALUES (
      v_product_id, 'in', p_quantity, 0, p_quantity, p_reason
    );
  END IF;

  RETURN v_product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_initial_stock(
  text, text, text, text, text, numeric, numeric, numeric, numeric, uuid, text, uuid, text
) TO authenticated;


-- 2. create_artisanal_product_with_stock (CORRIGIDA: group_id + color + "grupo: cor")
CREATE OR REPLACE FUNCTION public.create_artisanal_product_with_stock(
  p_name         text,
  p_color        text DEFAULT '',
  p_quantity     numeric DEFAULT 0,
  p_unit         text DEFAULT 'm',
  p_order_id     uuid DEFAULT NULL,
  p_reason       text DEFAULT 'Saída artesanal'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_product_id uuid;
  v_group_id   uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- p_name é o NOME DO GRUPO da tira → resolve group_id pra manter consistência
  -- com os produtos de tira existentes (group_id + color + nome "GRUPO: COR").
  SELECT id INTO v_group_id
    FROM public.product_groups
   WHERE lower(trim(unaccent(name))) = lower(trim(unaccent(p_name)))
   LIMIT 1;

  INSERT INTO public.products (
    name, color, group_id, category, unit, location,
    quantity, unit_price, min_stock, max_stock, active
  ) VALUES (
    p_name || CASE WHEN p_color <> '' THEN ': ' || p_color ELSE '' END,
    NULLIF(p_color, ''), v_group_id,
    'artesanal', p_unit, 'Produção',
    p_quantity, 0, 0, 0, true
  ) RETURNING id INTO v_product_id;

  IF p_quantity > 0 THEN
    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_product_id, 'in', p_quantity, 0, p_quantity, p_reason, NULL
    );
  END IF;

  RETURN v_product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_artisanal_product_with_stock(
  text, text, numeric, text, uuid, text
) TO authenticated;
