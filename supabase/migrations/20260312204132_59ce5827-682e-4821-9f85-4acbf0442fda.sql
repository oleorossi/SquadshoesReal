
-- Update debit_stock_for_order to use sheet_materials instead of reference_materials
DROP FUNCTION IF EXISTS public.debit_stock_for_order(p_reference_id uuid, p_order_quantity integer, p_color text) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_stock_for_order(p_reference_id uuid, p_order_quantity integer, p_color text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  mat RECORD;
  required numeric;
  current_qty numeric;
  target_product_id uuid;
  target_name text;
  target_qty numeric;
BEGIN
  -- First validate all materials have sufficient stock
  FOR mat IN
    SELECT sm.product_id, sm.quantity_per_unit, p.quantity AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id
  LOOP
    required := mat.quantity_per_unit * p_order_quantity;
    
    -- Try to find color variant if p_color is provided
    target_product_id := mat.product_id;
    target_name := mat.name;
    target_qty := mat.current_stock;
    
    IF p_color IS NOT NULL AND p_color != '' AND mat.product_color != p_color THEN
      -- Look for sibling product with matching color in same group
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p
      WHERE p.active = true
        AND p.color = p_color
        AND (
          (mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
          OR (mat.group_id IS NULL AND p.name = mat.name)
        )
      LIMIT 1;
      
      -- If no variant found, fall back to original product
      IF target_product_id IS NULL THEN
        target_product_id := mat.product_id;
        target_name := mat.name;
        target_qty := mat.current_stock;
      END IF;
    END IF;
    
    IF target_qty < required THEN
      RAISE EXCEPTION 'Estoque insuficiente para "%" (%): disponível %, necessário %', 
        target_name, COALESCE(p_color, ''), target_qty, required;
    END IF;
  END LOOP;

  -- Debit and log movements
  FOR mat IN
    SELECT sm.product_id, sm.quantity_per_unit, p.quantity AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id
  LOOP
    required := mat.quantity_per_unit * p_order_quantity;
    
    target_product_id := mat.product_id;
    current_qty := mat.current_stock;
    
    IF p_color IS NOT NULL AND p_color != '' AND mat.product_color != p_color THEN
      SELECT p.id, p.quantity INTO target_product_id, current_qty
      FROM public.products p
      WHERE p.active = true
        AND p.color = p_color
        AND (
          (mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
          OR (mat.group_id IS NULL AND p.name = mat.name)
        )
      LIMIT 1;
      
      IF target_product_id IS NULL THEN
        target_product_id := mat.product_id;
        current_qty := mat.current_stock;
      END IF;
    END IF;

    -- Update stock
    UPDATE public.products
    SET quantity = quantity - required, updated_at = now()
    WHERE id = target_product_id;

    -- Log movement
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description)
    VALUES (target_product_id, 'out', required, current_qty, current_qty - required, 
            'Débito automático - Pedido' || CASE WHEN p_color != '' THEN ' (Cor: ' || p_color || ')' ELSE '' END);
  END LOOP;
END;
$function$;

-- Update check_stock_availability to use sheet_materials
DROP FUNCTION IF EXISTS public.check_stock_availability(p_reference_id uuid, p_order_quantity integer, p_color text) CASCADE;
CREATE OR REPLACE FUNCTION public.check_stock_availability(p_reference_id uuid, p_order_quantity integer, p_color text DEFAULT ''::text)
 RETURNS TABLE(product_id uuid, product_name text, required numeric, available numeric, sufficient boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(
      CASE WHEN p_color != '' AND sm_p.color != p_color THEN
        (SELECT p2.id FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((sm_p.group_id IS NOT NULL AND p2.group_id = sm_p.group_id)
              OR (sm_p.group_id IS NULL AND p2.name = sm_p.name))
         LIMIT 1)
      END,
      sm.product_id
    ) AS product_id,
    COALESCE(
      CASE WHEN p_color != '' AND sm_p.color != p_color THEN
        (SELECT p2.name || ': ' || p2.color FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((sm_p.group_id IS NOT NULL AND p2.group_id = sm_p.group_id)
              OR (sm_p.group_id IS NULL AND p2.name = sm_p.name))
         LIMIT 1)
      END,
      sm_p.name
    ) AS product_name,
    (sm.quantity_per_unit * p_order_quantity)::numeric AS required,
    COALESCE(
      CASE WHEN p_color != '' AND sm_p.color != p_color THEN
        (SELECT p2.quantity FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((sm_p.group_id IS NOT NULL AND p2.group_id = sm_p.group_id)
              OR (sm_p.group_id IS NULL AND p2.name = sm_p.name))
         LIMIT 1)
      END,
      sm_p.quantity
    ) AS available,
    COALESCE(
      CASE WHEN p_color != '' AND sm_p.color != p_color THEN
        (SELECT p2.quantity FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((sm_p.group_id IS NOT NULL AND p2.group_id = sm_p.group_id)
              OR (sm_p.group_id IS NULL AND p2.name = sm_p.name))
         LIMIT 1)
      END,
      sm_p.quantity
    ) >= (sm.quantity_per_unit * p_order_quantity) AS sufficient
  FROM public.sheet_materials sm
  JOIN public.products sm_p ON sm_p.id = sm.product_id
  WHERE sm.sheet_id = p_reference_id;
END;
$function$;

-- Also update the simpler overloads
DROP FUNCTION IF EXISTS public.debit_stock_for_order(p_reference_id uuid, p_order_quantity integer) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_stock_for_order(p_reference_id uuid, p_order_quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.debit_stock_for_order(p_reference_id, p_order_quantity, ''::text);
END;
$function$;

DROP FUNCTION IF EXISTS public.check_stock_availability(p_reference_id uuid, p_order_quantity integer) CASCADE;
CREATE OR REPLACE FUNCTION public.check_stock_availability(p_reference_id uuid, p_order_quantity integer)
 RETURNS TABLE(product_id uuid, product_name text, required numeric, available numeric, sufficient boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM public.check_stock_availability(p_reference_id, p_order_quantity, ''::text);
END;
$function$;
