-- =============================================================================
-- SETUP FISCAL — Squad Shoes Indústria e Comércio (Belford Roxo / RJ)
-- =============================================================================
-- Dados fornecidos pelo usuário em 2026-05-07:
--   Razão Social:  Squad Shoes Indústria e Comércio
--   CNPJ:          62.406.033/0001-93
--   IE:            15.745.436
--   Endereço:      R PADRE EGIDIO CAMARLYNCK, 134 Galpão
--   Bairro:        LOTE XV
--   CEP:           26.183-380
--   Cidade:        Belford Roxo
--   UF:            RJ
--   IBGE:          3300456 (município Belford Roxo)
--   Regime:        Simples Nacional (1)
--   Ambiente:      Homologação (testar antes de produção)
--   Apenas NF-e (não emite NFS-e)
-- =============================================================================

-- #1 Atualiza fiscal_config (legacy fallback do emit-nfe)
UPDATE public.fiscal_config SET
  cnpj                 = '62406033000193',
  inscricao_estadual   = '15745436',
  razao_social         = 'Squad Shoes Indústria e Comércio',
  nome_fantasia        = 'Squad Shoes',
  logradouro           = 'R PADRE EGIDIO CAMARLYNCK',
  numero               = '134',
  complemento          = 'Galpão',
  bairro               = 'LOTE XV',
  cidade               = 'Belford Roxo',
  uf                   = 'RJ',
  cep                  = '26183380',
  codigo_municipio     = '3300456',
  regime_tributario    = '1',
  serie_nfe            = 1,
  ambiente             = 'homologacao',
  natureza_operacao    = 'Venda de Mercadoria',
  cfop                 = '5102',
  updated_at           = now();

-- #2 Migra para companies (multi-CNPJ moderno) e marca como primary única
UPDATE public.companies SET is_primary = false WHERE is_primary = true;

DO $$
DECLARE v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM public.companies WHERE cnpj = '62406033000193' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    UPDATE public.companies SET
      razao_social = 'Squad Shoes Indústria e Comércio',
      nome_fantasia = 'Squad Shoes',
      logradouro = 'R PADRE EGIDIO CAMARLYNCK', numero = '134', complemento = 'Galpão',
      bairro = 'LOTE XV', cidade = 'Belford Roxo', uf = 'RJ', cep = '26183380',
      codigo_municipio = '3300456', regime_tributario = '1', serie_nfe = 1,
      ambiente = 'homologacao', natureza_operacao = 'Venda de Mercadoria',
      cfop = '5102', is_primary = true, active = true,
      inscricao_estadual = '15745436',
      updated_at = now()
    WHERE id = v_existing;
  ELSE
    INSERT INTO public.companies (
      cnpj, inscricao_estadual, razao_social, nome_fantasia,
      logradouro, numero, complemento, bairro, cidade, uf, cep,
      codigo_municipio, regime_tributario, serie_nfe, ambiente,
      natureza_operacao, cfop, is_primary, active
    ) VALUES (
      '62406033000193', '15745436',
      'Squad Shoes Indústria e Comércio', 'Squad Shoes',
      'R PADRE EGIDIO CAMARLYNCK', '134', 'Galpão',
      'LOTE XV', 'Belford Roxo', 'RJ', '26183380',
      '3300456', '1', 1, 'homologacao',
      'Venda de Mercadoria', '5102', true, true
    );
  END IF;
END $$;

-- #3 NCM em todas as 22 fichas técnicas
-- Mapeamento por categoria/código (calçado feminino brasileiro):
--   Sandália adulta (ST*, EC60) → 6402.20.00 (sandália plástico c/ correia)
--   Rasteirinha/sapatilha (SP*, TR*) → 6404.19.00 (sola sint. + cabedal têxtil)
--   Infantil + outros → 6404.11.00 (DEFAULT solicitado pelo user)
-- Resultado: 10×64041100 + 6×64022000 + 6×64041900 = 22

UPDATE public.technical_sheets SET ncm = '64022000', updated_at = now()
WHERE (ncm IS NULL OR ncm = '')
  AND (LOWER(COALESCE(shoe_category,'')) LIKE '%sandali%' OR code LIKE 'ST%' OR code LIKE 'EC%');

UPDATE public.technical_sheets SET ncm = '64041900', updated_at = now()
WHERE (ncm IS NULL OR ncm = '')
  AND (LOWER(COALESCE(shoe_category,'')) LIKE '%rasteir%' OR code LIKE 'SP%' OR code LIKE 'TR%');

UPDATE public.technical_sheets SET ncm = '64041100', updated_at = now()
WHERE ncm IS NULL OR ncm = '';
