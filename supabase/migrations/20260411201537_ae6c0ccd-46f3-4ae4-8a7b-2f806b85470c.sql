
-- 1. Fix Security Definer Views → Security Invoker
ALTER VIEW public.purchase_projection_timeline SET (security_invoker = true);
ALTER VIEW public.report_material_needs_by_group SET (security_invoker = true);

-- 2. Fix functions missing search_path

CREATE OR REPLACE FUNCTION public.convert_reservation_to_out(p_order_id uuid, p_product_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT product_id, quantity_reserved as quantity, id 
        FROM public.material_reservations
        WHERE order_id = p_order_id
          AND (p_product_id IS NULL OR product_id = p_product_id)
          AND status = 'reserved'
        FOR UPDATE
    LOOP
        UPDATE public.products
        SET quantity = quantity - r.quantity,
            reserved_stock = COALESCE(reserved_stock, 0) - r.quantity
        WHERE id = r.product_id;

        UPDATE public.material_reservations
        SET status = 'converted',
            updated_at = now()
        WHERE id = r.id;
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_production_sector(p_order_id uuid, p_current_sector text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_next_sector TEXT;
  v_next_status TEXT;
  v_result JSONB;
BEGIN
  CASE p_current_sector
    WHEN 'Corte' THEN v_next_sector := 'Aviamento';
    WHEN 'Aviamento' THEN v_next_sector := 'Solagem';
    WHEN 'Solagem' THEN v_next_sector := 'Acabamento';
    WHEN 'Acabamento' THEN v_next_sector := 'Pronto';
    ELSE 
      v_next_sector := NULL;
  END CASE;

  UPDATE public.order_stages
  SET 
    status = 'concluido',
    completed_at = NOW(),
    updated_at = NOW()
  WHERE order_id = p_order_id 
    AND stage_name = p_current_sector
    AND status != 'concluido';

  IF v_next_sector IS NOT NULL THEN
    v_next_status := CASE 
      WHEN v_next_sector = 'Pronto' THEN 'Pronto'
      ELSE 'EM_' || UPPER(v_next_sector)
    END;
    
    UPDATE public.orders
    SET 
      status = v_next_status,
      production_step = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    UPDATE public.production_orders
    SET 
      status = v_next_status,
      current_sector = v_next_sector,
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    INSERT INTO public.notifications (sector, message)
    VALUES (v_next_sector, 'Nova carga de trabalho disponível: OP #' || p_order_id);

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', v_next_sector,
      'status', v_next_status
    );
  ELSE
    UPDATE public.orders
    SET 
      status = 'FINALIZADO',
      production_step = 'Pronto',
      last_sector_finished_at = NOW(),
      updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'next_sector', NULL,
      'status', 'FINALIZADO'
    );
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_order_material_status(p_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
DECLARE
    v_missing_count INT;
    v_order_quantity INT;
    v_reference_id UUID;
    v_sole_group_id UUID;
BEGIN
    SELECT quantity, reference_id INTO v_order_quantity, v_reference_id
    FROM public.orders
    WHERE id = p_order_id;

    SELECT sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets
    WHERE id = v_reference_id;

    SELECT COUNT(*) INTO v_missing_count
    FROM public.bill_of_materials bom
    JOIN public.products m ON m.id = bom.material_id
    WHERE bom.master_id = v_reference_id
    AND (
        m.current_stock < (bom.quantity_required * v_order_quantity)
        OR
        EXISTS (
            SELECT 1 
            FROM public.sole_technical_specs specs 
            WHERE specs.sole_id = v_sole_group_id
            AND m.current_stock < (specs.consumption * v_order_quantity)
        )
    );

    IF v_missing_count > 0 THEN
        RETURN 'INSUFICIENTE';
    ELSE
        RETURN 'LIBERADO';
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_order_stages_with_kanban()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.production_step IS NOT DISTINCT FROM NEW.production_step) THEN
    RETURN NEW;
  END IF;

  IF NEW.production_step IS NOT NULL AND NEW.production_step != 'Pendente' THEN
    UPDATE public.order_stages
    SET status = 'concluido', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
    WHERE order_id = NEW.id
      AND stage_order < (
        SELECT COALESCE(MIN(stage_order), 999) 
        FROM public.order_stages 
        WHERE order_id = NEW.id AND stage_name = NEW.production_step
      )
      AND status != 'concluido';
      
    UPDATE public.order_stages
    SET status = 'em_andamento', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
    WHERE order_id = NEW.id
      AND stage_name = NEW.production_step
      AND status = 'pendente';
  END IF;

  IF NEW.production_step = 'Pronto' THEN
    UPDATE public.order_stages
    SET status = 'concluido', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
    WHERE order_id = NEW.id
      AND status != 'concluido';
      
    NEW.status := 'Pronto';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_order_material_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    NEW.material_status = public.get_order_material_status(NEW.id);
    RETURN NEW;
END;
$function$;

-- 3. Fix RLS always-true on sole_structures
DROP POLICY IF EXISTS "Allow authenticated users to insert sole structures" ON public.sole_structures;
DROP POLICY IF EXISTS "Allow authenticated users to update sole structures" ON public.sole_structures;
DROP POLICY IF EXISTS "Allow authenticated users to delete sole structures" ON public.sole_structures;

CREATE POLICY "Approved users can insert sole structures"
  ON public.sole_structures FOR INSERT TO authenticated
  WITH CHECK (is_approved_user());

CREATE POLICY "Approved users can update sole structures"
  ON public.sole_structures FOR UPDATE TO authenticated
  USING (is_approved_user());

CREATE POLICY "Approved users can delete sole structures"
  ON public.sole_structures FOR DELETE TO authenticated
  USING (is_approved_user());

-- 4. Fix packaging_types public read access
DROP POLICY IF EXISTS "Everyone can view active packaging types" ON public.packaging_types;
DROP POLICY IF EXISTS "Authenticated users can manage packaging types" ON public.packaging_types;

CREATE POLICY "Approved users can view active packaging types"
  ON public.packaging_types FOR SELECT TO authenticated
  USING (is_active = true AND is_approved_user());

CREATE POLICY "Approved users can manage packaging types"
  ON public.packaging_types FOR ALL TO authenticated
  USING (is_approved_user())
  WITH CHECK (is_approved_user());
