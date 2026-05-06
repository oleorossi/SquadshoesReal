-- Função para retornar o resumo do estoque sem baixar todas as linhas
CREATE OR REPLACE FUNCTION get_inventory_summary()
RETURNS json AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'totalValue', COALESCE(SUM(quantity * unit_price), 0),
        'activeItems', COUNT(*),
        'lowStockCount', COUNT(*) FILTER (WHERE quantity <= min_stock)
    ) INTO result
    FROM products
    WHERE active = true;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_inventory_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION get_inventory_summary() TO service_role;