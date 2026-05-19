-- Garante que sale_order_items.quantity = fichas × SUM(grade).
--
-- Motivação (2026-05-19):
-- O PV-00111 foi encontrado com SP117 CARAMELO em quantity=300, fichas=25,
-- grade={34:1,35:2,36:2,37:3,38:2,39:1,40:1} (soma=12). O esperado seria
-- fichas=30 (para totalizar 360 pares — quantidade pedida pelo cliente),
-- mas algum fluxo de save deixou quantity desalinhada do grid.
--
-- O frontend já tem auto-cálculo (SaleOrderItemForm.tsx useEffect), mas
-- isso pode falhar em race conditions ou ser ignorado em UPDATEs diretos
-- (ex.: edição via dashboard, scripts de migração, etc). Defesa em
-- profundidade: trigger no DB força a coerência sempre.
--
-- Comportamento:
--  - Se grade é JSONB object com pelo menos 1 valor > 0: recalcula quantity
--    e fichas a partir do GRID (quantity = fichas × sum_grade).
--  - Se quantity diverge do esperado (fichas × sum_grade), SOBRESCREVE
--    quantity pelo valor calculado. fichas continua sendo a fonte da verdade
--    (representa o número de fichas técnicas).
--  - Se grade vazia/inválida: não toca em quantity (mantém comportamento legacy).

CREATE OR REPLACE FUNCTION public.tg_enforce_sale_order_item_qty()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_grade_sum integer := 0;
  v_expected_qty integer;
BEGIN
  -- Só recalcula se grade é object JSONB com dados.
  IF NEW.grade IS NULL OR jsonb_typeof(NEW.grade) <> 'object' THEN
    RETURN NEW;
  END IF;

  -- Soma valores positivos do grid.
  SELECT COALESCE(SUM(GREATEST(0, COALESCE((v)::int, 0))), 0)
  INTO v_grade_sum
  FROM jsonb_each_text(NEW.grade) AS t(k, v);

  -- Grade vazia → não interfere.
  IF v_grade_sum = 0 THEN
    RETURN NEW;
  END IF;

  -- fichas mínimo = 1 (default do schema). Se vier nulo/0, força 1.
  IF NEW.fichas IS NULL OR NEW.fichas <= 0 THEN
    NEW.fichas := 1;
  END IF;

  v_expected_qty := NEW.fichas * v_grade_sum;

  -- Sobrescreve só se diverge. Evita updates desnecessários no row.
  IF NEW.quantity IS DISTINCT FROM v_expected_qty THEN
    NEW.quantity := v_expected_qty;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sale_order_item_qty ON public.sale_order_items;

CREATE TRIGGER trg_enforce_sale_order_item_qty
  BEFORE INSERT OR UPDATE OF quantity, fichas, grade
  ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_sale_order_item_qty();

COMMENT ON FUNCTION public.tg_enforce_sale_order_item_qty IS
  'Garante quantity = fichas × SUM(grade). Defesa contra dessincronização do frontend (race em useEffect, edição direta no DB, etc).';
