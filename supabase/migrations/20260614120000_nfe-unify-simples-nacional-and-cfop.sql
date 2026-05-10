-- =============================================================================
-- Unificação NF-e parte 1: regime tributário Simples Nacional + CFOPs por
-- tipo de operação (decisões A e B confirmadas pelo usuário)
-- =============================================================================
-- Squad Shoes é INDÚSTRIA (calçado) com regime Simples Nacional.
-- Mudanças:
--   1. Adiciona 'simples_nacional' como valor válido em pis_cofins_regime
--      (antes só aceitava cumulativo|nao_cumulativo do regime normal).
--   2. Adiciona 4 colunas pra CFOPs explícitos por operação:
--        cfop_industrial_interno (5101 — produção própria, mesma UF)
--        cfop_industrial_externo (6101 — produção própria, interestadual)
--        cfop_revenda_interno    (5102 — revenda mercadoria, mesma UF)
--        cfop_revenda_externo    (6102 — revenda mercadoria, interestadual)
--      A coluna `cfop` legacy fica como fallback. Na emissão da NF-e, o
--      sistema escolhe o CFOP correto baseado em (origem indústria vs
--      revenda) × (mesma UF vs outra UF).
-- =============================================================================

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_pis_cofins_regime_check;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_pis_cofins_regime_check
    CHECK (pis_cofins_regime = ANY (ARRAY['cumulativo', 'nao_cumulativo', 'simples_nacional']));

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS cfop_industrial_interno text DEFAULT '5101',
  ADD COLUMN IF NOT EXISTS cfop_industrial_externo text DEFAULT '6101',
  ADD COLUMN IF NOT EXISTS cfop_revenda_interno    text DEFAULT '5102',
  ADD COLUMN IF NOT EXISTS cfop_revenda_externo    text DEFAULT '6102';

COMMENT ON COLUMN public.companies.cfop_industrial_interno IS
  'CFOP venda produção própria dentro UF (default 5101). Squad Shoes é indústria.';
COMMENT ON COLUMN public.companies.cfop_industrial_externo IS
  'CFOP venda produção própria interestadual (default 6101).';
COMMENT ON COLUMN public.companies.cfop_revenda_interno IS
  'CFOP venda revenda dentro UF (default 5102).';
COMMENT ON COLUMN public.companies.cfop_revenda_externo IS
  'CFOP venda revenda interestadual (default 6102).';

UPDATE public.companies
   SET pis_cofins_regime = 'simples_nacional',
       updated_at        = now()
 WHERE regime_tributario = '1'
   AND COALESCE(pis_cofins_regime, '') != 'simples_nacional';

UPDATE public.companies
   SET cfop_revenda_interno = COALESCE(NULLIF(cfop, ''), '5102')
 WHERE cfop_revenda_interno IS NULL OR cfop_revenda_interno = '';
