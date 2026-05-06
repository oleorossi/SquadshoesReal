-- 20260508150000_nfe-emission-idempotency.sql
-- Adiciona coluna de chave de idempotência para evitar emissões duplicadas
ALTER TABLE public.nfe_emitidas 
ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

-- 20260508160000_material-variant-colors.sql
-- Cria tabela para gerenciar grupos de cores de materiais (necessário para feature Grupos de Material)
CREATE TABLE IF NOT EXISTS public.material_color_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Adiciona referência ao grupo de cor na tabela de produtos/materiais
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS material_color_group_id UUID REFERENCES public.material_color_groups(id);

-- Habilita RLS para a nova tabela
ALTER TABLE public.material_color_groups ENABLE ROW LEVEL SECURITY;

-- Cria políticas de visualização e edição
DROP POLICY IF EXISTS "Leitura pública para grupos de cores" ON public.material_color_groups;
CREATE POLICY "Leitura pública para grupos de cores" 
ON public.material_color_groups FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Apenas administradores podem gerenciar grupos de cores" ON public.material_color_groups;
CREATE POLICY "Apenas administradores podem gerenciar grupos de cores" 
ON public.material_color_groups FOR ALL 
USING (auth.jwt() ->> 'role' = 'admin' OR auth.jwt() ->> 'role' = 'service_role');

-- Trigger para atualização automática de timestamp
CREATE TRIGGER tr_update_material_color_groups_updated_at
BEFORE UPDATE ON public.material_color_groups
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
