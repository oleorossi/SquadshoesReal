-- =============================================================================
-- SOLAGEM NÃO TEM PAR DIFÍCIL — sector_settings.pays_by_difficulty
--
-- DECISÃO DO DONO (07/08/2026). O par difícil existe só na Montagem. Na Solagem
-- todo par vale a mesma taxa, e o campo "R$/par difícil" do solador nunca foi
-- preenchido — o Antonio Gordinho, único solador, está com valor_par_dificil
-- NULL desde o cadastro.
--
-- O RISCO QUE ISTO FECHA. Hoje nada impede lançar um par difícil para ele. Se
-- alguém lançasse, `ficha_valor` valoraria esse par a coalesce(NULL,0) = R$ 0,00
-- e a folha pagaria a menos EM SILÊNCIO: sem erro, sem aviso, sem linha
-- vermelha. Em 50 lançamentos ninguém usou difícil em nenhum dos dois setores,
-- então isto é bomba com pino — não bug ativo. Estamos tirando o pino.
--
-- POR QUE FLAG DE SETOR, E NÃO 'solagem' NO CÓDIGO. Mesma razão que criou o
-- pays_by_pair (migration 20260930120400): a Ficha roda a MESMA dinâmica nos 11
-- setores, e qualquer um pode passar a ter (ou deixar de ter) dificuldade. O dia
-- em que a Solagem quiser difícil deve ser um clique, não um deploy. Esta coluna
-- mora ao lado do pays_by_pair de propósito — são o mesmo tipo de fato sobre o
-- setor.
--
-- DEFAULT true: o comportamento de hoje (Montagem com difícil) é o normal; a
-- ausência de dificuldade é a exceção que se declara.
-- =============================================================================

ALTER TABLE public.sector_settings
  ADD COLUMN IF NOT EXISTS pays_by_difficulty boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.sector_settings.pays_by_difficulty IS
  'Setor separa os pares em médio/difícil, com R$/par diferente por dificuldade. '
  'false = taxa única (só o R$/par médio vale). Dirige a coluna Difícil da Ficha '
  'de Montadores e o campo R$/par difícil no cadastro de Funcionários. Só faz '
  'sentido quando pays_by_pair = true.';

-- Estado atual da fábrica: Montagem tem difícil, Solagem não.
UPDATE public.sector_settings
   SET pays_by_difficulty = false
 WHERE public.capacity_sector_key(sector) = 'solagem';

-- Expõe no contrato que o frontend já consome (useSectorRoster → v_production_sectors).
CREATE OR REPLACE VIEW public.v_production_sectors
WITH (security_invoker = on) AS
SELECT public.capacity_sector_key(ss.sector) AS sector_key,
       ss.sector                             AS sector_label,
       ss.flow_order,
       ss.headcount,
       ss.pays_by_pair,
       ss.pays_by_difficulty
  FROM public.sector_settings ss;

COMMENT ON VIEW public.v_production_sectors IS
  'Setores de produção oficiais (sector_settings) com a chave canônica já '
  'resolvida por capacity_sector_key, mais as marcas de quem paga por par e de '
  'quem separa por dificuldade. Fonte das abas da Ficha de Montadores e do '
  'formulário de Funcionários.';

REVOKE ALL ON public.v_production_sectors FROM anon;
GRANT SELECT ON public.v_production_sectors TO authenticated;
