-- Add silk_url to clients (individual client silk)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS silk_url text;

-- Add silk_url to product_groups (so a sole group can hold its default silk)
ALTER TABLE public.product_groups ADD COLUMN IF NOT EXISTS silk_url text;

COMMENT ON COLUMN public.clients.silk_url IS 'Silk personalizada do cliente. Sobrepõe o silk do grupo econômico e do solado.';
COMMENT ON COLUMN public.product_groups.silk_url IS 'Silk padrão associada ao grupo (usada para grupos do tipo Solado). Fallback quando o cliente/grupo não possui silk.';