-- Atualizando a documentação das colunas para refletir a nova regra de negócio
COMMENT ON COLUMN public.materials.lead_time_days IS 'Prazo de entrega do material. Prioridade: 1. Fornecedor (se > 0), 2. Este campo (se > 0), 3. Default de 10 dias.';

-- Se houver uma tabela de fornecedores, podemos comentar lá também para clareza
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'suppliers' AND table_schema = 'public') THEN
        COMMENT ON COLUMN public.suppliers.lead_time_days IS 'Prazo de entrega do fornecedor. Tem prioridade máxima no cálculo de disponibilidade.';
    END IF;
END $$;
