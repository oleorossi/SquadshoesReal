-- Remove writers antigos que sobreviveram ao cutover de 20260721170000.
-- As assinaturas curtas eram SECURITY DEFINER, não validavam o usuário e
-- continuavam executáveis por anon/PUBLIC. Os substitutos canônicos possuem o
-- argumento p_force_soft e já são os únicos usados pelo app e pelo banco.

BEGIN;

DO $preflight$
DECLARE
  v_signature text;
  v_function regprocedure;
  v_default_count smallint;
  v_defaults text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)',
    'public.debit_strap_stock(jsonb,integer,uuid,jsonb,boolean)',
    'public.debit_packaging_for_order(uuid,uuid,uuid,integer,text,boolean)'
  ]
  LOOP
    v_function := to_regprocedure(v_signature);
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'Cutover recusado: substituto canônico ausente: %',
        v_signature;
    END IF;

    IF has_function_privilege('anon', v_function::oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Cutover recusado: substituto ainda exposto a anon: %',
        v_signature;
    END IF;

    SELECT p.pronargdefaults, pg_get_expr(p.proargdefaults, 0)
      INTO v_default_count, v_defaults
      FROM pg_proc p
     WHERE p.oid = v_function;

    IF v_default_count < 1
       OR regexp_replace(coalesce(v_defaults, ''), E'\\s+', '', 'g')
          !~ 'false$' THEN
      RAISE EXCEPTION
        'Cutover recusado: p_force_soft precisa terminar em DEFAULT false: %',
        v_signature;
    END IF;
  END LOOP;
END
$preflight$;

-- Sem CASCADE: qualquer dependência inesperada aborta toda a transação.
DROP FUNCTION IF EXISTS
  public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb);
DROP FUNCTION IF EXISTS
  public.debit_strap_stock(jsonb,integer,uuid,jsonb);
DROP FUNCTION IF EXISTS
  public.debit_packaging_for_order(uuid,uuid,uuid,integer,text);

DO $verify$
BEGIN
  IF to_regprocedure(
       'public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.debit_strap_stock(jsonb,integer,uuid,jsonb)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.debit_packaging_for_order(uuid,uuid,uuid,integer,text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Cutover recusado: overload legado sobreviveu';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
