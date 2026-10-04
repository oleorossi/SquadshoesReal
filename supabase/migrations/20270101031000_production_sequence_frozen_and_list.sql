-- Fase 2 sequencia-producao: horizonte congelado + ordem da view da fila.
-- Spec: specs/sequencia-producao.md R5 / R1.

-- ── Colunas ────────────────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sequence_frozen_at timestamptz;

COMMENT ON COLUMN public.orders.sequence_frozen_at IS
  'Quando preenchido, a OP está na zona congelada da sequência (1º apontamento no 1º setor).';

ALTER TABLE public.production_queue
  ADD COLUMN IF NOT EXISTS sequence_frozen_position integer;

COMMENT ON COLUMN public.production_queue.sequence_frozen_position IS
  'Posição oficial congelada; recalc não remexe OPs com sequence_frozen_at.';

-- ── Congela no 1º apontamento de setor-raiz (corte / palmilha fibra|forração) ─
CREATE OR REPLACE FUNCTION public.tg_freeze_production_sequence_on_first_sector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stage text;
  v_is_first boolean := false;
  v_pos integer;
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 OR NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Já congelada: no-op.
  IF EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = NEW.order_id
       AND o.sequence_frozen_at IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  v_stage := COALESCE(NEW.stage_name, '');

  -- Setores-raiz do DAG (aliases incluídos) — 1º setor da fábrica.
  v_is_first := lower(trim(v_stage)) IN (
    'corte cabedal',
    'corte forração', 'corte forracao',
    'corte fibra',
    'corte palmilha',
    'palmilha · fibra', 'palmilha · forração', 'palmilha · forracao',
    'palmilha - fibra', 'palmilha - forração'
  );

  IF NOT v_is_first THEN
    RETURN NEW;
  END IF;

  -- Posição atual na ordem oficial (antes de congelar).
  SELECT s.sequence_position INTO v_pos
    FROM public.list_production_sequence() s
   WHERE s.order_id = NEW.order_id;

  UPDATE public.orders
     SET sequence_frozen_at = now(),
         updated_at = now()
   WHERE id = NEW.order_id
     AND sequence_frozen_at IS NULL;

  UPDATE public.production_queue
     SET sequence_frozen_position = COALESCE(v_pos, pinned_position)
   WHERE order_id = NEW.order_id
     AND sequence_frozen_position IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_production_sequence_on_first_sector ON public.production_pointings;
CREATE TRIGGER trg_freeze_production_sequence_on_first_sector
  AFTER INSERT ON public.production_pointings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_freeze_production_sequence_on_first_sector();

COMMENT ON FUNCTION public.tg_freeze_production_sequence_on_first_sector() IS
  'No 1º apontamento qty>0 em setor-raiz, congela posição da sequência (R5).';

-- ── list_production_sequence: pin → frozen pos → close → due → cor → ref ────
DROP FUNCTION IF EXISTS public.list_production_sequence();
CREATE OR REPLACE FUNCTION public.list_production_sequence()
RETURNS TABLE (
  order_id uuid,
  sale_order_id uuid,
  sale_order_item_id uuid,
  order_number text,
  color text,
  reference_code text,
  due_date date,
  pinned_position integer,
  close_score numeric,
  sequence_position integer,
  is_pinned boolean,
  is_frozen boolean,
  sequence_frozen_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    o.id AS order_id,
    o.sale_order_id,
    o.sale_order_item_id,
    o.order_number,
    o.color,
    ts.code AS reference_code,
    q.due_date,
    q.pinned_position,
    public.production_sequence_close_score(o.sale_order_id) AS close_score,
    row_number() OVER (
      ORDER BY (q.pinned_position IS NULL), q.pinned_position,
               CASE WHEN o.sequence_frozen_at IS NOT NULL THEN 0 ELSE 1 END,
               COALESCE(q.sequence_frozen_position, 2147483647),
               public.production_sequence_close_score(o.sale_order_id) DESC NULLS LAST,
               q.due_date NULLS LAST,
               lower(trim(COALESCE(o.color, ''))),
               lower(trim(COALESCE(ts.code, ''))),
               o.created_at, o.id
    )::integer AS sequence_position,
    (q.pinned_position IS NOT NULL) AS is_pinned,
    (o.sequence_frozen_at IS NOT NULL) AS is_frozen,
    o.sequence_frozen_at
  FROM public.production_queue q
  JOIN public.orders o ON o.id = q.order_id
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  WHERE o.deleted_at IS NULL
    AND COALESCE(o.status, '') NOT IN (
      'Cancelada', 'Cancelado', 'cancelled',
      'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
      'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
      'Faturado', 'Rascunho'
    )
    AND public.is_approved_user();
$$;

GRANT EXECUTE ON FUNCTION public.list_production_sequence() TO authenticated;

-- ── Patch recompute ORDER BY (frozen + close_score) ────────────────────────
DO $patch_recompute_frozen$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.recompute_production_schedule_impl_249(text)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'recompute_production_schedule_impl_249(text) não encontrada';
  END IF;

  -- Já com close_score (Fase 1), sem frozen ainda.
  v_old := $old$row_number() OVER (
           ORDER BY (q.pinned_position IS NULL), q.pinned_position,
                    public.production_sequence_close_score(o.sale_order_id) DESC NULLS LAST,
                    q.due_date NULLS LAST,
                    lower(trim(COALESCE(o.color, ''))),
                    lower(trim(COALESCE((
                      SELECT ts.code FROM public.technical_sheets ts
                       WHERE ts.id = o.reference_id
                       LIMIT 1
                    ), ''))),
                    o.created_at, o.id
         ) AS prio$old$;

  v_new := $new$row_number() OVER (
           ORDER BY (q.pinned_position IS NULL), q.pinned_position,
                    CASE WHEN o.sequence_frozen_at IS NOT NULL THEN 0 ELSE 1 END,
                    COALESCE(q.sequence_frozen_position, 2147483647),
                    public.production_sequence_close_score(o.sale_order_id) DESC NULLS LAST,
                    q.due_date NULLS LAST,
                    lower(trim(COALESCE(o.color, ''))),
                    lower(trim(COALESCE((
                      SELECT ts.code FROM public.technical_sheets ts
                       WHERE ts.id = o.reference_id
                       LIMIT 1
                    ), ''))),
                    o.created_at, o.id
         ) AS prio$new$;

  IF pg_catalog.strpos(v_definition, 'sequence_frozen_position') > 0 THEN
    RAISE NOTICE 'ORDER BY frozen já em impl_249 — skip';
  ELSIF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Âncora ORDER BY Fase 1 não encontrada em impl_249';
  ELSE
    EXECUTE replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_recompute_frozen$;

-- ── v_production_queue_detail: mesma ordem oficial ─────────────────────────
DO $patch_queue_view$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_catalog.pg_get_viewdef('public.v_production_queue_detail'::regclass, true)
    INTO v_def;

  v_old := 'row_number() OVER (ORDER BY (q.pinned_position IS NULL), q.pinned_position,
                                   q.due_date, o.created_at, o.id)::integer AS queue_position';

  -- Variante sem quebra de linha (pg_get_viewdef pretty pode colapsar).
  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    v_old := 'row_number() OVER (ORDER BY (q.pinned_position IS NULL), q.pinned_position, q.due_date, o.created_at, o.id)::integer AS queue_position';
  END IF;

  v_new := $ord$row_number() OVER (
    ORDER BY (q.pinned_position IS NULL), q.pinned_position,
             CASE WHEN o.sequence_frozen_at IS NOT NULL THEN 0 ELSE 1 END,
             COALESCE(q.sequence_frozen_position, 2147483647),
             public.production_sequence_close_score(o.sale_order_id) DESC NULLS LAST,
             q.due_date NULLS LAST,
             lower(trim(COALESCE(o.color, ''))),
             o.created_at, o.id
  )::integer AS queue_position$ord$;

  IF pg_catalog.strpos(v_def, 'sequence_frozen_position') > 0 THEN
    RAISE NOTICE 'v_production_queue_detail já com ordem de sequência — skip';
  ELSIF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE WARNING 'Âncora queue_position não encontrada — view não alterada; list_production_sequence cobre a UI nova';
  ELSE
    EXECUTE 'CREATE OR REPLACE VIEW public.v_production_queue_detail AS '
      || replace(v_def, v_old, v_new);
    GRANT SELECT ON public.v_production_queue_detail TO authenticated;
  END IF;
END;
$patch_queue_view$;
