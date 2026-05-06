-- Migration: Standardize sectors and clean up obsolete data
-- Setores utilizáveis: Corte, Forração, Silk, Colagem, Montagem, Acabamento, Expedição

-- 1. Remover registros de setores que não são mais utilizados das tabelas de configuração
-- Substitua 'capacidade_setores' pelo nome real da sua tabela de configuração se for diferente
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'capacidade_setores') THEN
        DELETE FROM public.capacidade_setores 
        WHERE setor NOT IN ('Corte', 'Forração', 'Silk', 'Colagem', 'Montagem', 'Acabamento', 'Expedição');
    END IF;
END $$;

-- 2. Garantir que os setores padrão existam na tabela de capacidade (opcional, dependendo da lógica do app)
-- INSERT INTO public.capacidade_setores (setor, capacidade_diaria, lead_time_fixo)
-- VALUES 
-- ('Corte', 0, 0),
-- ('Forração', 0, 0),
-- ('Silk', 0, 0),
-- ('Colagem', 0, 0),
-- ('Montagem', 0, 0),
-- ('Acabamento', 0, 0),
-- ('Expedição', 0, 0)
-- ON CONFLICT (setor) DO NOTHING;
