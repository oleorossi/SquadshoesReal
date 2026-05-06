-- 20260507160000_atomic-purchase-order-item-upsert.sql
DROP FUNCTION IF EXISTS public.upsert_purchase_order_items_atomic(
    p_order_id UUID,
    p_items JSONB
) CASCADE;
CREATE OR REPLACE FUNCTION public.upsert_purchase_order_items_atomic(
    p_order_id UUID,
    p_items JSONB
) RETURNS void AS $$
BEGIN
    DELETE FROM public.purchase_order_items WHERE purchase_order_id = p_order_id;
    INSERT INTO public.purchase_order_items (purchase_order_id, product_id, quantity, unit_price)
    SELECT p_order_id, (item->>'product_id')::UUID, (item->>'quantity')::NUMERIC, (item->>'unit_price')::NUMERIC
    FROM jsonb_array_elements(p_items) AS item;
END;
$$ LANGUAGE plpgsql;

-- 20260507170000_audit2-critical-fixes.sql
DROP FUNCTION IF EXISTS public.fn_audit_log_cleanup() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_audit_log_cleanup() RETURNS void AS $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'audit_logs' AND table_schema = 'public') THEN
        EXECUTE 'DELETE FROM public.audit_logs WHERE created_at < now() - interval ''90 days''';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 20260507190000_fix-resync-trigger-duplicate-status.sql
DROP FUNCTION IF EXISTS public.fn_sync_production_status() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_sync_production_status()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status) THEN
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
