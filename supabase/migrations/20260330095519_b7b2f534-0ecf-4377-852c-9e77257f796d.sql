-- Create tables for Footwear Production Management

-- 1. PRODUTO MESTRE (O Modelo/Design)
CREATE TABLE public.product_masters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL, -- Ex: "Sandália Salto Bloco 2026"
    description TEXT,
    category VARCHAR(50),
    main_image_url TEXT, -- Foto principal para fallback
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. VARIANTES (Cores e SKUs específicos)
CREATE TABLE public.product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id UUID REFERENCES public.product_masters(id) ON DELETE CASCADE,
    sku VARCHAR(100) UNIQUE NOT NULL,
    color_name VARCHAR(50), -- Ex: "Caramelo"
    color_hex VARCHAR(7),    -- Ex: "#8B5A2B"
    size VARCHAR(10),        -- Grade: 35, 36, 37...
    variant_image_url TEXT,  -- Foto específica da cor (se houver)
    unit_price DECIMAL(10,4),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. MATERIAIS E INSUMOS (O que tem no almoxarifado)
CREATE TABLE public.materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50), -- Couro, Solado, Cola, Metais
    stock_actual DECIMAL(12,4) DEFAULT 0, -- Estoque físico real
    stock_min DECIMAL(12,4) DEFAULT 100,  -- Ponto de pedido
    lead_time_days INTEGER DEFAULT 5,     -- Dias que o fornecedor leva pra entregar
    unit_measure VARCHAR(10), -- dm2, par, kg
    default_supplier_id UUID,
    last_price DECIMAL(10,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. FICHA TÉCNICA (BOM - Bill of Materials)
CREATE TABLE public.bill_of_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id UUID REFERENCES public.product_masters(id) ON DELETE CASCADE,
    material_id UUID REFERENCES public.materials(id) ON DELETE CASCADE,
    quantity_required DECIMAL(12,4) NOT NULL, -- Consumo por par (ex: 12.5000 dm2)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. ORDENS DE PRODUÇÃO (O coração do Monitor de Fluxo)
CREATE TABLE public.production_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'Aguardando', -- 'Aguardando', 'Corte', 'Preparação', 'Montagem', 'Finalizado'
    due_date DATE NOT NULL,      -- Data de entrega para o cliente
    scheduled_date DATE,         -- Data programada para início
    current_sector VARCHAR(50) DEFAULT 'Corte',
    is_priority BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.product_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_of_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;

-- Simple RLS Policies (allowing authenticated users)
CREATE POLICY "Allow authenticated access to product_masters" ON public.product_masters FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated access to product_variants" ON public.product_variants FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated access to materials" ON public.materials FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated access to bill_of_materials" ON public.bill_of_materials FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated access to production_orders" ON public.production_orders FOR ALL USING (auth.role() = 'authenticated');

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_production_orders_updated_at
    BEFORE UPDATE ON public.production_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
