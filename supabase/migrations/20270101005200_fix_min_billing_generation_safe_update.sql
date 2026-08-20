-- Corrige o bloqueio ao salvar rota, capacidades e lead times de uma ficha.
--
-- `pg_safeupdate` rejeita UPDATE sem predicado, inclusive dentro de trigger.
-- A tabela min_billing_cache_meta e singleton por construcao: a PK booleana
-- possui CHECK (id), logo a unica linha valida e id = true. O WHERE explicito
-- preserva a invalidacao global e torna a funcao compativel com a protecao.

CREATE OR REPLACE FUNCTION public.tg_min_billing_bump_generation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.min_billing_cache_meta
     SET generation = generation + 1,
         updated_at = now()
   WHERE id = true;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.tg_min_billing_bump_generation() IS
  'Invalida globalmente o cache de faturamento minimo ao mudar ficha/lead time. O predicado id=true e obrigatorio para pg_safeupdate e seleciona a unica linha permitida pela tabela singleton.';
