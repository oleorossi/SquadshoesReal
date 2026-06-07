-- Fix MÉDIO (auditoria 2026-06-06): o backfill one-shot da 1a5b542 não pegou 7 fichas
-- SOLADO INFANTIL (grade do solado editada DEPOIS do backfill; o trigger AFTER UPDATE só
-- ressincroniza o produto que muda, não o grupo retroativo). Re-roda o backfill idempotente:
-- technical_sheets.sizes = MIN/MAX agregado da grade dos solados ativos do sole_group.
DO $$
DECLARE r record; v_from int; v_to int;
BEGIN
  FOR r IN SELECT DISTINCT sole_group_id FROM public.technical_sheets WHERE sole_group_id IS NOT NULL LOOP
    SELECT MIN((stock_grade->>'_size_from')::int), MAX((stock_grade->>'_size_to')::int)
      INTO v_from, v_to
      FROM public.products
     WHERE group_id = r.sole_group_id AND category = 'Solado' AND active = true
       AND stock_grade ? '_size_from' AND stock_grade ? '_size_to';
    IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from <= v_to THEN
      UPDATE public.technical_sheets
         SET sizes = v_from || '-' || v_to
       WHERE sole_group_id = r.sole_group_id
         AND sizes IS DISTINCT FROM (v_from || '-' || v_to);
    END IF;
  END LOOP;
END$$;
