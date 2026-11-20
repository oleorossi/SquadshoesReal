-- OS ativas: redistribuir saldo entre prestadores.
-- Par ainda não enviado muda de OS direto.
-- Par já enviado só muda depois de uma devolução sem produção
-- (service_order_returns.adjustment_kind = unproduced_return):
-- o kit volta para a fábrica, o lançamento não se apaga e não gera conta.
-- Conta pendente da OS, se ainda cobria esses pares, é reduzida ou cancelada.
-- A data de volta usa a capacidade do prestador. Nada aqui grava dado de teste.

ALTER TABLE public.service_order_returns
  DROP CONSTRAINT IF EXISTS service_order_returns_adjustment_kind_ck;
ALTER TABLE public.service_order_returns
  ADD CONSTRAINT service_order_returns_adjustment_kind_ck
  CHECK (
    adjustment_kind IS NULL
    OR adjustment_kind IN ('reversal', 'scrap', 'rework_return', 'unproduced_return')
  );

COMMENT ON CONSTRAINT service_order_returns_adjustment_kind_ck ON public.service_order_returns IS
  'unproduced_return devolve o kit sem produção e sem conta a pagar.';

CREATE OR REPLACE FUNCTION public.os_grade_total(p_grade jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(sum(
    CASE WHEN g.value ~ '^[0-9]+$' THEN g.value::int ELSE 0 END
  ), 0)::int
    FROM jsonb_each_text(COALESCE(p_grade, '{}'::jsonb)) g
   WHERE (g.key ~ '^[0-9]+(/[0-9]+)?$' OR g.key = 'pares')
     AND g.value ~ '^[0-9]+$'
     AND g.value::int > 0;
$$;

CREATE OR REPLACE FUNCTION public.os_grade_clean(p_grade jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_object_agg(g.key, g.value::int), '{}'::jsonb)
    FROM jsonb_each_text(COALESCE(p_grade, '{}'::jsonb)) g
   WHERE (g.key ~ '^[0-9]+(/[0-9]+)?$' OR g.key = 'pares')
     AND g.value ~ '^[0-9]+$'
     AND g.value::int > 0;
$$;

CREATE OR REPLACE FUNCTION public.os_pull_grade(p_have jsonb, p_need jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_have jsonb := public.os_grade_clean(p_have);
  v_need jsonb := public.os_grade_clean(p_need);
  v_taken jsonb := '{}'::jsonb;
  v_key text;
  v_qty int;
  v_have_qty int;
BEGIN
  FOR v_key IN
    SELECT g.key
      FROM jsonb_each_text(v_need) g
     ORDER BY CASE WHEN g.key = 'pares' THEN 9999 ELSE split_part(g.key, '/', 1)::int END, g.key
  LOOP
    v_qty := LEAST(COALESCE((v_need ->> v_key)::int, 0), COALESCE((v_have ->> v_key)::int, 0));
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;
    v_taken := jsonb_set(v_taken, ARRAY[v_key], to_jsonb(v_qty), true);
    v_have_qty := COALESCE((v_have ->> v_key)::int, 0) - v_qty;
    v_need := jsonb_set(v_need, ARRAY[v_key], to_jsonb(COALESCE((v_need ->> v_key)::int, 0) - v_qty), true);
    v_have := jsonb_set(v_have, ARRAY[v_key], to_jsonb(v_have_qty), true);
  END LOOP;
  RETURN jsonb_build_object(
    'taken', public.os_grade_clean(v_taken),
    'have', public.os_grade_clean(v_have),
    'need', public.os_grade_clean(v_need)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.os_split_grade_front(p_grade jsonb, p_front integer)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_left int := GREATEST(COALESCE(p_front, 0), 0);
  v_front jsonb := '{}'::jsonb;
  v_rest jsonb := '{}'::jsonb;
  v_key text;
  v_qty int;
  v_take int;
BEGIN
  FOR v_key, v_qty IN
    SELECT g.key, g.value::int
      FROM jsonb_each_text(public.os_grade_clean(p_grade)) g
     ORDER BY CASE WHEN g.key = 'pares' THEN 9999 ELSE split_part(g.key, '/', 1)::int END, g.key
  LOOP
    v_take := LEAST(v_left, v_qty);
    IF v_take > 0 THEN
      v_front := jsonb_set(v_front, ARRAY[v_key], to_jsonb(v_take), true);
    END IF;
    IF v_qty - v_take > 0 THEN
      v_rest := jsonb_set(v_rest, ARRAY[v_key], to_jsonb(v_qty - v_take), true);
    END IF;
    v_left := v_left - v_take;
  END LOOP;
  RETURN jsonb_build_object('front', public.os_grade_clean(v_front), 'rest', public.os_grade_clean(v_rest));
END;
$$;

CREATE OR REPLACE FUNCTION public.os_shrink_grade(p_grade jsonb, p_pairs integer)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_left int := GREATEST(COALESCE(p_pairs, 0), 0);
  v_out jsonb := public.os_grade_clean(p_grade);
  v_key text;
  v_have int;
  v_take int;
BEGIN
  FOR v_key IN
    SELECT g.key
      FROM jsonb_each_text(v_out) g
     ORDER BY CASE WHEN g.key = 'pares' THEN -1 ELSE split_part(g.key, '/', 1)::int END DESC, g.key DESC
  LOOP
    EXIT WHEN v_left <= 0;
    v_have := COALESCE((v_out ->> v_key)::int, 0);
    v_take := LEAST(v_left, v_have);
    v_out := jsonb_set(v_out, ARRAY[v_key], to_jsonb(v_have - v_take), true);
    v_left := v_left - v_take;
  END LOOP;
  RETURN public.os_grade_clean(v_out);
END;
$$;

CREATE OR REPLACE FUNCTION public.os_pool_pull(p_pool jsonb, p_need jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_item jsonb;
  v_need jsonb := public.os_grade_clean(p_need);
  v_pulled jsonb;
  v_parts jsonb := '[]'::jsonb;
  v_pool jsonb := '[]'::jsonb;
BEGIN
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_pool, '[]'::jsonb)) LOOP
    v_pulled := public.os_pull_grade(v_item -> 'grade', v_need);
    v_need := v_pulled -> 'need';
    IF public.os_grade_total(v_pulled -> 'taken') > 0 THEN
      v_parts := v_parts || jsonb_build_array(jsonb_build_object(
        'job_id', v_item -> 'job_id',
        'grade', v_pulled -> 'taken',
        'sent', v_item -> 'sent',
        'unit_price', v_item -> 'unit_price'
      ));
    END IF;
    IF public.os_grade_total(v_pulled -> 'have') > 0 THEN
      v_pool := v_pool || jsonb_build_array(jsonb_build_object(
        'job_id', v_item -> 'job_id',
        'grade', v_pulled -> 'have',
        'sent', v_item -> 'sent',
        'unit_price', v_item -> 'unit_price'
      ));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('parts', v_parts, 'pool', v_pool, 'leftover', v_need);
END;
$$;

REVOKE ALL ON FUNCTION public.os_grade_total(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.os_grade_clean(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.os_pull_grade(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.os_split_grade_front(jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.os_shrink_grade(jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.os_pool_pull(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.os_grade_total(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.os_grade_clean(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.os_pull_grade(jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.os_split_grade_front(jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.os_shrink_grade(jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.os_pool_pull(jsonb, jsonb) TO authenticated, service_role;

-- Conta pendente da OS inteira deixa de cobrar o par que voltou sem produção.
CREATE OR REPLACE FUNCTION public.adjust_undue_service_order_payable(p_os uuid, p_pairs integer)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price numeric;
  v_cut numeric;
  v_ap record;
  v_adjusted numeric := 0;
  v_left numeric;
BEGIN
  IF COALESCE(p_pairs, 0) <= 0 THEN
    RETURN 0;
  END IF;
  SELECT COALESCE(unit_price, 0) INTO v_price FROM public.service_orders WHERE id = p_os;
  v_left := round(p_pairs * COALESCE(v_price, 0), 2);
  IF v_left <= 0 THEN
    RETURN 0;
  END IF;
  FOR v_ap IN
    SELECT id, amount
      FROM public.accounts_payable
     WHERE reference_type = 'service_order'
       AND reference_id = p_os
       AND lower(btrim(status)) IN ('pending', 'pendente', 'open', 'aberto')
     ORDER BY created_at DESC, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_cut := LEAST(v_left, COALESCE(v_ap.amount, 0));
    IF COALESCE(v_ap.amount, 0) - v_cut <= 0 THEN
      UPDATE public.accounts_payable
         SET status = 'cancelled',
             amount = 0,
             notes = concat_ws(' ', notes, 'Devolução sem produção: conta não devida.'),
             updated_at = now()
       WHERE id = v_ap.id;
    ELSE
      UPDATE public.accounts_payable
         SET amount = round(amount - v_cut, 2),
             notes = concat_ws(' ', notes, 'Devolução sem produção: valor ajustado.'),
             updated_at = now()
       WHERE id = v_ap.id;
    END IF;
    v_adjusted := v_adjusted + v_cut;
    v_left := v_left - v_cut;
  END LOOP;
  RETURN round(v_adjusted, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_undue_service_order_payable(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_undue_service_order_payable(uuid, integer) TO service_role;

-- O par devolvido sem produção continua contando como saída da rua,
-- e o envio histórico pode ficar acima da quantidade que ainda é deste prestador.
DO $patch_return_limit$
DECLARE
  v_def text;
  v_old text := $old$  v_explicit_limit := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false)
      THEN v_so.quantity::bigint + v_projected_rework_credit
    ELSE v_projected_rework_credit
  END;$old$;
  v_new text := $new$  v_explicit_limit := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false)
      THEN v_so.quantity::bigint + v_projected_rework_credit
        + COALESCE((
            SELECT sum(ur.qty_good)::bigint
              FROM public.service_order_returns ur
             WHERE ur.service_order_id = NEW.service_order_id
               AND ur.adjustment_kind = 'unproduced_return'
               AND (TG_OP <> 'UPDATE' OR ur.id <> NEW.id)
          ), 0)
        + CASE WHEN NEW.adjustment_kind = 'unproduced_return' THEN NEW.qty_good::bigint ELSE 0 END
    ELSE v_projected_rework_credit
      + COALESCE((
            SELECT sum(ur.qty_good)::bigint
              FROM public.service_order_returns ur
             WHERE ur.service_order_id = NEW.service_order_id
               AND ur.adjustment_kind = 'unproduced_return'
               AND (TG_OP <> 'UPDATE' OR ur.id <> NEW.id)
          ), 0)
      + CASE WHEN NEW.adjustment_kind = 'unproduced_return' THEN NEW.qty_good::bigint ELSE 0 END
  END;$new$;
BEGIN
  SELECT pg_get_functiondef('public.tg_validate_service_order_return()'::regprocedure) INTO v_def;
  IF strpos(v_def, 'unproduced_return') > 0 AND strpos(v_def, 'v_projected_rework_credit') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei o limite do retorno para a devolução sem produção';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_return_limit$;

DO $patch_dispatch_limit$
DECLARE
  v_def text;
  v_old text := $old$  v_explicit_limit := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false)
      THEN v_so.quantity::bigint + v_rework_credit
    ELSE v_rework_credit
  END;$old$;
  v_new text := $new$  v_explicit_limit := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false)
      THEN v_so.quantity::bigint + v_rework_credit
        + COALESCE((
            SELECT sum(ur.qty_good)::bigint
              FROM public.service_order_returns ur
             WHERE ur.service_order_id = NEW.service_order_id
               AND ur.adjustment_kind = 'unproduced_return'
          ), 0)
    ELSE v_rework_credit
      + COALESCE((
            SELECT sum(ur.qty_good)::bigint
              FROM public.service_order_returns ur
             WHERE ur.service_order_id = NEW.service_order_id
               AND ur.adjustment_kind = 'unproduced_return'
          ), 0)
  END;$new$;
BEGIN
  SELECT pg_get_functiondef('public.tg_validate_service_order_dispatch()'::regprocedure) INTO v_def;
  IF strpos(v_def, 'unproduced_return') > 0 AND strpos(v_def, 'v_rework_credit') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei o limite do envio para a devolução sem produção';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_dispatch_limit$;

DO $patch_ap_unproduced$
DECLARE
  v_def text;
  v_old text := $old$     OR COALESCE(NEW.adjustment_kind, '') IN ('reversal', 'rework_return') THEN$old$;
  v_new text := $new$     OR COALESCE(NEW.adjustment_kind, '') IN ('reversal', 'rework_return', 'unproduced_return') THEN$new$;
BEGIN
  SELECT pg_get_functiondef('public.tg_ap_per_service_order_return()'::regprocedure) INTO v_def;
  IF strpos(v_def, 'unproduced_return') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei a conta a pagar para pular a devolução sem produção';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_ap_unproduced$;

-- Recebido de produção não inclui a devolução sem produção.
-- A rua diminui do mesmo jeito: o kit voltou.
CREATE OR REPLACE VIEW public.v_service_order_balance
WITH (security_invoker = true) AS
WITH d AS (
  SELECT service_order_id, COALESCE(sum(qty_dispatched), 0)::bigint AS explicit_dispatch
  FROM public.service_order_dispatches
  GROUP BY service_order_id
),
r AS (
  SELECT
    service_order_id,
    COALESCE(sum(CASE
      WHEN reverses_return_id IS NOT NULL THEN -qty_good
      WHEN adjustment_kind IN ('scrap', 'unproduced_return') THEN 0
      ELSE qty_good END), 0)::bigint AS good,
    COALESCE(sum(CASE
      WHEN reverses_return_id IS NOT NULL THEN -qty_defect
      WHEN adjustment_kind IN ('scrap', 'unproduced_return') THEN 0
      ELSE qty_defect END), 0)::bigint AS defect,
    COALESCE(sum(CASE
      WHEN reverses_return_id IS NOT NULL THEN -qty_loss
      WHEN adjustment_kind IN ('scrap', 'unproduced_return') THEN 0
      ELSE qty_loss END), 0)::bigint AS loss,
    COALESCE(sum(CASE
      WHEN reverses_return_id IS NOT NULL THEN -qty_defect_scrapped
      ELSE qty_defect_scrapped END), 0)::bigint AS scrapped,
    COALESCE(sum(CASE
      WHEN adjustment_kind = 'unproduced_return' AND reverses_return_id IS NULL
        THEN qty_good + qty_defect + qty_loss
      ELSE 0 END), 0)::bigint AS unproduced,
    max(returned_at) AS last_return_at
  FROM public.service_order_returns
  GROUP BY service_order_id
),
b AS (
  SELECT
    so.*,
    COALESCE(d.explicit_dispatch, 0)::bigint AS explicit_dispatch,
    CASE
      WHEN COALESCE(so.dispatch_tracked, false) THEN COALESCE(d.explicit_dispatch, 0)::bigint
      ELSE so.quantity::bigint + COALESCE(d.explicit_dispatch, 0)::bigint
    END AS gross_dispatch,
    COALESCE(r.good, 0)::bigint AS good,
    COALESCE(r.defect, 0)::bigint AS defect,
    COALESCE(r.loss, 0)::bigint AS loss,
    COALESCE(r.scrapped, 0)::bigint AS scrapped,
    COALESCE(r.unproduced, 0)::bigint AS unproduced,
    r.last_return_at
  FROM public.service_orders so
  LEFT JOIN d ON d.service_order_id = so.id
  LEFT JOIN r ON r.service_order_id = so.id
)
SELECT
  b.id AS service_order_id,
  b.contractor_id,
  b.quantity AS qty_sent,
  b.good AS qty_returned_good,
  b.defect AS qty_returned_defect,
  b.loss AS qty_loss,
  CASE
    WHEN public.normalize_service_order_status(b.status) IN ('Concluído', 'Cancelado') THEN 0::bigint
    ELSE GREATEST(0::bigint, b.gross_dispatch - (b.good + b.defect + b.loss + b.unproduced))
  END AS qty_in_field,
  b.last_return_at,
  b.dispatch_tracked,
  b.gross_dispatch AS qty_dispatched,
  CASE
    WHEN public.normalize_service_order_status(b.status) IN ('Concluído', 'Cancelado') THEN 0::bigint
    ELSE GREATEST(0::bigint, b.quantity::bigint + GREATEST(0::bigint, b.defect - b.scrapped) - b.gross_dispatch)
  END AS qty_to_dispatch,
  GREATEST(0::bigint, (b.defect - b.scrapped) - GREATEST(0::bigint, b.gross_dispatch - b.quantity::bigint))
    AS qty_defect_pending_rework,
  b.loss + b.scrapped AS qty_short
FROM b;

GRANT SELECT ON public.v_service_order_balance TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_service_order_contractor_balance
WITH (security_invoker = true) AS
WITH movements AS (
  SELECT
    so.id AS service_order_id,
    so.contractor_id,
    so.quantity::bigint AS dispatched,
    0::bigint AS good,
    0::bigint AS defect,
    0::bigint AS loss
  FROM public.service_orders so
  WHERE NOT COALESCE(so.dispatch_tracked, false)
  UNION ALL
  SELECT
    d.service_order_id,
    COALESCE(d.contractor_id, so.contractor_id),
    d.qty_dispatched::bigint,
    0::bigint, 0::bigint, 0::bigint
  FROM public.service_order_dispatches d
  JOIN public.service_orders so ON so.id = d.service_order_id
  UNION ALL
  SELECT
    r.service_order_id,
    COALESCE(r.contractor_id, so.contractor_id),
    0::bigint,
    CASE
      WHEN r.adjustment_kind = 'unproduced_return' THEN 0
      ELSE (public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id) * r.qty_good)::bigint
    END,
    CASE
      WHEN r.adjustment_kind = 'unproduced_return' THEN 0
      ELSE (public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id) * r.qty_defect)::bigint
    END,
    CASE
      WHEN r.adjustment_kind = 'unproduced_return' THEN 0
      ELSE (public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id) * r.qty_loss)::bigint
    END
  FROM public.service_order_returns r
  JOIN public.service_orders so ON so.id = r.service_order_id
)
SELECT
  m.service_order_id,
  m.contractor_id,
  COALESCE(sum(m.dispatched), 0)::bigint AS qty_dispatched,
  COALESCE(sum(m.good), 0)::bigint AS qty_good,
  COALESCE(sum(m.defect), 0)::bigint AS qty_defect,
  COALESCE(sum(m.loss), 0)::bigint AS qty_loss,
  CASE
    WHEN public.normalize_service_order_status(so.status) IN ('Concluído', 'Cancelado') THEN 0::bigint
    ELSE GREATEST(
      0::bigint,
      COALESCE(sum(m.dispatched), 0)::bigint
        - COALESCE(sum(m.good + m.defect + m.loss), 0)::bigint
        - COALESCE((
            SELECT sum(r.qty_good + r.qty_defect + r.qty_loss)::bigint
              FROM public.service_order_returns r
             WHERE r.service_order_id = m.service_order_id
               AND r.adjustment_kind = 'unproduced_return'
               AND r.reverses_return_id IS NULL
               AND COALESCE(r.contractor_id, (
                 SELECT s2.contractor_id FROM public.service_orders s2 WHERE s2.id = r.service_order_id
               )) IS NOT DISTINCT FROM m.contractor_id
          ), 0)
    )
  END AS qty_in_field
FROM movements m
JOIN public.service_orders so ON so.id = m.service_order_id
GROUP BY m.service_order_id, m.contractor_id, so.status;

GRANT SELECT ON public.v_service_order_contractor_balance TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.service_order_redistributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  source_service_order_id uuid NOT NULL REFERENCES public.service_orders(id),
  reason text NOT NULL,
  pairs integer NOT NULL CHECK (pairs > 0),
  unsent_pairs integer NOT NULL CHECK (unsent_pairs >= 0),
  returned_pairs integer NOT NULL CHECK (returned_pairs >= 0),
  grade jsonb NOT NULL,
  moves jsonb NOT NULL,
  return_id uuid,
  payable_adjusted numeric NOT NULL DEFAULT 0,
  CHECK (unsent_pairs + returned_pairs = pairs)
);

CREATE INDEX IF NOT EXISTS idx_so_redistributions_created
  ON public.service_order_redistributions (created_at DESC);

ALTER TABLE public.service_order_redistributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_order_redistributions FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS service_order_redistributions_read ON public.service_order_redistributions;
CREATE POLICY service_order_redistributions_read
  ON public.service_order_redistributions
  FOR SELECT TO authenticated
  USING (public.is_approved_user());
GRANT SELECT ON public.service_order_redistributions TO authenticated;
GRANT ALL ON public.service_order_redistributions TO service_role;

CREATE OR REPLACE FUNCTION public.tg_service_order_redistributions_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Redistribuição não se altera nem se apaga';
END;
$$;

DROP TRIGGER IF EXISTS trg_so_redistributions_immutable ON public.service_order_redistributions;
CREATE TRIGGER trg_so_redistributions_immutable
  BEFORE UPDATE OR DELETE ON public.service_order_redistributions
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_order_redistributions_immutable();

CREATE OR REPLACE FUNCTION public.list_active_service_order_board()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Sem permissão para ver as OS ativas' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH base AS (
      SELECT
        so.id,
        so.order_number,
        so.contractor_id,
        so.internal_execution,
        so.quantity,
        so.sale_order_id,
        so.source_sale_order_id,
        so.quoted_deadline,
        so.description,
        so.dispatch_tracked,
        COALESCE(b.qty_dispatched, 0)::int AS sent,
        COALESCE(b.qty_returned_good, 0)::int AS good,
        COALESCE(b.qty_returned_defect, 0)::int AS defect,
        COALESCE(b.qty_loss, 0)::int AS loss,
        COALESCE(b.qty_in_field, 0)::int AS street,
        COALESCE(b.qty_to_dispatch, 0)::int AS to_send,
        COALESCE((
          SELECT sum(r.qty_good)::int
            FROM public.service_order_returns r
           WHERE r.service_order_id = so.id
             AND r.adjustment_kind = 'unproduced_return'
             AND r.reverses_return_id IS NULL
        ), 0)::int AS unproduced
      FROM public.service_orders so
      LEFT JOIN public.v_service_order_balance b ON b.service_order_id = so.id
      WHERE public.normalize_service_order_status(so.status) NOT IN ('Concluído', 'Cancelado')
    ),
    shaped AS (
      SELECT
        base.*,
        GREATEST(0, base.quantity - base.sent) AS unsent_pairs,
        CASE
          WHEN public.os_grade_total(grades.grade) > 0 THEN grades.grade
          WHEN base.quantity > 0 THEN jsonb_build_object('pares', base.quantity)
          ELSE '{}'::jsonb
        END AS planned_grade
      FROM base
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_object_agg(s.key, s.qty), '{}'::jsonb) AS grade
          FROM (
            SELECT g.key, sum(g.value::int)::int AS qty
              FROM public.atelier_job_parts p
              CROSS JOIN LATERAL jsonb_each_text(public.os_grade_clean(p.grade)) g
             WHERE p.service_order_id = base.id
             GROUP BY g.key
          ) s
      ) grades ON true
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'serviceOrderId', shaped.id,
      'osNumber', COALESCE(shaped.order_number, ''),
      'contractorId', shaped.contractor_id,
      'contractorName', CASE
        WHEN COALESCE(shaped.internal_execution, false) THEN 'Produção interna'
        ELSE COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, ''), 'Prestador')
      END,
      'internal', COALESCE(shaped.internal_execution, false),
      'saleOrderId', COALESCE(shaped.sale_order_id, shaped.source_sale_order_id),
      'saleOrderNumber', pv.order_number,
      'lotNumber', lot.lot_number,
      'reference', COALESCE(ref.reference, NULLIF(btrim(shaped.description), ''), '—'),
      'color', COALESCE(ref.color, '—'),
      'sector', ref.sector,
      'grade', shaped.planned_grade,
      'movableGrade', public.os_shrink_grade(
        shaped.planned_grade,
        GREATEST(0, public.os_grade_total(shaped.planned_grade) - (shaped.unsent_pairs + shaped.street))
      ),
      'planned', shaped.quantity,
      'sent', shaped.sent,
      'unsent', shaped.unsent_pairs,
      'received', shaped.good + shaped.defect + shaped.loss,
      'unproduced', shaped.unproduced,
      'street', shaped.street,
      'toSend', shaped.to_send,
      'returnOn', ret.return_on,
      'late', shaped.street > 0 AND (
        (shaped.quoted_deadline IS NOT NULL AND shaped.quoted_deadline < CURRENT_DATE)
        OR (ret.return_on IS NOT NULL AND ret.return_on < CURRENT_DATE)
      ),
      'capacityPerDay', cap.capacity_pairs_per_day
    ) ORDER BY shaped.street > 0 AND (
        (shaped.quoted_deadline IS NOT NULL AND shaped.quoted_deadline < CURRENT_DATE)
        OR (ret.return_on IS NOT NULL AND ret.return_on < CURRENT_DATE)
      ) DESC, COALESCE(pv.order_number, ''), shaped.order_number), '[]'::jsonb)
    FROM shaped
    LEFT JOIN public.contractors c ON c.id = shaped.contractor_id
    LEFT JOIN public.sale_orders pv ON pv.id = COALESCE(shaped.sale_order_id, shaped.source_sale_order_id)
    LEFT JOIN LATERAL (
      SELECT
        string_agg(DISTINCT NULLIF(btrim(j.reference_code), ''), ' · ') AS reference,
        string_agg(DISTINCT NULLIF(btrim(j.color), ''), ' · ') AS color,
        min(j.sector) AS sector,
        min(j.lot_id::text)::uuid AS lot_id
      FROM public.atelier_job_parts p
      JOIN public.cabedal_prep_jobs j ON j.id = p.job_id
      WHERE p.service_order_id = shaped.id
    ) ref ON true
    LEFT JOIN public.atelier_lots lot ON lot.id = ref.lot_id
    LEFT JOIN LATERAL (
      SELECT min(p.return_on) AS return_on
        FROM public.atelier_job_parts p
       WHERE p.service_order_id = shaped.id
    ) ret ON true
    LEFT JOIN LATERAL (
      SELECT s.capacity_pairs_per_day
        FROM public.atelier_contractor_sectors s
       WHERE s.contractor_id = shaped.contractor_id
         AND s.active
         AND s.capacity_pairs_per_day IS NOT NULL
       ORDER BY s.capacity_pairs_per_day DESC
       LIMIT 1
    ) cap ON true
    WHERE shaped.quantity > 0 OR shaped.street > 0 OR shaped.to_send > 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_service_order_redistributions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Sem permissão para ver as redistribuições' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'createdAt', r.created_at,
      'actor', COALESCE(NULLIF(p.full_name, ''), '—'),
      'sourceOs', COALESCE(so.order_number, ''),
      'reason', r.reason,
      'pairs', r.pairs,
      'unsentPairs', r.unsent_pairs,
      'returnedPairs', r.returned_pairs,
      'grade', r.grade,
      'moves', r.moves,
      'payableAdjusted', r.payable_adjusted
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT * FROM public.service_order_redistributions
      ORDER BY created_at DESC
      LIMIT 100
    ) r
    JOIN public.service_orders so ON so.id = r.source_service_order_id
    LEFT JOIN public.profiles p ON p.id = r.created_by
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redistribute_service_order(
  p_source uuid,
  p_reason text,
  p_take jsonb,
  p_moves jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_take jsonb;
  v_sum jsonb := '{}'::jsonb;
  v_move jsonb;
  v_key text;
  v_qty int;
  v_explicit bigint;
  v_physical bigint;
  v_gross bigint;
  v_unsent int;
  v_street int;
  v_take_pairs int;
  v_from_unsent int;
  v_from_street int;
  v_planned jsonb;
  v_movable jsonb;
  v_split jsonb;
  v_street_grade jsonb;
  v_unsent_grade jsonb;
  v_part public.atelier_job_parts%ROWTYPE;
  v_pulled jsonb;
  v_new_grade jsonb;
  v_new_pairs int;
  v_pool jsonb := '[]'::jsonb;
  v_return_id uuid;
  v_payable numeric := 0;
  v_left_street int;
  v_dest_grade jsonb;
  v_dest_pairs int;
  v_dest_street int;
  v_dest_split jsonb;
  v_target uuid;
  v_target_number text;
  v_internal boolean;
  v_contractor uuid;
  v_name text;
  v_alloc jsonb;
  v_piece jsonb;
  v_job uuid;
  v_part_id uuid;
  v_part_sent int;
  v_header_dispatch int;
  v_price numeric;
  v_due date;
  v_cap numeric;
  v_offset int;
  v_sheet uuid;
  v_sector text;
  v_alerts jsonb := '[]'::jsonb;
  v_moves_out jsonb := '[]'::jsonb;
  v_week int;
  v_open int;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Sem permissão para redistribuir' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Diga o motivo da redistribuição' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_take) IS DISTINCT FROM 'object' OR jsonb_typeof(p_moves) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'A redistribuição precisa da grade e dos destinos' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(p_take) g
     WHERE (g.key <> 'pares' AND g.key !~ '^[0-9]+(/[0-9]+)?$')
        OR g.value !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'A grade só aceita pares inteiros, sem fração e sem negativo' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_so FROM public.service_orders WHERE id = p_source FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço não encontrada' USING ERRCODE = '22023';
  END IF;
  IF public.normalize_service_order_status(v_so.status) IN ('Concluído', 'Cancelado') THEN
    RAISE EXCEPTION 'OS % já está encerrada', COALESCE(v_so.order_number, v_so.id::text) USING ERRCODE = '22023';
  END IF;

  v_take := public.os_grade_clean(p_take);
  v_take_pairs := public.os_grade_total(v_take);
  IF v_take_pairs <= 0 THEN
    RAISE EXCEPTION 'Informe ao menos 1 par para sair desta OS' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_moves) = 0 THEN
    RAISE EXCEPTION 'Inclua ao menos um destino' USING ERRCODE = '22023';
  END IF;

  FOR v_move IN SELECT value FROM jsonb_array_elements(p_moves) LOOP
    IF EXISTS (
      SELECT 1 FROM jsonb_each_text(COALESCE(v_move -> 'grade', '{}'::jsonb)) g
       WHERE (g.key <> 'pares' AND g.key !~ '^[0-9]+(/[0-9]+)?$')
          OR g.value !~ '^[0-9]+$'
    ) THEN
      RAISE EXCEPTION 'A grade só aceita pares inteiros, sem fração e sem negativo' USING ERRCODE = '22023';
    END IF;
    v_internal := COALESCE((v_move ->> 'internal')::boolean, false);
    v_contractor := NULLIF(v_move ->> 'contractor_id', '')::uuid;
    IF v_internal AND v_contractor IS NOT NULL THEN
      RAISE EXCEPTION 'Produção interna não leva prestador' USING ERRCODE = '22023';
    END IF;
    IF NOT v_internal AND v_contractor IS NULL THEN
      RAISE EXCEPTION 'Escolha o prestador de destino' USING ERRCODE = '22023';
    END IF;
    IF NOT v_internal AND v_contractor = v_so.contractor_id AND NOT COALESCE(v_so.internal_execution, false) THEN
      RAISE EXCEPTION 'O destino é o mesmo prestador da OS' USING ERRCODE = '22023';
    END IF;
    IF v_internal AND COALESCE(v_so.internal_execution, false) THEN
      RAISE EXCEPTION 'O destino é a mesma produção interna' USING ERRCODE = '22023';
    END IF;
    IF public.os_grade_total(v_move -> 'grade') <= 0 THEN
      RAISE EXCEPTION 'Cada destino precisa de ao menos 1 par' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_sum := '{}'::jsonb;
  FOR v_move IN SELECT value FROM jsonb_array_elements(p_moves) LOOP
    FOR v_key, v_qty IN
      SELECT g.key, g.value::int FROM jsonb_each_text(public.os_grade_clean(v_move -> 'grade')) g
    LOOP
      v_sum := jsonb_set(
        v_sum,
        ARRAY[v_key],
        to_jsonb(COALESCE((v_sum ->> v_key)::int, 0) + v_qty),
        true
      );
    END LOOP;
  END LOOP;
  IF public.os_grade_clean(v_sum) IS DISTINCT FROM v_take THEN
    RAISE EXCEPTION 'A soma dos destinos não fecha o total que sai da OS' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(d.qty_dispatched), 0) INTO v_explicit
    FROM public.service_order_dispatches d
   WHERE d.service_order_id = v_so.id;
  SELECT COALESCE(sum(
    public.service_order_return_physical_sign(r.adjustment_kind, r.reverses_return_id)
    * (r.qty_good + r.qty_defect + r.qty_loss)
  ), 0) INTO v_physical
    FROM public.service_order_returns r
   WHERE r.service_order_id = v_so.id;

  v_gross := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false) THEN v_explicit
    ELSE v_so.quantity::bigint + v_explicit
  END;
  v_unsent := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false) THEN GREATEST(0, v_so.quantity - v_explicit)::int
    ELSE 0
  END;
  v_street := GREATEST(0, v_gross - v_physical)::int;
  IF v_take_pairs > v_unsent + v_street THEN
    RAISE EXCEPTION 'Só dá para mover % pares. O restante já voltou como produção', v_unsent + v_street
      USING ERRCODE = '22023';
  END IF;

  SELECT CASE
    WHEN public.os_grade_total(g.grade) > 0 THEN g.grade
    ELSE jsonb_build_object('pares', v_so.quantity)
  END
    INTO v_planned
    FROM (
      SELECT COALESCE(jsonb_object_agg(s.key, s.qty), '{}'::jsonb) AS grade
        FROM (
          SELECT e.key, sum(e.value::int)::int AS qty
            FROM public.atelier_job_parts p
            CROSS JOIN LATERAL jsonb_each_text(public.os_grade_clean(p.grade)) e
           WHERE p.service_order_id = v_so.id
           GROUP BY e.key
        ) s
    ) g;
  v_movable := public.os_shrink_grade(
    v_planned,
    GREATEST(0, public.os_grade_total(v_planned) - (v_unsent + v_street))
  );
  FOR v_key, v_qty IN SELECT e.key, e.value::int FROM jsonb_each_text(v_take) e LOOP
    IF v_qty > COALESCE((v_movable ->> v_key)::int, 0) THEN
      RAISE EXCEPTION 'O tamanho % passa do saldo: % de %',
        CASE WHEN v_key = 'pares' THEN 'pares' ELSE v_key END,
        v_qty,
        COALESCE((v_movable ->> v_key)::int, 0)
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_from_unsent := LEAST(v_unsent, v_take_pairs);
  v_from_street := v_take_pairs - v_from_unsent;
  v_split := public.os_split_grade_front(v_take, v_from_street);
  v_street_grade := v_split -> 'front';
  v_unsent_grade := v_split -> 'rest';

  FOR v_part IN
    SELECT * FROM public.atelier_job_parts
     WHERE service_order_id = v_so.id
       AND sent_at IS NOT NULL
     ORDER BY created_at, id
     FOR UPDATE
  LOOP
    v_pulled := public.os_pull_grade(v_part.grade, v_street_grade);
    IF public.os_grade_total(v_pulled -> 'taken') <= 0 THEN
      CONTINUE;
    END IF;
    v_street_grade := v_pulled -> 'need';
    v_new_grade := v_pulled -> 'have';
    v_new_pairs := public.os_grade_total(v_new_grade);
    IF v_new_pairs < ceil(COALESCE(v_part.received_pairs, 0))::int THEN
      RAISE EXCEPTION 'A grade inclui pares que já voltaram como produção' USING ERRCODE = '22023';
    END IF;
    IF v_new_pairs = 0 AND COALESCE(v_part.received_pairs, 0) = 0 THEN
      UPDATE public.service_order_items
         SET line_status = 'Cancelado', quantity = 0, total_value = 0, updated_at = now()
       WHERE atelier_part_id = v_part.id;
      DELETE FROM public.atelier_job_parts WHERE id = v_part.id;
    ELSE
      UPDATE public.atelier_job_parts
         SET grade = v_new_grade,
             pairs = v_new_pairs,
             updated_at = now()
       WHERE id = v_part.id;
      UPDATE public.service_order_items
         SET quantity = v_new_pairs,
             total_value = round(v_new_pairs * COALESCE(unit_price, 0), 2),
             updated_at = now()
       WHERE atelier_part_id = v_part.id;
    END IF;
    v_pool := v_pool || jsonb_build_array(jsonb_build_object(
      'job_id', to_jsonb(v_part.job_id),
      'grade', v_pulled -> 'taken',
      'sent', true,
      'unit_price', COALESCE(v_part.unit_price, v_so.unit_price)
    ));
  END LOOP;

  FOR v_part IN
    SELECT * FROM public.atelier_job_parts
     WHERE service_order_id = v_so.id
       AND sent_at IS NULL
     ORDER BY created_at, id
     FOR UPDATE
  LOOP
    v_pulled := public.os_pull_grade(v_part.grade, v_unsent_grade);
    IF public.os_grade_total(v_pulled -> 'taken') <= 0 THEN
      CONTINUE;
    END IF;
    v_unsent_grade := v_pulled -> 'need';
    v_new_grade := v_pulled -> 'have';
    v_new_pairs := public.os_grade_total(v_new_grade);
    IF v_new_pairs = 0 THEN
      UPDATE public.service_order_items
         SET line_status = 'Cancelado', quantity = 0, total_value = 0, updated_at = now()
       WHERE atelier_part_id = v_part.id;
      DELETE FROM public.atelier_job_parts WHERE id = v_part.id;
    ELSE
      UPDATE public.atelier_job_parts
         SET grade = v_new_grade, pairs = v_new_pairs, updated_at = now()
       WHERE id = v_part.id;
      UPDATE public.service_order_items
         SET quantity = v_new_pairs,
             total_value = round(v_new_pairs * COALESCE(unit_price, 0), 2),
             updated_at = now()
       WHERE atelier_part_id = v_part.id;
    END IF;
    v_pool := v_pool || jsonb_build_array(jsonb_build_object(
      'job_id', to_jsonb(v_part.job_id),
      'grade', v_pulled -> 'taken',
      'sent', false,
      'unit_price', COALESCE(v_part.unit_price, v_so.unit_price)
    ));
  END LOOP;

  IF v_from_street > 0 THEN
    INSERT INTO public.service_order_returns (
      service_order_id, contractor_id, returned_at,
      qty_good, qty_defect, qty_loss, defect_notes, created_by, adjustment_kind
    ) VALUES (
      v_so.id, v_so.contractor_id, now(),
      v_from_street, 0, 0,
      'Devolução sem produção: ' || v_reason,
      auth.uid(), 'unproduced_return'
    ) RETURNING id INTO v_return_id;
    v_payable := public.adjust_undue_service_order_payable(v_so.id, v_from_street);
  END IF;

  UPDATE public.service_orders
     SET quantity = quantity - v_take_pairs,
         total_value = round(GREATEST(quantity - v_take_pairs, 0) * COALESCE(unit_price, 0), 2),
         updated_at = now()
   WHERE id = v_so.id;

  v_left_street := v_from_street;
  FOR v_move IN SELECT value FROM jsonb_array_elements(p_moves) LOOP
    v_internal := COALESCE((v_move ->> 'internal')::boolean, false);
    v_contractor := NULLIF(v_move ->> 'contractor_id', '')::uuid;
    v_dest_grade := public.os_grade_clean(v_move -> 'grade');
    v_dest_pairs := public.os_grade_total(v_dest_grade);
    v_dest_street := LEAST(v_dest_pairs, v_left_street);
    v_left_street := v_left_street - v_dest_street;
    v_name := CASE
      WHEN v_internal THEN 'Produção interna'
      ELSE (
        SELECT COALESCE(NULLIF(trade_name, ''), NULLIF(name, ''), 'Prestador')
          FROM public.contractors WHERE id = v_contractor
      )
    END;
    IF NOT v_internal AND v_name IS NULL THEN
      RAISE EXCEPTION 'Prestador de destino não encontrado' USING ERRCODE = '22023';
    END IF;

    v_target := NULL;
    IF v_so.sale_order_id IS NOT NULL THEN
      SELECT id INTO v_target
        FROM public.service_orders
       WHERE id <> v_so.id
         AND dispatch_tracked
         AND accepting_shipments
         AND public.normalize_service_order_status(status) NOT IN ('Concluído', 'Cancelado')
         AND sale_order_id IS NOT DISTINCT FROM v_so.sale_order_id
         AND (
           (v_internal AND internal_execution AND contractor_id IS NULL)
           OR (NOT v_internal AND contractor_id = v_contractor AND NOT COALESCE(internal_execution, false))
         )
       ORDER BY created_at, id
       LIMIT 1
       FOR UPDATE;
    END IF;

    v_price := COALESCE(v_so.unit_price, 0);
    IF v_target IS NULL THEN
      IF NOT v_internal AND v_price <= 0 THEN
        RAISE EXCEPTION 'Informe o R$/par deste prestador na OS de origem' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.service_orders (
        contractor_id, internal_execution, status, service_date, description, notes,
        dispatch_tracked, quantity, unit_price, total_value, accepting_shipments,
        service_order_domain, is_avulsa, sale_order_id, source_sale_order_id, linked_sale_order_ids
      ) VALUES (
        v_contractor, v_internal, 'Em Andamento', CURRENT_DATE,
        COALESCE(NULLIF(v_so.description, ''), 'Redistribuição'),
        'Redistribuição da OS ' || COALESCE(v_so.order_number, v_so.id::text) || '. ' || v_reason,
        true, v_dest_pairs, v_price, round(v_dest_pairs * v_price, 2), true,
        COALESCE(v_so.service_order_domain, 'generic'), COALESCE(v_so.is_avulsa, false),
        v_so.sale_order_id, COALESCE(v_so.source_sale_order_id, v_so.sale_order_id),
        v_so.linked_sale_order_ids
      ) RETURNING id, order_number INTO v_target, v_target_number;
    ELSE
      SELECT order_number INTO v_target_number FROM public.service_orders WHERE id = v_target;
      UPDATE public.service_orders
         SET quantity = quantity + v_dest_pairs,
             total_value = round((quantity + v_dest_pairs) * COALESCE(unit_price, 0), 2),
             updated_at = now()
       WHERE id = v_target;
    END IF;

    v_alloc := public.os_pool_pull(v_pool, v_dest_grade);
    v_pool := v_alloc -> 'pool';
    v_part_sent := 0;
    FOR v_piece IN SELECT value FROM jsonb_array_elements(COALESCE(v_alloc -> 'parts', '[]'::jsonb)) LOOP
      v_job := NULLIF(v_piece ->> 'job_id', '')::uuid;
      v_new_pairs := public.os_grade_total(v_piece -> 'grade');
      IF v_job IS NULL OR v_new_pairs <= 0 THEN
        CONTINUE;
      END IF;
      SELECT j.technical_sheet_id, j.sector INTO v_sheet, v_sector
        FROM public.cabedal_prep_jobs j WHERE j.id = v_job;
      v_cap := NULL;
      IF v_contractor IS NOT NULL THEN
        SELECT c.capacity_pairs_per_day INTO v_cap
          FROM public.contractor_model_capacities c
         WHERE c.contractor_id = v_contractor
           AND c.technical_sheet_id = v_sheet
           AND (v_sector IS NULL OR c.sector = v_sector)
         LIMIT 1;
        IF v_cap IS NULL THEN
          SELECT s.capacity_pairs_per_day INTO v_cap
            FROM public.atelier_contractor_sectors s
           WHERE s.contractor_id = v_contractor
             AND s.active
           ORDER BY s.capacity_pairs_per_day DESC NULLS LAST
           LIMIT 1;
        END IF;
      END IF;
      v_offset := 5;
      SELECT COALESCE(costura_offset_days, 5) INTO v_offset
        FROM public.atelier_settings WHERE id = 1;
      v_offset := GREATEST(0, COALESCE(v_offset, 5));
      v_due := public.add_business_days(
        CURRENT_DATE,
        CASE WHEN v_cap IS NOT NULL AND v_cap > 0 THEN ceil(v_new_pairs / v_cap)::int ELSE v_offset END
      );
      INSERT INTO public.atelier_job_parts (
        job_id, execution_mode, contractor_id, pairs, grade, service_order_id,
        unit_price, price_source, return_on, pipeline_status, sent_at, created_by
      ) VALUES (
        v_job,
        CASE WHEN v_internal THEN 'internal' ELSE 'contractor' END,
        v_contractor,
        v_new_pairs,
        v_piece -> 'grade',
        v_target,
        COALESCE((v_piece ->> 'unit_price')::numeric, v_price),
        'redistribuicao',
        v_due,
        CASE WHEN COALESCE((v_piece ->> 'sent')::boolean, false) THEN 'sent_to_contractor' ELSE 'cut' END,
        CASE WHEN COALESCE((v_piece ->> 'sent')::boolean, false) THEN now() ELSE NULL END,
        auth.uid()
      ) RETURNING id INTO v_part_id;
      INSERT INTO public.service_order_items (
        service_order_id, atelier_job_id, atelier_part_id, source_item_key,
        material_name, description, sale_order_id, quantity, unit, unit_price, total_value, line_status, sent_at
      )
      SELECT
        v_target, v_job, v_part_id, 'atelier-part:' || v_part_id::text,
        COALESCE(NULLIF(btrim(j.reference_code), ''), 'Ateliê'),
        trim(both ' · ' FROM concat_ws(' · ', NULLIF(btrim(j.reference_code), ''), NULLIF(btrim(j.color), ''))),
        j.sale_order_id, v_new_pairs, 'par',
        COALESCE((v_piece ->> 'unit_price')::numeric, v_price),
        round(v_new_pairs * COALESCE((v_piece ->> 'unit_price')::numeric, v_price), 2),
        'Pendente',
        CASE WHEN COALESCE((v_piece ->> 'sent')::boolean, false) THEN now() ELSE NULL END
      FROM public.cabedal_prep_jobs j WHERE j.id = v_job;
      IF COALESCE((v_piece ->> 'sent')::boolean, false) THEN
        INSERT INTO public.service_order_dispatches (
          service_order_id, contractor_id, qty_dispatched, dispatched_at, notes, grade, created_by
        ) VALUES (
          v_target, v_contractor, v_new_pairs, now(),
          'redistribuicao:' || v_part_id::text, v_piece -> 'grade', auth.uid()
        );
        v_part_sent := v_part_sent + v_new_pairs;
      END IF;
      UPDATE public.service_orders
         SET quoted_deadline = CASE
               WHEN quoted_deadline IS NULL OR v_due < quoted_deadline THEN v_due
               ELSE quoted_deadline
             END
       WHERE id = v_target;
    END LOOP;

    v_header_dispatch := v_dest_street - v_part_sent;
    IF v_header_dispatch < 0 THEN
      RAISE EXCEPTION 'A parte enviada passou dos pares que estavam na rua' USING ERRCODE = '22023';
    END IF;
    IF v_header_dispatch > 0 THEN
      v_dest_split := public.os_split_grade_front(v_alloc -> 'leftover', v_header_dispatch);
      INSERT INTO public.service_order_dispatches (
        service_order_id, contractor_id, qty_dispatched, dispatched_at, notes, grade, created_by
      ) VALUES (
        v_target, v_contractor, v_header_dispatch, now(),
        'redistribuicao', COALESCE(v_dest_split -> 'front', '{}'::jsonb), auth.uid()
      );
    END IF;

    IF v_contractor IS NOT NULL THEN
      SELECT COALESCE(sum(quantity), 0) INTO v_open
        FROM public.service_orders
       WHERE contractor_id = v_contractor
         AND public.normalize_service_order_status(status) NOT IN ('Concluído', 'Cancelado');
      SELECT max(s.capacity_pairs_per_day) INTO v_cap
        FROM public.atelier_contractor_sectors s
       WHERE s.contractor_id = v_contractor AND s.active;
      IF v_cap IS NOT NULL AND v_cap > 0 THEN
        v_week := (v_cap * 5)::int;
        IF v_open > v_week THEN
          v_alerts := v_alerts || jsonb_build_array(
            format(
              'A OS da semana soma %s pares e a capacidade é %s/dia (%s na semana). O envio não é bloqueado.',
              v_open, v_cap::int, v_week
            )
          );
        END IF;
      END IF;
    END IF;

    v_moves_out := v_moves_out || jsonb_build_array(jsonb_build_object(
      'contractorId', v_contractor,
      'contractorName', v_name,
      'internal', v_internal,
      'grade', v_dest_grade,
      'serviceOrderId', v_target,
      'orderNumber', v_target_number,
      'streetPairs', v_dest_street,
      'unsentPairs', v_dest_pairs - v_dest_street
    ));
  END LOOP;

  IF jsonb_array_length(COALESCE(v_pool, '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'A soma dos destinos não fecha o total que sai da OS' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.service_order_redistributions (
    created_by, source_service_order_id, reason, pairs, unsent_pairs, returned_pairs,
    grade, moves, return_id, payable_adjusted
  ) VALUES (
    auth.uid(), v_so.id, v_reason, v_take_pairs, v_from_unsent, v_from_street,
    v_take, v_moves_out, v_return_id, COALESCE(v_payable, 0)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'unsentPairs', v_from_unsent,
    'returnedPairs', v_from_street,
    'requiresUnproducedReturn', v_from_street > 0,
    'payableAdjusted', COALESCE(v_payable, 0),
    'returnId', v_return_id,
    'alerts', v_alerts,
    'moves', v_moves_out
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_active_service_order_board() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_service_order_redistributions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redistribute_service_order(uuid, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_service_order_board() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_service_order_redistributions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redistribute_service_order(uuid, text, jsonb, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.redistribute_service_order(uuid, text, jsonb, jsonb) IS
  'Move saldo de uma OS ativa. Par não enviado muda direto. Par na rua grava devolução sem produção, sem conta a pagar, e só então segue ao outro prestador.';
