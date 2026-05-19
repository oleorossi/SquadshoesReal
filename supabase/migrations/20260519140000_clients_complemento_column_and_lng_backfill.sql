-- Adds `complemento` column to clients and backfills LNG cirurgicamente.
--
-- Contexto: NF-e emite `destinatario_endereco` quebrado quando o endereço
-- vem com vírgula (ex.: "Rua X, PARTE GALPAO"). O fix no emit-nfe
-- (splitAddress helper) divide automaticamente em logradouro + complemento,
-- mas o cliente LNG tinha o complemento embutido no endereço — backfill
-- separa pra evitar dependência da heurística em runtime.
--
-- Os outros ~29 clientes com vírgula no endereco continuam sendo tratados
-- pelo splitAddress no momento da emissão (eles têm número antes da vírgula,
-- então a heurística atual cobre bem).

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS complemento text;

UPDATE public.clients
SET endereco = 'Rua Maria Soares Sendas',
    complemento = 'PARTE GALPAO'
WHERE id = '79c4d333-00ef-443f-826d-fbd49cafa13c'
  AND endereco = 'Rua Maria Soares Sendas, PARTE GALPAO';
