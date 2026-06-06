-- Sincroniza technical_sheets.sizes quando o range do solado muda.
--
-- Bug reportado em 2026-06-06 com a ref ST 10 (sole_group e5e101bb…):
-- o solado estava cadastrado em 33-40 com conjugações 33/34 e 39/40, mas
-- a ficha estava presa em 35-38, fazendo a grade do consumo de cabedal
-- mostrar só 4 colunas e esconder as conjugações.
--
-- O trigger existente trg_sync_ficha_sizes_from_sole roda BEFORE INSERT/UPDATE
-- da própria ficha — só funciona quando a ficha É EDITADA. Se o user expandir
-- o range NO SOLADO depois de já ter cadastrado a ficha, ela fica desatualizada.
--
-- Fix: AFTER UPDATE OF stock_grade em products propaga MIN/MAX do grupo pras
-- fichas ligadas a esse sole_group_id. + backfill pra resincronizar fichas
-- atrasadas já existentes (ST 10 entre elas).
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-06-06.

CREATE OR REPLACE FUNCTION public.fn_sync_fichas_from_sole_grade_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_from int;
  v_old_to   int;
  v_new_from int;
  v_new_to   int;
  v_from int;
  v_to   int;
BEGIN
  IF NEW.category IS DISTINCT FROM 'Solado' THEN
    RETURN NEW;
  END IF;
  IF NEW.group_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_old_from := NULLIF(OLD.stock_grade->>'_size_from','')::int;
  v_old_to   := NULLIF(OLD.stock_grade->>'_size_to','')::int;
  v_new_from := NULLIF(NEW.stock_grade->>'_size_from','')::int;
  v_new_to   := NULLIF(NEW.stock_grade->>'_size_to','')::int;

  IF v_new_from IS NOT DISTINCT FROM v_old_from
     AND v_new_to IS NOT DISTINCT FROM v_old_to THEN
    RETURN NEW;
  END IF;

  -- MIN/MAX agregado de todas as variantes ativas do grupo (mesma lógica do
  -- trg_sync_ficha_sizes_from_sole)
  SELECT MIN((stock_grade->>'_size_from')::int),
         MAX((stock_grade->>'_size_to')::int)
    INTO v_from, v_to
    FROM public.products
   WHERE group_id = NEW.group_id
     AND category = 'Solado'
     AND active = true
     AND stock_grade ? '_size_from'
     AND stock_grade ? '_size_to';

  IF v_from IS NULL OR v_to IS NULL OR v_from > v_to THEN
    RETURN NEW;
  END IF;

  UPDATE public.technical_sheets
     SET sizes = v_from || '-' || v_to
   WHERE sole_group_id = NEW.group_id
     AND sizes IS DISTINCT FROM (v_from || '-' || v_to);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_fichas_from_sole_grade_change ON public.products;
CREATE TRIGGER trg_sync_fichas_from_sole_grade_change
AFTER UPDATE OF stock_grade ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_fichas_from_sole_grade_change();

-- Backfill one-shot pra resincronizar fichas atrasadas
DO $$
DECLARE
  r record;
  v_from int;
  v_to int;
BEGIN
  FOR r IN
    SELECT DISTINCT sole_group_id
      FROM public.technical_sheets
     WHERE sole_group_id IS NOT NULL
  LOOP
    SELECT MIN((stock_grade->>'_size_from')::int),
           MAX((stock_grade->>'_size_to')::int)
      INTO v_from, v_to
      FROM public.products
     WHERE group_id = r.sole_group_id
       AND category = 'Solado'
       AND active = true
       AND stock_grade ? '_size_from'
       AND stock_grade ? '_size_to';

    IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from <= v_to THEN
      UPDATE public.technical_sheets
         SET sizes = v_from || '-' || v_to
       WHERE sole_group_id = r.sole_group_id
         AND sizes IS DISTINCT FROM (v_from || '-' || v_to);
    END IF;
  END LOOP;
END$$;
