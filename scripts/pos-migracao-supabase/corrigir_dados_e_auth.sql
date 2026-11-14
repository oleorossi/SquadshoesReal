-- Rode no SQL Editor do projeto DESTINO (cknbzfqvqwqdhajspazn)
-- para distinguir "banco vazio" de "RLS escondendo dados".
-- Este script é SOMENTE LEITURA.

-- 1) Contagens reais (bypass RLS via SQL Editor / role postgres)
SELECT 'clients' AS tabela, count(*) AS n FROM public.clients
UNION ALL SELECT 'sale_orders', count(*) FROM public.sale_orders
UNION ALL SELECT 'sale_order_items', count(*) FROM public.sale_order_items
UNION ALL SELECT 'technical_sheets', count(*) FROM public.technical_sheets
UNION ALL SELECT 'orders', count(*) FROM public.orders
UNION ALL SELECT 'products', count(*) FROM public.products
UNION ALL SELECT 'profiles', count(*) FROM public.profiles
UNION ALL SELECT 'user_roles', count(*) FROM public.user_roles
UNION ALL SELECT 'auth.users', count(*) FROM auth.users
ORDER BY 1;

-- 2) Colunas críticas da tela de Pedidos
SELECT
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='client_number') AS has_client_number,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='sale_order_items' and column_name='production_excluded_at') AS has_production_excluded_at,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='sale_orders' and column_name='deleted_at') AS has_deleted_at;

-- 3) Interpretação
-- - Se counts > 0 aqui e app ainda vazio: Auth/usuários/RLS (migrar auth.users + profiles/roles).
-- - Se counts = 0: a transferência trouxe schema sem dados — precisa re-importar dump/data.
