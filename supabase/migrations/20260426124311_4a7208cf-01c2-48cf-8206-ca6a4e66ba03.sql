-- Function to list applied migrations
CREATE OR REPLACE FUNCTION public.get_applied_migrations()
RETURNS TABLE(version text, name text, statements_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT 
    version::text,
    COALESCE(name, '')::text as name,
    COALESCE(array_length(statements, 1), 0) as statements_count
  FROM supabase_migrations.schema_migrations
  ORDER BY version DESC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.get_applied_migrations() TO authenticated;

-- Function to validate critical schema objects
CREATE OR REPLACE FUNCTION public.check_schema_objects()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_exists boolean;
BEGIN
  -- Table sole_size_conjugations
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'sole_size_conjugations'
  ) INTO v_exists;
  v_result := v_result || jsonb_build_object(
    'name', 'sole_size_conjugations',
    'type', 'table',
    'exists', v_exists,
    'description', 'Tabela de conjugação de numerações de solados'
  );

  -- Function get_sole_size_key
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_sole_size_key'
  ) INTO v_exists;
  v_result := v_result || jsonb_build_object(
    'name', 'get_sole_size_key',
    'type', 'function',
    'exists', v_exists,
    'description', 'Resolve a numeração para a chave conjugada do grupo de solado'
  );

  -- Function get_sole_group_id_for_product
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_sole_group_id_for_product'
  ) INTO v_exists;
  v_result := v_result || jsonb_build_object(
    'name', 'get_sole_group_id_for_product',
    'type', 'function',
    'exists', v_exists,
    'description', 'Retorna o group_id do solado para um produto'
  );

  -- Function debit_sole_stock_by_grade (relacionada)
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'debit_sole_stock_by_grade'
  ) INTO v_exists;
  v_result := v_result || jsonb_build_object(
    'name', 'debit_sole_stock_by_grade',
    'type', 'function',
    'exists', v_exists,
    'description', 'Debita estoque de solado agregando por chave conjugada'
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_schema_objects() TO authenticated;