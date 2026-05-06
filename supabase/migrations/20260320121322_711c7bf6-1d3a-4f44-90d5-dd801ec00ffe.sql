
DROP FUNCTION IF EXISTS public.log_product_audit() CASCADE;
CREATE OR REPLACE FUNCTION public.log_product_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_changes jsonb := '{}';
BEGIN
  SELECT auth.uid() INTO v_user_id;
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO material_audit_log (product_id, product_name, product_sku, action, new_stock, user_id, user_email)
    VALUES (NEW.id, NEW.name, NEW.sku, 'created', NEW.quantity, v_user_id, v_user_email);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.name IS DISTINCT FROM NEW.name THEN v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name)); END IF;
    IF OLD.quantity IS DISTINCT FROM NEW.quantity THEN v_changes := v_changes || jsonb_build_object('quantity', jsonb_build_object('old', OLD.quantity, 'new', NEW.quantity)); END IF;
    IF OLD.unit_price IS DISTINCT FROM NEW.unit_price THEN v_changes := v_changes || jsonb_build_object('unit_price', jsonb_build_object('old', OLD.unit_price, 'new', NEW.unit_price)); END IF;
    IF OLD.category IS DISTINCT FROM NEW.category THEN v_changes := v_changes || jsonb_build_object('category', jsonb_build_object('old', OLD.category, 'new', NEW.category)); END IF;
    IF OLD.color IS DISTINCT FROM NEW.color THEN v_changes := v_changes || jsonb_build_object('color', jsonb_build_object('old', OLD.color, 'new', NEW.color)); END IF;
    IF OLD.min_stock IS DISTINCT FROM NEW.min_stock THEN v_changes := v_changes || jsonb_build_object('min_stock', jsonb_build_object('old', OLD.min_stock, 'new', NEW.min_stock)); END IF;
    IF OLD.active IS DISTINCT FROM NEW.active THEN v_changes := v_changes || jsonb_build_object('active', jsonb_build_object('old', OLD.active, 'new', NEW.active)); END IF;

    IF v_changes != '{}' THEN
      INSERT INTO material_audit_log (product_id, product_name, product_sku, action, changes, quantity_change, previous_stock, new_stock, user_id, user_email)
      VALUES (NEW.id, NEW.name, NEW.sku, 'updated', v_changes, NEW.quantity - OLD.quantity, OLD.quantity, NEW.quantity, v_user_id, v_user_email);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO material_audit_log (product_id, product_name, product_sku, action, previous_stock, user_id, user_email)
    VALUES (NULL, OLD.name, OLD.sku, 'deleted', OLD.quantity, v_user_id, v_user_email);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;
