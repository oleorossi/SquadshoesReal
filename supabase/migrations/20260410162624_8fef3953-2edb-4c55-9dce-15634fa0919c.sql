-- Create product_technical_sheets table
CREATE TABLE IF NOT EXISTS public.product_technical_sheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    material_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    consumption_per_pair NUMERIC(10,4) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS for product_technical_sheets
ALTER TABLE public.product_technical_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow full access for authenticated users to technical sheets" ON public.product_technical_sheets;
CREATE POLICY "Allow full access for authenticated users to technical sheets"
ON public.product_technical_sheets
FOR ALL
USING (auth.role() = 'authenticated');

-- Create inventory_transactions table
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('in', 'out')),
    quantity NUMERIC(10,4) NOT NULL,
    reference_id UUID,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS for inventory_transactions
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow full access for authenticated users to inventory transactions" ON public.inventory_transactions;
CREATE POLICY "Allow full access for authenticated users to inventory transactions"
ON public.inventory_transactions
FOR ALL
USING (auth.role() = 'authenticated');

-- Ensure products table has current_stock column (mapped to existing quantity if possible, or new one)
-- In this project, 'products' already has 'quantity'. Let's add a trigger or alias?
-- Better to just ensure 'current_stock' exists or use 'quantity'.
-- The user's function uses 'current_stock'. Let's add it if missing.
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'current_stock') THEN
        ALTER TABLE public.products ADD COLUMN current_stock NUMERIC(10,4) DEFAULT 0;
        -- Initialize with existing quantity if possible
        UPDATE public.products SET current_stock = COALESCE(quantity, 0);
    END IF;
END $$;

-- SQL Function to process order stock out
DROP FUNCTION IF EXISTS process_order_stock_out(p_order_id UUID, p_product_id UUID, p_quantity INT) CASCADE;
CREATE OR REPLACE FUNCTION process_order_stock_out(p_order_id UUID, p_product_id UUID, p_quantity INT)
RETURNS void AS $$
DECLARE
    component RECORD;
BEGIN
    -- 1. Percorre cada componente da Ficha Técnica (BOM) do calçado
    FOR component IN 
        SELECT material_id, consumption_per_pair 
        FROM public.product_technical_sheets 
        WHERE parent_product_id = p_product_id
    LOOP
        -- 2. Atualiza o estoque do material proporcionalmente à quantidade do pedido
        UPDATE public.products 
        SET current_stock = current_stock - (component.consumption_per_pair * p_quantity)
        WHERE id = component.material_id;

        -- 3. Registra a movimentação no histórico para auditoria
        INSERT INTO public.inventory_transactions (product_id, type, quantity, reference_id, description)
        VALUES (
            component.material_id, 
            'out', 
            (component.consumption_per_pair * p_quantity), 
            p_order_id, 
            'Baixa automática via Pedido de Venda'
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for updated_at
DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_technical_sheets
BEFORE UPDATE ON public.product_technical_sheets
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();