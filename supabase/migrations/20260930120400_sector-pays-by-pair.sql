-- =============================================================================
-- sector_settings.pays_by_pair — quais setores pagam POR PAR
--
-- No cadastro de Funcionários, os campos de R$/par só apareciam quando o regime
-- já estava em 'producao'. Ou seja: quem cadastrava um montador precisava
-- LEMBRAR de trocar o regime antes — e, esquecendo, salvava um montador
-- mensalista com campos de hora extra e nenhum R$/par. Foi assim que os 3
-- montadores existentes ficaram com R$/par 0,00 em 33 lançamentos.
--
-- Agora o SETOR carrega essa informação: escolher um setor que paga por par já
-- coloca o funcionário no regime certo e troca hora extra por R$/par no
-- formulário.
--
-- POR QUE FLAG NO BANCO, E NÃO "montagem ou solagem" NO CÓDIGO. A Ficha de
-- Montadores roda a MESMA dinâmica nos 11 setores — qualquer um pode passar a
-- pagar por par. Solagem acabou de entrar; o próximo deve ser um clique, não um
-- deploy. Fixar dois nomes no TS também reintroduziria a adivinhação por texto
-- que a v_employee_sector acabou de eliminar.
-- =============================================================================

ALTER TABLE public.sector_settings
  ADD COLUMN IF NOT EXISTS pays_by_pair boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sector_settings.pays_by_pair IS
  'Setor remunerado por PAR produzido (Ficha de Montadores) em vez de salário + '
  'hora extra. Dirige o formulário de Funcionários: seleciona o regime '
  'payment_type=''producao'' e troca os campos de HE pelos de R$/par.';

-- Estado atual da fábrica: Montagem e Solagem pagam por par.
UPDATE public.sector_settings
   SET pays_by_pair = true
 WHERE public.capacity_sector_key(sector) IN ('montagem', 'solagem');

-- Expõe no contrato que o frontend já consome.
CREATE OR REPLACE VIEW public.v_production_sectors
WITH (security_invoker = on) AS
SELECT public.capacity_sector_key(ss.sector) AS sector_key,
       ss.sector                             AS sector_label,
       ss.flow_order,
       ss.headcount,
       ss.pays_by_pair
  FROM public.sector_settings ss;

COMMENT ON VIEW public.v_production_sectors IS
  'Setores de produção oficiais (sector_settings) com a chave canônica já '
  'resolvida por capacity_sector_key, mais a marca de quem paga por par. '
  'Fonte das abas da Ficha de Montadores e do formulário de Funcionários.';

REVOKE ALL ON public.v_production_sectors FROM anon;
GRANT SELECT ON public.v_production_sectors TO authenticated;
