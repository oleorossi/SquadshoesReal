CREATE OR REPLACE FUNCTION get_inventory_summary()
RETURNS json AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'totalValue', COALESCE(SUM(current_stock * unit_price), 0),
        'activeItems', COUNT(*),
        'lowStockCount', COUNT(*) FILTER (WHERE current_stock <= min_stock)
    ) INTO result
    FROM products
    WHERE status = 'active';
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;