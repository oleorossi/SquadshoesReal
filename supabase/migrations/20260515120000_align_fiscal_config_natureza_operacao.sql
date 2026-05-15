-- Alinha fiscal_config.natureza_operacao com o que o emit-nfe sempre mandou
-- (e com companies.natureza_operacao da empresa primária). O emit-nfe v32
-- passa a LER a natureza do cadastro em vez de hardcoded — alinhar aqui
-- garante que o caminho de fallback (fiscal_config, quando não há company)
-- também envie a natureza correta. A tributação (CST/CSOSN/IBS/CBS) está
-- configurada no painel GestaoClick sob essa natureza — o nome precisa bater.
UPDATE public.fiscal_config
   SET natureza_operacao = 'Venda de Produção do Estabelecimento',
       updated_at = now()
 WHERE COALESCE(natureza_operacao, '') <> 'Venda de Produção do Estabelecimento';
