-- =============================================================================
-- Ordem de Serviço: conferência/entrada parcial identificada por item do PV
-- =============================================================================
--
-- O ledger físico/financeiro existente (`service_order_returns`) já aceitava
-- várias devoluções, mas cada movimento guardava apenas totais agregados. Uma OS
-- com três modelos/cores podia voltar em partes, porém o sistema não sabia QUAL
-- item havia chegado. Esta migration mantém o cabeçalho canônico (e todos os
-- triggers de saldo/AP) e adiciona o detalhamento imutável por item.
--
-- Regra financeira preservada: somente qty_good do RETORNO gera AP. A soma das
-- linhas é validada contra o cabeçalho na mesma transação.

CREATE TABLE IF NOT EXISTS public.service_order_return_items (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_return_id   uuid NOT NULL
    REFERENCES public.service_order_returns(id) ON DELETE CASCADE,
  service_order_id          uuid NOT NULL
    REFERENCES public.service_orders(id) ON DELETE CASCADE,
  sale_order_item_id        uuid NOT NULL
    REFERENCES public.sale_order_items(id) ON DELETE RESTRICT,
  qty_good                  integer NOT NULL DEFAULT 0 CHECK (qty_good >= 0),
  qty_defect                integer NOT NULL DEFAULT 0 CHECK (qty_defect >= 0),
  qty_defect_scrapped       integer NOT NULL DEFAULT 0 CHECK (
    qty_defect_scrapped >= 0 AND qty_defect_scrapped <= qty_defect
  ),
  qty_loss                  integer NOT NULL DEFAULT 0 CHECK (qty_loss >= 0),
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_so_return_item_has_quantity
    CHECK (qty_good + qty_defect + qty_loss > 0),
  CONSTRAINT uq_so_return_item UNIQUE (service_order_return_id, sale_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_so_return_items_order_item
  ON public.service_order_return_items (service_order_id, sale_order_item_id);

COMMENT ON TABLE public.service_order_return_items IS
  'Detalhamento imutável do retorno da OS por item do pedido de venda. '
  'O cabeçalho service_order_returns continua sendo a fonte dos saldos e do financeiro.';

ALTER TABLE public.service_order_return_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS so_return_items_select ON public.service_order_return_items;
CREATE POLICY so_return_items_select ON public.service_order_return_items
  FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

REVOKE ALL ON TABLE public.service_order_return_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.service_order_return_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_order_return_items TO service_role;

-- ----------------------------------------------------------------------------
-- Read model do diálogo: escopo da OS + saldo definitivo de cada item.
--
-- Ordem de precedência do escopo:
--   1. seleção explícita `selected_sale_order_item_ids`;
--   2. item de origem da OS automática;
--   3. todos os itens dos PVs ligados (compatibilidade com OS legadas).
--
-- Retorno antigo sem linhas não é atribuído por suposição: ele aparece em
-- `unallocated_return_qty`, e a UI conserva o modo agregado nessa OS.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_service_order_receipt_items(
  p_service_order_id uuid
)
RETURNS TABLE (
  sale_order_item_id uuid,
  sale_order_id uuid,
  pv_number text,
  op_number text,
  reference_code text,
  reference_name text,
  color text,
  contracted_qty numeric,
  qty_good bigint,
  qty_defect bigint,
  qty_defect_scrapped bigint,
  qty_loss bigint,
  qty_settled bigint,
  qty_remaining numeric,
  unallocated_return_qty bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH selected_os AS (
    SELECT so.*
      FROM public.service_orders so
     WHERE so.id = p_service_order_id
       AND public.is_approved_user()
  ),
  candidates AS (
    SELECT
      item.id,
      item.sale_order_id,
      item.reference_id,
      item.color,
      item.quantity::numeric AS item_quantity,
      os.quantity::numeric AS os_quantity,
      count(*) OVER () AS scope_count
    FROM selected_os os
    JOIN public.sale_order_items item ON CASE
      WHEN os.selected_sale_order_item_ids IS NOT NULL
        THEN item.id = ANY(os.selected_sale_order_item_ids)
      WHEN os.source_sale_order_item_id IS NOT NULL
        THEN item.id = os.source_sale_order_item_id
      ELSE item.sale_order_id = ANY(
        array_remove(
          ARRAY[os.sale_order_id, os.source_sale_order_id]::uuid[]
            || COALESCE(os.linked_sale_order_ids, ARRAY[]::uuid[]),
          NULL
        )
      )
    END
  ),
  item_totals AS (
    SELECT
      sri.sale_order_item_id,
      COALESCE(sum(sri.qty_good), 0)::bigint AS good,
      COALESCE(sum(sri.qty_defect), 0)::bigint AS defect,
      COALESCE(sum(sri.qty_defect_scrapped), 0)::bigint AS scrapped,
      COALESCE(sum(sri.qty_loss), 0)::bigint AS loss
    FROM public.service_order_return_items sri
    WHERE sri.service_order_id = p_service_order_id
    GROUP BY sri.sale_order_item_id
  ),
  return_total AS (
    SELECT COALESCE(sum(r.qty_good + r.qty_defect + r.qty_loss), 0)::bigint AS quantity
      FROM public.service_order_returns r
     WHERE r.service_order_id = p_service_order_id
  ),
  allocated_total AS (
    SELECT COALESCE(sum(
      sri.qty_good + sri.qty_defect + sri.qty_loss
    ), 0)::bigint AS quantity
      FROM public.service_order_return_items sri
     WHERE sri.service_order_id = p_service_order_id
  )
  SELECT
    c.id,
    c.sale_order_id,
    pv.order_number,
    op.order_number,
    COALESCE(NULLIF(ts.code, ''), NULLIF(ts.name, '')),
    NULLIF(ts.name, ''),
    c.color,
    CASE WHEN c.scope_count = 1
      THEN LEAST(c.item_quantity, c.os_quantity)
      ELSE c.item_quantity
    END AS contracted_qty,
    COALESCE(it.good, 0),
    COALESCE(it.defect, 0),
    COALESCE(it.scrapped, 0),
    COALESCE(it.loss, 0),
    COALESCE(it.good + it.loss + it.scrapped, 0)::bigint AS qty_settled,
    GREATEST(
      0::numeric,
      (CASE WHEN c.scope_count = 1
        THEN LEAST(c.item_quantity, c.os_quantity)
        ELSE c.item_quantity
      END) - COALESCE(it.good + it.loss + it.scrapped, 0)
    ) AS qty_remaining,
    GREATEST(0::bigint, rt.quantity - at.quantity) AS unallocated_return_qty
  FROM candidates c
  JOIN public.sale_orders pv ON pv.id = c.sale_order_id
  LEFT JOIN public.technical_sheets ts ON ts.id = c.reference_id
  LEFT JOIN item_totals it ON it.sale_order_item_id = c.id
  LEFT JOIN LATERAL (
    SELECT o.order_number
      FROM public.orders o
     WHERE o.sale_order_item_id = c.id
       AND o.deleted_at IS NULL
       AND lower(btrim(COALESCE(o.status, ''))) NOT IN ('cancelada', 'cancelado', 'cancelled')
     ORDER BY o.created_at DESC
     LIMIT 1
  ) op ON true
  CROSS JOIN return_total rt
  CROSS JOIN allocated_total at
  ORDER BY pv.order_number, op.order_number NULLS LAST,
    COALESCE(NULLIF(ts.code, ''), NULLIF(ts.name, '')), c.color;
$function$;

REVOKE ALL ON FUNCTION public.list_service_order_receipt_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_service_order_receipt_items(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_service_order_receipt_items(uuid) IS
  'Lista os itens físicos da OS e o saldo definitivo de cada um. Retornos antigos '
  'sem rateio aparecem em unallocated_return_qty e nunca são atribuídos por inferência.';

-- ----------------------------------------------------------------------------
-- Escritor atômico: cabeçalho agregado + N itens na mesma transação.
-- Os triggers existentes do cabeçalho continuam responsáveis por saldo, status,
-- retrabalho, timeline e conta a pagar.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_service_order_return(
  p_service_order_id uuid,
  p_returned_at timestamptz,
  p_qty_good integer,
  p_qty_defect integer,
  p_qty_defect_scrapped integer,
  p_qty_loss integer,
  p_defect_notes text,
  p_contractor_id uuid,
  p_signed_photo_url text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_return_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_item_row public.sale_order_items%ROWTYPE;
  v_good integer;
  v_defect integer;
  v_scrapped integer;
  v_loss integer;
  v_line_total integer;
  v_item_target numeric;
  v_item_settled bigint;
  v_remaining numeric;
  v_allowed boolean;
  v_count integer;
  v_distinct_count integer;
  v_sum_good bigint;
  v_sum_defect bigint;
  v_sum_scrapped bigint;
  v_sum_loss bigint;
  v_item_summary text;
  v_order_item_summary text;
  v_completed boolean;
  v_qty_in_field bigint;
  v_qty_to_dispatch bigint;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado para registrar retorno de OS.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_service_order_id IS NULL THEN RAISE EXCEPTION 'Ordem de serviço obrigatória.'; END IF;
  IF COALESCE(p_qty_good, 0) < 0 OR COALESCE(p_qty_defect, 0) < 0
     OR COALESCE(p_qty_defect_scrapped, 0) < 0 OR COALESCE(p_qty_loss, 0) < 0 THEN
    RAISE EXCEPTION 'As quantidades do retorno não podem ser negativas.';
  END IF;
  IF COALESCE(p_qty_defect_scrapped, 0) > COALESCE(p_qty_defect, 0) THEN
    RAISE EXCEPTION 'A sucata não pode superar a quantidade defeituosa.';
  END IF;
  IF COALESCE(p_qty_good, 0) + COALESCE(p_qty_defect, 0) + COALESCE(p_qty_loss, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe ao menos um par devolvido.';
  END IF;

  IF p_items IS NULL THEN p_items := '[]'::jsonb; END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'O detalhamento dos itens deve ser uma lista JSON.';
  END IF;

  SELECT * INTO v_so
    FROM public.service_orders
   WHERE id = p_service_order_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de serviço não encontrada.'; END IF;

  IF jsonb_array_length(p_items) > 0 THEN
    WITH parsed AS (
      SELECT
        (value->>'sale_order_item_id')::uuid AS item_id,
        COALESCE((value->>'qty_good')::integer, 0) AS good,
        COALESCE((value->>'qty_defect')::integer, 0) AS defect,
        COALESCE((value->>'qty_defect_scrapped')::integer, 0) AS scrapped,
        COALESCE((value->>'qty_loss')::integer, 0) AS loss
      FROM jsonb_array_elements(p_items)
    )
    SELECT
      count(*)::integer,
      count(DISTINCT item_id)::integer,
      COALESCE(sum(good), 0),
      COALESCE(sum(defect), 0),
      COALESCE(sum(scrapped), 0),
      COALESCE(sum(loss), 0)
    INTO v_count, v_distinct_count, v_sum_good, v_sum_defect, v_sum_scrapped, v_sum_loss
    FROM parsed;

    IF v_count <> v_distinct_count THEN
      RAISE EXCEPTION 'Cada item pode aparecer apenas uma vez na mesma conferência.';
    END IF;
    IF v_sum_good <> COALESCE(p_qty_good, 0)
       OR v_sum_defect <> COALESCE(p_qty_defect, 0)
       OR v_sum_scrapped <> COALESCE(p_qty_defect_scrapped, 0)
       OR v_sum_loss <> COALESCE(p_qty_loss, 0) THEN
      RAISE EXCEPTION 'A soma dos itens não confere com o resumo do retorno.';
    END IF;
  END IF;

  -- O INSERT dispara as regras canônicas de saldo físico, status, timeline e AP.
  -- Qualquer falha posterior nas linhas reverte tudo, inclusive a AP, por estar
  -- na mesma transação desta função.
  INSERT INTO public.service_order_returns (
    service_order_id, returned_at, qty_good, qty_defect,
    qty_defect_scrapped, qty_loss, defect_notes, contractor_id,
    signed_photo_url, created_by
  ) VALUES (
    p_service_order_id, COALESCE(p_returned_at, now()),
    COALESCE(p_qty_good, 0), COALESCE(p_qty_defect, 0),
    COALESCE(p_qty_defect_scrapped, 0), COALESCE(p_qty_loss, 0),
    NULLIF(btrim(COALESCE(p_defect_notes, '')), ''),
    p_contractor_id, NULLIF(btrim(COALESCE(p_signed_photo_url, '')), ''), auth.uid()
  )
  RETURNING id INTO v_return_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (v_item->>'sale_order_item_id')::uuid;
    v_good := COALESCE((v_item->>'qty_good')::integer, 0);
    v_defect := COALESCE((v_item->>'qty_defect')::integer, 0);
    v_scrapped := COALESCE((v_item->>'qty_defect_scrapped')::integer, 0);
    v_loss := COALESCE((v_item->>'qty_loss')::integer, 0);
    v_line_total := v_good + v_defect + v_loss;

    IF v_good < 0 OR v_defect < 0 OR v_scrapped < 0 OR v_loss < 0
       OR v_scrapped > v_defect OR v_line_total <= 0 THEN
      RAISE EXCEPTION 'Quantidades inválidas no item %.', v_item_id;
    END IF;

    SELECT * INTO v_item_row
      FROM public.sale_order_items
     WHERE id = v_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item do pedido não encontrado: %.', v_item_id; END IF;

    v_allowed := CASE
      WHEN v_so.selected_sale_order_item_ids IS NOT NULL
        THEN v_item_id = ANY(v_so.selected_sale_order_item_ids)
      WHEN v_so.source_sale_order_item_id IS NOT NULL
        THEN v_item_id = v_so.source_sale_order_item_id
      ELSE v_item_row.sale_order_id = ANY(
        array_remove(
          ARRAY[v_so.sale_order_id, v_so.source_sale_order_id]::uuid[]
            || COALESCE(v_so.linked_sale_order_ids, ARRAY[]::uuid[]),
          NULL
        )
      )
    END;
    IF NOT COALESCE(v_allowed, false) THEN
      RAISE EXCEPTION 'O item % não pertence ao escopo desta OS.', v_item_id;
    END IF;

    -- Uma OS de item único pode contratar menos que a quantidade original do
    -- PV. Nas demais, a quantidade do item é o teto; o trigger do cabeçalho
    -- continua limitando também o total físico da OS/prestador.
    IF COALESCE(array_length(v_so.selected_sale_order_item_ids, 1), 0) = 1
       OR (v_so.selected_sale_order_item_ids IS NULL AND v_so.source_sale_order_item_id IS NOT NULL) THEN
      v_item_target := LEAST(v_item_row.quantity::numeric, v_so.quantity::numeric);
    ELSE
      v_item_target := v_item_row.quantity::numeric;
    END IF;

    SELECT COALESCE(sum(
      sri.qty_good + sri.qty_loss + sri.qty_defect_scrapped
    ), 0)::bigint
    INTO v_item_settled
    FROM public.service_order_return_items sri
    WHERE sri.service_order_id = p_service_order_id
      AND sri.sale_order_item_id = v_item_id;

    v_remaining := GREATEST(0::numeric, v_item_target - v_item_settled);
    IF v_line_total > v_remaining THEN
      RAISE EXCEPTION
        'Retorno do item % excede seu saldo: % informado, % restante.',
        v_item_id, v_line_total, v_remaining;
    END IF;
    IF v_good + v_loss + v_scrapped > v_remaining THEN
      RAISE EXCEPTION 'A baixa definitiva do item % excede seu saldo.', v_item_id;
    END IF;

    INSERT INTO public.service_order_return_items (
      service_order_return_id, service_order_id, sale_order_item_id,
      qty_good, qty_defect, qty_defect_scrapped, qty_loss
    ) VALUES (
      v_return_id, p_service_order_id, v_item_id,
      v_good, v_defect, v_scrapped, v_loss
    );
  END LOOP;

  IF NULLIF(btrim(COALESCE(p_signed_photo_url, '')), '') IS NOT NULL THEN
    UPDATE public.service_orders
       SET signed_photo_url = p_signed_photo_url, updated_at = now()
     WHERE id = p_service_order_id;
  END IF;

  IF jsonb_array_length(p_items) > 0 THEN
    SELECT string_agg(
      COALESCE(NULLIF(ts.name, ''), NULLIF(ts.code, ''), 'Item')
        || CASE WHEN NULLIF(item.color, '') IS NOT NULL THEN ' · ' || item.color ELSE '' END
        || ' (' || (
          COALESCE((x.value->>'qty_good')::integer, 0)
          + COALESCE((x.value->>'qty_defect')::integer, 0)
          + COALESCE((x.value->>'qty_loss')::integer, 0)
        )::text || ' pares)',
      ', ' ORDER BY COALESCE(NULLIF(ts.name, ''), NULLIF(ts.code, '')), item.color
    )
    INTO v_item_summary
    FROM jsonb_array_elements(p_items) x(value)
    JOIN public.sale_order_items item ON item.id = (x.value->>'sale_order_item_id')::uuid
    LEFT JOIN public.technical_sheets ts ON ts.id = item.reference_id;

    UPDATE public.accounts_payable
       SET notes = concat_ws(E'\n', NULLIF(notes, ''), 'Itens recebidos: ' || v_item_summary),
           updated_at = now()
     WHERE reference_type = 'service_order_return'
       AND reference_id = v_return_id;

    UPDATE public.service_order_events
       SET metadata = COALESCE(metadata, '{}'::jsonb)
         || jsonb_build_object('items', p_items)
     WHERE source_table = 'service_order_returns'
       AND source_id = v_return_id;

    -- OS legada (dispatch_tracked=false) cria uma AP única ligada à OS somente
    -- no fechamento. Nela, o texto precisa carregar TODOS os retornos parciais,
    -- não apenas a última remessa que concluiu o saldo.
    SELECT string_agg(
      COALESCE(NULLIF(ts.name, ''), NULLIF(ts.code, ''), 'Item')
        || CASE WHEN NULLIF(item.color, '') IS NOT NULL THEN ' · ' || item.color ELSE '' END
        || ' (' || totals.quantity::text || ' pares)',
      ', ' ORDER BY COALESCE(NULLIF(ts.name, ''), NULLIF(ts.code, '')), item.color
    )
    INTO v_order_item_summary
    FROM (
      SELECT sri.sale_order_item_id,
             sum(sri.qty_good + sri.qty_defect + sri.qty_loss)::bigint AS quantity
        FROM public.service_order_return_items sri
       WHERE sri.service_order_id = p_service_order_id
       GROUP BY sri.sale_order_item_id
    ) totals
    JOIN public.sale_order_items item ON item.id = totals.sale_order_item_id
    LEFT JOIN public.technical_sheets ts ON ts.id = item.reference_id;

    UPDATE public.accounts_payable
       SET notes = concat_ws(E'\n', NULLIF(notes, ''), 'Itens recebidos: ' || v_order_item_summary),
           updated_at = now()
     WHERE reference_type = 'service_order'
       AND reference_id = p_service_order_id;
  END IF;

  SELECT
    public.normalize_service_order_status(so.status) = 'Concluído',
    COALESCE(bal.qty_in_field, 0),
    COALESCE(bal.qty_to_dispatch, 0)
  INTO v_completed, v_qty_in_field, v_qty_to_dispatch
  FROM public.service_orders so
  LEFT JOIN public.v_service_order_balance bal ON bal.service_order_id = so.id
  WHERE so.id = p_service_order_id;

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'completed', COALESCE(v_completed, false),
    'qty_in_field', COALESCE(v_qty_in_field, 0),
    'qty_to_dispatch', COALESCE(v_qty_to_dispatch, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_service_order_return(
  uuid, timestamptz, integer, integer, integer, integer, text, uuid, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_service_order_return(
  uuid, timestamptz, integer, integer, integer, integer, text, uuid, text, jsonb
) TO authenticated, service_role;

COMMENT ON FUNCTION public.register_service_order_return(
  uuid, timestamptz, integer, integer, integer, integer, text, uuid, text, jsonb
) IS
  'Registra retorno parcial da OS e seu rateio por item atomicamente. Preserva os '
  'triggers canônicos de saldo, retrabalho, timeline e AP do cabeçalho.';
