-- Adicionar coluna para rastrear substituição manual de endereço
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS address_manual_override BOOLEAN DEFAULT false;

-- Comentário para documentação
COMMENT ON COLUMN public.clients.address_manual_override IS 'Indica se o endereço foi editado manualmente pelo usuário, para evitar sobrescritas por buscas automáticas de CEP.';