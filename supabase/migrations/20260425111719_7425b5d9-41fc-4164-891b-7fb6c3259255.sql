-- Fix function search_path (Security Warning 1)
-- Identificar funções sem search_path e aplicar public
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;

-- Adicionar índices para otimizar carregamento (Performance)
CREATE INDEX IF NOT EXISTS idx_products_quantity ON public.products(quantity);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(active);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_sale_orders_status ON public.sale_orders(status);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON public.user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);

-- Verificar e garantir RLS nas tabelas principais
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- Nota: Os avisos de buckets públicos de listagem devem ser corrigidos via políticas de storage, 
-- mas aqui focamos em DB.
