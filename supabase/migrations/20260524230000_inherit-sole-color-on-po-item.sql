-- =============================================================================
-- Trigger: purchase_order_items herda cor do solado quando NULL
-- =============================================================================
-- Causa: MaterialPurchaseConfirmDialog cria OC passando color do SAPATO (item
-- do PV), não do solado. autoCreateSolePO resolveria corretamente via
-- technical_sheet_sole_colors mas só é chamada em outro caminho. Resultado:
-- 5/5 OCs de solado em prod com color=null, embora products.color esteja
-- cadastrado.
--
-- Fix: trigger BEFORE INSERT/UPDATE em purchase_order_items que, se produto
-- é category='Solado' e color veio NULL/vazio, herda products.color.
--
-- Backfill incluso pras 5 OCs existentes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_inherit_sole_color_on_po_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cat text;
  v_color text;
BEGIN
  IF NEW.color IS NOT NULL AND NEW.color <> '' THEN
    RETURN NEW;
  END IF;
  SELECT category, color INTO v_cat, v_color
  FROM public.products WHERE id = NEW.product_id;
  IF v_cat = 'Solado' AND v_color IS NOT NULL AND v_color <> '' THEN
    NEW.color := v_color;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_inherit_sole_color_on_po_item ON public.purchase_order_items;
CREATE TRIGGER tg_inherit_sole_color_on_po_item
BEFORE INSERT OR UPDATE OF color, product_id ON public.purchase_order_items
FOR EACH ROW
EXECUTE FUNCTION public.tg_inherit_sole_color_on_po_item();

UPDATE public.purchase_order_items poi
SET color = p.color
FROM public.products p
WHERE poi.product_id = p.id
  AND p.category = 'Solado'
  AND (poi.color IS NULL OR poi.color = '')
  AND p.color IS NOT NULL
  AND p.color <> '';
