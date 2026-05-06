-- Cria a função para obter o status dos materiais de uma ordem
CREATE OR REPLACE FUNCTION public.get_order_material_status(p_order_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_missing_count INT;
    v_order_quantity INT;
    v_reference_id UUID;
    v_sole_group_id UUID;
BEGIN
    -- Obtém detalhes da ordem
    SELECT quantity, reference_id INTO v_order_quantity, v_reference_id
    FROM public.orders
    WHERE id = p_order_id;

    -- Obtém o grupo de solado da ficha técnica
    SELECT sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets
    WHERE id = v_reference_id;

    -- Conta quantos materiais do BOM estão com estoque insuficiente
    -- Consideramos a quantidade necessária (BOM quantity_required * order quantity)
    -- E também verificamos se há especificação de consumo no sole_technical_specs
    SELECT COUNT(*) INTO v_missing_count
    FROM public.bill_of_materials bom
    JOIN public.products m ON m.id = bom.material_id
    WHERE bom.master_id = v_reference_id
    AND (
        -- Estoque atual menor que o necessário total (quantity_required * order_quantity)
        m.current_stock < (bom.quantity_required * v_order_quantity)
        OR
        -- Ou se houver uma especificação no sole_technical_specs que não seja atendida
        EXISTS (
            SELECT 1 
            FROM public.sole_technical_specs specs 
            WHERE specs.sole_id = v_sole_group_id
            AND m.current_stock < (specs.consumption * v_order_quantity)
        )
    );

    IF v_missing_count > 0 THEN
        RETURN 'INSUFICIENTE';
    ELSE
        RETURN 'LIBERADO';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Adiciona a coluna material_status na tabela orders se ela não existir
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'material_status') THEN
        ALTER TABLE public.orders ADD COLUMN material_status TEXT DEFAULT 'LIBERADO';
    END IF;
END $$;

-- Função para atualizar o material_status
CREATE OR REPLACE FUNCTION public.update_order_material_status()
RETURNS TRIGGER AS $$
BEGIN
    NEW.material_status = public.get_order_material_status(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar automaticamente o status
DROP TRIGGER IF EXISTS tr_update_order_material_status ON public.orders;
CREATE TRIGGER tr_update_order_material_status
BEFORE INSERT OR UPDATE OF quantity, reference_id ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.update_order_material_status();

-- Atualiza os registros existentes
UPDATE public.orders SET updated_at = now();
