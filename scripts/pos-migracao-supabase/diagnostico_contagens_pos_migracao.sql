-- Contagens + auth + migrations aplicadas (DESTINO)
SELECT 'clients' AS tabela, count(*) AS n FROM public.clients
UNION ALL SELECT 'sale_orders', count(*) FROM public.sale_orders
UNION ALL SELECT 'sale_order_items', count(*) FROM public.sale_order_items
UNION ALL SELECT 'technical_sheets', count(*) FROM public.technical_sheets
UNION ALL SELECT 'orders', count(*) FROM public.orders
UNION ALL SELECT 'products', count(*) FROM public.products
UNION ALL SELECT 'profiles', count(*) FROM public.profiles
UNION ALL SELECT 'auth.users', count(*) FROM auth.users
ORDER BY 1;

-- Migrations registradas
SELECT count(*) AS migrations_aplicadas FROM supabase_migrations.schema_migrations;

-- Colunas críticas do screenshot
SELECT
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='client_number') AS has_client_number,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='sale_order_items' and column_name='production_excluded_at') AS has_production_excluded_at,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='sale_orders' and column_name='deleted_at') AS has_sale_orders_deleted_at,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='technical_sheets' and column_name='retired_at') AS has_sheets_retired_at;
