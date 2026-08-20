-- =============================================================================
-- SP120: GLOW METALIC é família; OURO LIGHT é SKU/cor dentro dessa família
-- =============================================================================
-- Falha encontrada em produção:
--   • SP120 (modelo de tiras) tinha lining_material=NAPA SUDANI, zero variantes;
--   • existia um produto ativo NAPA SUDANI / OURO LIGHT;
--   • o PV oferecia OURO LIGHT sem exigir material_variant_id, fazendo a napa
--     metálica parecer uma cor de NAPA SUDANI.
--
-- A correção preserva o histórico, regulariza a OC sugerida ainda não recebida,
-- cadastra as duas identidades comerciais da SP120 e impede a recriação do
-- mesmo erro de família no estoque.

BEGIN;

DO $$
DECLARE
  v_sheet_id uuid;
  v_sudani_group_id uuid;
  v_glow_group_id uuid;
  v_wrong_product public.products%ROWTYPE;
  v_glow_product public.products%ROWTYPE;
  v_affected_po_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT id
    INTO v_sheet_id
    FROM public.technical_sheets
   WHERE upper(btrim(name)) = 'SP120'
   ORDER BY updated_at DESC
   LIMIT 1;

  SELECT id INTO v_sudani_group_id
    FROM public.product_groups
   WHERE upper(btrim(name)) = 'NAPA SUDANI'
   LIMIT 1;

  SELECT id INTO v_glow_group_id
    FROM public.product_groups
   WHERE upper(btrim(name)) = 'GLOW METALIC'
   LIMIT 1;

  SELECT * INTO v_wrong_product
    FROM public.products
   WHERE sku = 'NAPA-SUDANI-OURO-LIGHT'
   LIMIT 1;

  SELECT * INTO v_glow_product
    FROM public.products
   WHERE group_id = v_glow_group_id
     AND active
     AND upper(btrim(color)) = 'OURO LIGHT'
   ORDER BY updated_at DESC
   LIMIT 1;

  IF v_sheet_id IS NULL THEN
    RAISE EXCEPTION 'Ficha SP120 não encontrada';
  END IF;
  IF v_sudani_group_id IS NULL OR v_glow_group_id IS NULL THEN
    RAISE EXCEPTION 'Grupos NAPA SUDANI/GLOW METALIC não encontrados';
  END IF;
  IF v_wrong_product.id IS NULL OR v_glow_product.id IS NULL THEN
    RAISE EXCEPTION 'Produtos OURO LIGHT incorreto/correto não encontrados';
  END IF;
  IF coalesce(v_wrong_product.quantity, 0) <> 0
     OR coalesce(v_wrong_product.reserved_stock, 0) <> 0 THEN
    RAISE EXCEPTION
      'NAPA SUDANI/OURO LIGHT possui estoque ou reserva; reconciliação manual necessária';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stock_movements WHERE product_id = v_wrong_product.id
  ) OR EXISTS (
    SELECT 1 FROM public.material_reservations WHERE product_id = v_wrong_product.id
  ) THEN
    RAISE EXCEPTION
      'NAPA SUDANI/OURO LIGHT possui movimentação/reserva histórica; não desativar automaticamente';
  END IF;

  -- A única OC viva está apenas sugerida e sem recebimento: trocar o item pela
  -- napa correta mantém quantidade, mas corrige produto, cor e preço antes da
  -- aprovação. OCs canceladas permanecem como histórico imutável.
  SELECT coalesce(array_agg(DISTINCT poi.purchase_order_id), ARRAY[]::uuid[])
    INTO v_affected_po_ids
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
   WHERE poi.product_id = v_wrong_product.id
     AND po.status = 'suggested'
     AND coalesce(poi.received_quantity, 0) = 0;

  UPDATE public.purchase_order_items poi
     SET product_id = v_glow_product.id,
         color = v_glow_product.color,
         unit = v_glow_product.unit,
         unit_price = v_glow_product.unit_price
    FROM public.purchase_orders po
   WHERE po.id = poi.purchase_order_id
     AND poi.product_id = v_wrong_product.id
     AND po.status = 'suggested'
     AND coalesce(poi.received_quantity, 0) = 0;

  UPDATE public.purchase_orders po
     SET total_value = totals.total_value,
         updated_at = now()
    FROM (
      SELECT poi.purchase_order_id,
             coalesce(sum(poi.quantity * poi.unit_price), 0) AS total_value
        FROM public.purchase_order_items poi
       WHERE poi.purchase_order_id = ANY(v_affected_po_ids)
       GROUP BY poi.purchase_order_id
    ) totals
   WHERE po.id = totals.purchase_order_id;

  IF EXISTS (
    SELECT 1
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
     WHERE poi.product_id = v_wrong_product.id
       AND po.status NOT IN ('cancelled', 'received', 'concluida', 'cancelada')
  ) THEN
    RAISE EXCEPTION 'Ainda existe OC viva apontando para NAPA SUDANI/OURO LIGHT';
  END IF;

  UPDATE public.products
     SET active = false,
         updated_at = now()
   WHERE id = v_wrong_product.id;

  -- SP120 é uma ficha de tiras: o material principal governa a napa de
  -- forração/reference_base, não um cabedal inexistente.
  UPDATE public.technical_sheets
     SET variant_drives_upper = false,
         variant_drives_lining = true,
         updated_at = now()
   WHERE id = v_sheet_id;

  IF EXISTS (
    SELECT 1
      FROM public.reference_material_variants
     WHERE lower(btrim(sku)) IN ('sp120-sudani', 'sp120-glow')
       AND reference_id <> v_sheet_id
  ) THEN
    RAISE EXCEPTION 'SKU SP120-SUDANI/SP120-GLOW já pertence a outra referência';
  END IF;

  UPDATE public.reference_material_variants
     SET material_name = 'NAPA SUDANI',
         sku = 'SP120-SUDANI',
         main_material_group_id = v_sudani_group_id,
         upper_material_product_id = NULL,
         upper_material_group_id = NULL,
         lining_material_product_id = NULL,
         lining_material_group_id = v_sudani_group_id,
         available_colors = NULL,
         active = true,
         display_order = 0
   WHERE reference_id = v_sheet_id
     AND lower(btrim(material_name)) = 'napa sudani';

  INSERT INTO public.reference_material_variants (
    reference_id, material_name, sku, main_material_group_id,
    upper_material_product_id, upper_material_group_id,
    lining_material_product_id, lining_material_group_id,
    available_colors, active, display_order
  )
  SELECT
    v_sheet_id, 'NAPA SUDANI', 'SP120-SUDANI', v_sudani_group_id,
    NULL, NULL, NULL, v_sudani_group_id,
    NULL, true, 0
  WHERE NOT EXISTS (
    SELECT 1 FROM public.reference_material_variants
     WHERE reference_id = v_sheet_id
       AND lower(btrim(material_name)) = 'napa sudani'
  );

  UPDATE public.reference_material_variants
     SET material_name = 'GLOW METALIC',
         sku = 'SP120-GLOW',
         main_material_group_id = v_glow_group_id,
         upper_material_product_id = NULL,
         upper_material_group_id = NULL,
         lining_material_product_id = NULL,
         lining_material_group_id = v_glow_group_id,
         available_colors = NULL,
         active = true,
         display_order = 1
   WHERE reference_id = v_sheet_id
     AND lower(btrim(material_name)) = 'glow metalic';

  INSERT INTO public.reference_material_variants (
    reference_id, material_name, sku, main_material_group_id,
    upper_material_product_id, upper_material_group_id,
    lining_material_product_id, lining_material_group_id,
    available_colors, active, display_order
  )
  SELECT
    v_sheet_id, 'GLOW METALIC', 'SP120-GLOW', v_glow_group_id,
    NULL, NULL, NULL, v_glow_group_id,
    NULL, true, 1
  WHERE NOT EXISTS (
    SELECT 1 FROM public.reference_material_variants
     WHERE reference_id = v_sheet_id
       AND lower(btrim(material_name)) = 'glow metalic'
  );

  IF (SELECT count(*) FROM public.reference_material_variants
       WHERE reference_id = v_sheet_id AND active
         AND lower(btrim(material_name)) IN ('napa sudani', 'glow metalic')) <> 2 THEN
    RAISE EXCEPTION 'SP120 não terminou com as duas variantes canônicas ativas';
  END IF;
END;
$$;

-- Invariante permanente: OURO LIGHT é produto da família GLOW METALIC. Os
-- produtos acabados/tiras/componentes com a mesma descrição continuam válidos;
-- a trava é somente contra as duas famílias de napa incorretas.
CREATE OR REPLACE FUNCTION public.guard_ouro_light_material_family()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_name text;
BEGIN
  IF NOT NEW.active OR upper(btrim(coalesce(NEW.color, ''))) <> 'OURO LIGHT' THEN
    RETURN NEW;
  END IF;

  SELECT upper(btrim(name)) INTO v_group_name
    FROM public.product_groups
   WHERE id = NEW.group_id;

  IF v_group_name IN ('NAPA SOFT', 'NAPA SUDANI') THEN
    RAISE EXCEPTION
      'OURO LIGHT pertence ao grupo GLOW METALIC, não ao grupo %', v_group_name
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_ouro_light_material_family ON public.products;
CREATE TRIGGER trg_guard_ouro_light_material_family
BEFORE INSERT OR UPDATE OF active, color, group_id
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.guard_ouro_light_material_family();

COMMENT ON FUNCTION public.guard_ouro_light_material_family() IS
  'Impede cadastrar OURO LIGHT como cor ativa de NAPA SOFT/NAPA SUDANI; a família canônica é GLOW METALIC.';

COMMIT;
