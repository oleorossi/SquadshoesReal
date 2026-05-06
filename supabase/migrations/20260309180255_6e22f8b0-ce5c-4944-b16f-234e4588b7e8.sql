
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
    SELECT rm.product_id, rm.quantity_per_unit, p.quantity AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.reference_materials rm
    JOIN public.products p ON p.id = rm.product_id
    WHERE rm.reference_id = p_reference_id
  LOOP
    required := mat.quantity_per_unit * p_order_quantity;
    
    -- Try to find color variant if p_color is provided
    target_product_id := mat.product_id;
    target_name := mat.name;
    target_qty := mat.current_stock;
    
    IF p_color IS NOT NULL AND p_color != '' AND mat.product_color != p_color THEN
      -- Look for sibling product with matching color (same name base or group_id)
      SELECT p.id, p.name, p.quantity INTO target_product_id, target_name, target_qty
      FROM public.products p
      WHERE p.active = true
        AND p.color = p_color
        AND (
          (mat.group_id IS NOT NULL AND p.group_id = mat.group_id AND p.name = mat.name)
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
    SELECT rm.product_id, rm.quantity_per_unit, p.quantity AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.reference_materials rm
    JOIN public.products p ON p.id = rm.product_id
    WHERE rm.reference_id = p_reference_id
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
          (mat.group_id IS NOT NULL AND p.group_id = mat.group_id AND p.name = mat.name)
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

-- Also update check_stock_availability to support color
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
      CASE WHEN p_color != '' AND rm_p.color != p_color THEN
        (SELECT p2.id FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((rm_p.group_id IS NOT NULL AND p2.group_id = rm_p.group_id AND p2.name = rm_p.name)
              OR (rm_p.group_id IS NULL AND p2.name = rm_p.name))
         LIMIT 1)
      END,
      rm.product_id
    ) AS product_id,
    COALESCE(
      CASE WHEN p_color != '' AND rm_p.color != p_color THEN
        (SELECT p2.name || ': ' || p2.color FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((rm_p.group_id IS NOT NULL AND p2.group_id = rm_p.group_id AND p2.name = rm_p.name)
              OR (rm_p.group_id IS NULL AND p2.name = rm_p.name))
         LIMIT 1)
      END,
      rm_p.name
    ) AS product_name,
    (rm.quantity_per_unit * p_order_quantity)::numeric AS required,
    COALESCE(
      CASE WHEN p_color != '' AND rm_p.color != p_color THEN
        (SELECT p2.quantity FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((rm_p.group_id IS NOT NULL AND p2.group_id = rm_p.group_id AND p2.name = rm_p.name)
              OR (rm_p.group_id IS NULL AND p2.name = rm_p.name))
         LIMIT 1)
      END,
      rm_p.quantity
    ) AS available,
    COALESCE(
      CASE WHEN p_color != '' AND rm_p.color != p_color THEN
        (SELECT p2.quantity FROM public.products p2 
         WHERE p2.active = true AND p2.color = p_color 
         AND ((rm_p.group_id IS NOT NULL AND p2.group_id = rm_p.group_id AND p2.name = rm_p.name)
              OR (rm_p.group_id IS NULL AND p2.name = rm_p.name))
         LIMIT 1)
      END,
      rm_p.quantity
    ) >= (rm.quantity_per_unit * p_order_quantity) AS sufficient
  FROM public.reference_materials rm
  JOIN public.products rm_p ON rm_p.id = rm.product_id
  WHERE rm.reference_id = p_reference_id;
END;
$function$;
