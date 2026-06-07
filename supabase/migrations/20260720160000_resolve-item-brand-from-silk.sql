-- resolve_item_brand: MARCA de um item (NF-e <prod><xMarca> + etiqueta de caixa
-- externa) derivada do SILK do solado. Pedido user 2026-06-07: o nome do silk
-- (sole_silk_registrations.silk_name), que já é ligado ao solado, passa a ser a
-- MARCA que sai na nota fiscal e na etiqueta de caixa externa. Quando o solado
-- do item não tem silk cadastrado, cai no fallback fixo 'Squad Shoes'.
--
-- Cascata (espelha getEffectiveSilk / src/lib/silkUtils.ts):
--   1. silk do CLIENTE          (client_id = cliente do pedido)
--   2. silk do GRUPO ECONÔMICO  (economic_group_id do cliente)
--   3. silk PADRÃO do solado    (client_id IS NULL AND economic_group_id IS NULL)
-- Em cada nível casa por sole_product_id (resolvido via resolve_sole_color) e,
-- como compatibilidade com registros legados, por sole_type = nome do produto-
-- solado (registros antigos sem sole_product_id). Match exato por
-- sole_product_id tem prioridade sobre o fallback por nome.

CREATE OR REPLACE FUNCTION public.resolve_item_brand(
  p_sheet_id uuid,
  p_color text,
  p_client_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_id   uuid;
  v_sole_name text;
  v_eco_group uuid;
  v_brand     text;
BEGIN
  -- 1) Solado do item — mesma resolução canônica do consumo/custeio.
  SELECT sole_product_id INTO v_sole_id
    FROM public.resolve_sole_color(p_sheet_id, p_color)
    LIMIT 1;

  -- Sem solado resolvido (ex.: NF avulsa sem ficha) → marca padrão da fábrica.
  IF v_sole_id IS NULL THEN
    RETURN 'Squad Shoes';
  END IF;

  SELECT name INTO v_sole_name FROM public.products WHERE id = v_sole_id;

  IF p_client_id IS NOT NULL THEN
    SELECT economic_group_id INTO v_eco_group FROM public.clients WHERE id = p_client_id;
  END IF;

  -- 2.1) Silk específico do CLIENTE.
  IF p_client_id IS NOT NULL THEN
    SELECT NULLIF(TRIM(silk_name), '') INTO v_brand
      FROM public.sole_silk_registrations
     WHERE client_id = p_client_id
       AND ( sole_product_id = v_sole_id
             OR (sole_product_id IS NULL AND v_sole_name IS NOT NULL
                 AND UPPER(TRIM(sole_type)) = UPPER(TRIM(v_sole_name))) )
       AND NULLIF(TRIM(silk_name), '') IS NOT NULL
     ORDER BY (sole_product_id = v_sole_id) DESC NULLS LAST
     LIMIT 1;
    IF v_brand IS NOT NULL THEN RETURN v_brand; END IF;
  END IF;

  -- 2.2) Silk do GRUPO ECONÔMICO.
  IF v_eco_group IS NOT NULL THEN
    SELECT NULLIF(TRIM(silk_name), '') INTO v_brand
      FROM public.sole_silk_registrations
     WHERE economic_group_id = v_eco_group
       AND client_id IS NULL
       AND ( sole_product_id = v_sole_id
             OR (sole_product_id IS NULL AND v_sole_name IS NOT NULL
                 AND UPPER(TRIM(sole_type)) = UPPER(TRIM(v_sole_name))) )
       AND NULLIF(TRIM(silk_name), '') IS NOT NULL
     ORDER BY (sole_product_id = v_sole_id) DESC NULLS LAST
     LIMIT 1;
    IF v_brand IS NOT NULL THEN RETURN v_brand; END IF;
  END IF;

  -- 2.3) Silk PADRÃO do solado (sem cliente / sem grupo).
  SELECT NULLIF(TRIM(silk_name), '') INTO v_brand
    FROM public.sole_silk_registrations
   WHERE client_id IS NULL
     AND economic_group_id IS NULL
     AND ( sole_product_id = v_sole_id
           OR (sole_product_id IS NULL AND v_sole_name IS NOT NULL
               AND UPPER(TRIM(sole_type)) = UPPER(TRIM(v_sole_name))) )
     AND NULLIF(TRIM(silk_name), '') IS NOT NULL
   ORDER BY (sole_product_id = v_sole_id) DESC NULLS LAST
   LIMIT 1;
  IF v_brand IS NOT NULL THEN RETURN v_brand; END IF;

  RETURN 'Squad Shoes';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_item_brand(uuid, text, uuid)
  TO anon, authenticated, service_role;
