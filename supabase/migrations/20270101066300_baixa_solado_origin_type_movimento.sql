-- Versão 20270101066300. Não reutilizar 20270101066100: esse timestamp
-- já está aplicado em produção como atelie_ressalva_entrada_baixa_e_delete_where
-- (#749). A correção do origin_type nunca chegou a entrar sob 66100.
-- Corrige origin_type da baixa de solado na Solagem.
-- debit_sole_grade_for_solagem_pointing gravava origin_type = 'production_pointing',
-- rejeitado por stock_movements_strap_origin_type_ck (só NULL,
-- internal_factory, internal_contractor, buy_ready, production_order).
-- O trigger engolia o erro e a baixa não acontecia.
-- Movimentos históricos de conversão de solado usam origin_type NULL.
-- Sem backfill e sem débito retroativo.

DO $fix$
DECLARE
  v_def text;
  v_count integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'debit_sole_grade_for_solagem_pointing';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'debit_sole_grade_for_solagem_pointing não encontrada';
  END IF;

  v_count := (SELECT count(*) FROM regexp_matches(v_def, '''production_pointing''', 'g'));
  IF v_count = 0 THEN
    RAISE NOTICE 'origin_type já sem production_pointing; nada a fazer';
    RETURN;
  END IF;

  v_def := replace(v_def, '''production_pointing''', 'NULL');
  EXECUTE v_def;
END;
$fix$;
