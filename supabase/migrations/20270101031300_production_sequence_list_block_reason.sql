-- Fase 7: list_production_sequence expõe o motivo da porta (R9).
-- Pin fura (block_reason null). Demais linhas leem a mesma factory_gate.

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
  sequence_frozen_at timestamptz,
  block_reason text
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
    o.sequence_frozen_at,
    CASE
      WHEN q.pinned_position IS NOT NULL THEN NULL
      ELSE public.sale_order_item_factory_gate_block_reason(o.sale_order_item_id)
    END AS block_reason
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

COMMENT ON FUNCTION public.list_production_sequence() IS
  'Ordem oficial da fila + block_reason da porta Ateliê/Corte (pin zera o motivo).';

GRANT EXECUTE ON FUNCTION public.list_production_sequence() TO authenticated;
