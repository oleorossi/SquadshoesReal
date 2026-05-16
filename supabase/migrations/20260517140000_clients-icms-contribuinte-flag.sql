-- Adiciona campo explícito de "contribuinte de ICMS" no cadastro de cliente.
--
-- Hoje a NF-e infere o status de contribuição do cliente a partir do
-- campo `inscricao_estadual`:
--   - dígitos numéricos → contribuinte de ICMS (tipo_contribuinte=1)
--   - "ISENTO"/"ISENTA"/"NAO CONTRIBUINTE" → isento (tipo_contribuinte=2)
--   - vazio → bloqueia emissão (validação no emit-nfe)
--
-- Solicitação Squad Shoes (16/05/2026): permitir marcar explicitamente
-- no cadastro do cliente se ele é optante de ICMS ou não. Motivação:
--  - Evita ambiguidade quando IE é vazia/inválida
--  - UI mais clara pro operador no cadastro
--  - emit-nfe passa a priorizar a flag se preenchida (true/false),
--    caindo no fallback da IE só quando icms_contribuinte for NULL
--
-- 3 estados:
--   true  → contribuinte de ICMS (precisa IE numérica)
--   false → isento / não contribuinte (IE pode ser "ISENTO")
--   null  → não definido (legacy / cliente antigo — usa fallback IE)

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS icms_contribuinte boolean;

COMMENT ON COLUMN public.clients.icms_contribuinte IS
  'Flag explícita de contribuição de ICMS pro cadastro. true=contribuinte (precisa IE numérica), false=isento/não contribuinte (IE pode ser "ISENTO"), NULL=não definido (emit-nfe cai no fallback de inferir do campo inscricao_estadual).';

-- Backfill: deriva da IE atual pra manter coerência com comportamento legado.
-- IE vazia ou NULL fica NULL (não força um valor padrão — operador define
-- conscientemente na próxima edição).
UPDATE public.clients
   SET icms_contribuinte = CASE
         WHEN UPPER(TRIM(COALESCE(inscricao_estadual, ''))) IN ('ISENTO', 'ISENTA', 'NAO CONTRIBUINTE', 'NÃO CONTRIBUINTE') THEN false
         WHEN regexp_replace(COALESCE(inscricao_estadual, ''), '\D', '', 'g') ~ '^\d{6,}$' THEN true
         ELSE NULL
       END
 WHERE icms_contribuinte IS NULL;
