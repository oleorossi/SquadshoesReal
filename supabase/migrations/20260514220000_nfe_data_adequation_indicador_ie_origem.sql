-- ============================================================================
-- Adequação de dados pra emissão correta de NF-e (spec do emissor, seções 2.2/2.3)
-- ============================================================================
-- Mantém o GestaoClick como provedor — só adequa o MODELO DE DADOS que alimenta
-- a emissão. Antes o emit-nfe ADIVINHAVA o tipo de contribuinte do destinatário
-- pelo texto livre da Inscrição Estadual (vazio = ambíguo = bloqueia). Resultado:
-- 35 de 36 clientes com IE vazia -> emissão bloqueada; e quando não bloqueava,
-- saía "Rejeição 696 — operação com não contribuinte deve indicar consumidor
-- final". A spec resolve com campos EXPLÍCITOS.
--
--   clients.indicador_ie     — 1=Contribuinte ICMS | 2=Isento | 9=Não-contribuinte
--   clients.consumidor_final — 0=Não | 1=Sim
--   technical_sheets.origem_mercadoria — orig do item (0=Nacional ... 8)
--
-- Backfill conservador: só classifica o que é inequívoco. IE numérica -> 1.
-- IE vazia/ambígua fica NULL — o usuário classifica no cadastro (o emit-nfe
-- continua bloqueando NULL até ser preenchido).
-- ============================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS indicador_ie smallint
    CHECK (indicador_ie IN (1, 2, 9));
COMMENT ON COLUMN public.clients.indicador_ie IS
  'Indicador de IE do destinatário (NF-e tag indIEDest): 1=Contribuinte ICMS, 2=Isento de IE, 9=Não-contribuinte. NULL = não classificado (emissão bloqueada até preencher).';

UPDATE public.clients
   SET indicador_ie = 1
 WHERE indicador_ie IS NULL
   AND inscricao_estadual IS NOT NULL
   AND trim(inscricao_estadual) ~ '^\d+$';

UPDATE public.clients
   SET indicador_ie = 2
 WHERE indicador_ie IS NULL
   AND upper(trim(COALESCE(inscricao_estadual,''))) IN
       ('ISENTO','ISENTA','NAO CONTRIBUINTE','NÃO CONTRIBUINTE');

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS consumidor_final smallint
    CHECK (consumidor_final IN (0, 1));
COMMENT ON COLUMN public.clients.consumidor_final IS
  'Operação destinada a consumidor final (NF-e tag indFinal): 0=Não, 1=Sim. Contribuinte de ICMS revendendo -> 0. Não-contribuinte -> 1.';

UPDATE public.clients SET consumidor_final = 0 WHERE consumidor_final IS NULL AND indicador_ie = 1;
UPDATE public.clients SET consumidor_final = 1 WHERE consumidor_final IS NULL AND indicador_ie = 9;

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS origem_mercadoria smallint NOT NULL DEFAULT 0
    CHECK (origem_mercadoria BETWEEN 0 AND 8);
COMMENT ON COLUMN public.technical_sheets.origem_mercadoria IS
  'Origem da mercadoria (NF-e tag orig): 0=Nacional, 1=Importação direta, 2=Importação mercado interno, 3=Nacional c/ >40% importado, 4-8=demais. Default 0.';
