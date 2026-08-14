-- =============================================================================
-- Terceirizados: saldo físico, retrabalho e financeiro na mesma fonte de verdade
-- =============================================================================
--
-- Corrige quatro divergências que se reforçavam entre si:
--
--   1. OS terminal sem retorno lançado aparecia integralmente "na rua" porque o
--      legado dispatch_tracked=false presume a quantidade toda enviada.
--   2. O retorno era limitado por service_orders.quantity, não pelo que o
--      prestador realmente recebeu. Em envio parcial era possível devolver mais
--      pares do que tinham saído (e, em OS dividida, devolver pelo prestador errado).
--   3. A view oferecia reenvio de defeito, mas o trigger proibia qualquer despacho
--      acumulado acima da quantidade original. Ao mesmo tempo, a fórmula antiga
--      não consumia o crédito de retrabalho e poderia oferecê-lo repetidamente.
--   4. v_contractor_metrics lia somente AP ligada direto à OS e ignorava a AP por
--      retorno das OS dispatch_tracked, além de atribuir tudo ao prestador do
--      cabeçalho em vez do prestador real do retorno.
--
-- Regra física consolidada:
--   · OS rastreada: despacho bruto = SUM(service_order_dispatches).
--   · OS legada: quantity é o despacho inicial implícito; qualquer linha explícita
--     posterior em service_order_dispatches é um REENVIO de retrabalho.
--   · Cada defeito não sucateado abre exatamente 1 crédito de reenvio.
--   · retorno por prestador <= despacho bruto daquele prestador - retornos prévios.
--   · OS terminal nunca tem saldo operacional "na rua" nem "a enviar".
--
-- Não há backfill/desarquivamento: histórico terminal permanece terminal. A
-- migration corrige a leitura e blinda todos os movimentos novos.

-- Vocabulário único no SQL, espelhando src/lib/osStatusMachine.ts. Centralizar a
-- normalização impede que view/trigger mantenham listas literais diferentes.
CREATE OR REPLACE FUNCTION public.normalize_service_order_status(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT CASE lower(btrim(COALESCE(p_status, '')))
    WHEN 'em andamento'       THEN 'Em Andamento'
    WHEN 'em_andamento'       THEN 'Em Andamento'
    WHEN 'em processamento'   THEN 'Em Andamento'
    WHEN 'processando'        THEN 'Em Andamento'
    WHEN 'enviada'            THEN 'Em Andamento'
    WHEN 'enviado'            THEN 'Em Andamento'
    WHEN 'concluído'          THEN 'Concluído'
    WHEN 'concluido'          THEN 'Concluído'
    WHEN 'finalizado'         THEN 'Concluído'
    WHEN 'received'           THEN 'Concluído'
    WHEN 'recebida'           THEN 'Concluído'
    WHEN 'entregue'           THEN 'Concluído'
    WHEN 'cancelado'          THEN 'Cancelado'
    WHEN 'cancelada'          THEN 'Cancelado'
    WHEN 'cancelled'          THEN 'Cancelado'
    WHEN 'estornado'          THEN 'Cancelado'
    ELSE 'Pendente'
  END;
$function$;

REVOKE ALL ON FUNCTION public.normalize_service_order_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_service_order_status(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Despacho: quantidade original + um crédito para cada defeito não sucateado.
--
-- Para dispatch_tracked=false a quantidade original já saiu implicitamente; por
-- isso linhas explícitas só podem consumir créditos de retrabalho. Para a OS
-- rastreada, as linhas explícitas também cobrem o primeiro envio até quantity.
-- A mesma advisory lock é usada pelo retorno, fechando a corrida envio x retorno.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_validate_service_order_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_existing_dispatch bigint := 0;
  v_rework_credit bigint := 0;
  v_explicit_limit bigint := 0;
  v_after bigint := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('service_order_flow:' || NEW.service_order_id::text));

  SELECT * INTO v_so
    FROM public.service_orders
   WHERE id = NEW.service_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço % não encontrada', NEW.service_order_id;
  END IF;

  IF public.normalize_service_order_status(v_so.status) IN ('Concluído', 'Cancelado') THEN
    RAISE EXCEPTION 'OS % está % e não aceita novo despacho',
      COALESCE(v_so.order_number, v_so.id::text),
      public.normalize_service_order_status(v_so.status);
  END IF;

  SELECT COALESCE(sum(d.qty_dispatched), 0)::bigint
    INTO v_existing_dispatch
    FROM public.service_order_dispatches d
   WHERE d.service_order_id = NEW.service_order_id
     AND (TG_OP <> 'UPDATE' OR d.id <> NEW.id);

  SELECT COALESCE(sum(GREATEST(0, r.qty_defect - COALESCE(r.qty_defect_scrapped, 0))), 0)::bigint
    INTO v_rework_credit
    FROM public.service_order_returns r
   WHERE r.service_order_id = NEW.service_order_id;

  -- Rastreada: linhas explícitas carregam primeiro envio + retrabalho.
  -- Legada: primeiro envio é implícito; linha explícita é somente retrabalho.
  v_explicit_limit := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false)
      THEN v_so.quantity::bigint + v_rework_credit
    ELSE v_rework_credit
  END;
  v_after := v_existing_dispatch + NEW.qty_dispatched;

  IF v_after > v_explicit_limit THEN
    RAISE EXCEPTION
      'Envio excede o saldo autorizado da OS: % após o lançamento, limite % (% original + % de retrabalho)',
      v_after,
      v_explicit_limit,
      CASE WHEN COALESCE(v_so.dispatch_tracked, false) THEN v_so.quantity ELSE 0 END,
      v_rework_credit;
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- Retorno: nunca pode ultrapassar o que está fisicamente com ESSE prestador.
--
-- contractor_id nulo herda o prestador do cabeçalho para compatibilidade. A OS
-- legada ganha quantity como despacho implícito só no prestador principal; um
-- eventual reenvio explícito pode ser atribuído a outro prestador normalmente.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_validate_service_order_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_contractor uuid;
  v_dispatched bigint := 0;
  v_returned bigint := 0;
  v_new_total bigint := 0;
  v_explicit_dispatch bigint := 0;
  v_projected_rework_credit bigint := 0;
  v_explicit_limit bigint := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('service_order_flow:' || NEW.service_order_id::text));

  SELECT * INTO v_so
    FROM public.service_orders
   WHERE id = NEW.service_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ordem de serviço % não encontrada', NEW.service_order_id;
  END IF;

  IF TG_OP = 'INSERT'
     AND public.normalize_service_order_status(v_so.status) IN ('Concluído', 'Cancelado') THEN
    RAISE EXCEPTION 'OS % está % e não aceita novo retorno',
      COALESCE(v_so.order_number, v_so.id::text),
      public.normalize_service_order_status(v_so.status);
  END IF;

  v_contractor := COALESCE(NEW.contractor_id, v_so.contractor_id);

  -- Despacho implícito da OS legada pertence ao prestador do cabeçalho.
  IF NOT COALESCE(v_so.dispatch_tracked, false) AND v_contractor = v_so.contractor_id THEN
    v_dispatched := v_so.quantity::bigint;
  END IF;

  SELECT v_dispatched + COALESCE(sum(d.qty_dispatched), 0)::bigint
    INTO v_dispatched
    FROM public.service_order_dispatches d
   WHERE d.service_order_id = NEW.service_order_id
     AND COALESCE(d.contractor_id, v_so.contractor_id) = v_contractor;

  SELECT COALESCE(sum(r.qty_good + r.qty_defect + r.qty_loss), 0)::bigint
    INTO v_returned
    FROM public.service_order_returns r
    JOIN public.service_orders rso ON rso.id = r.service_order_id
   WHERE r.service_order_id = NEW.service_order_id
     AND COALESCE(r.contractor_id, rso.contractor_id) = v_contractor
     AND (TG_OP <> 'UPDATE' OR r.id <> NEW.id);

  v_new_total := NEW.qty_good::bigint + NEW.qty_defect::bigint + NEW.qty_loss::bigint;
  IF v_returned + v_new_total > v_dispatched THEN
    RAISE EXCEPTION
      'Retorno excede o despacho do prestador: % devolvidos após o lançamento, % enviados (OS %)',
      v_returned + v_new_total,
      v_dispatched,
      COALESCE(v_so.order_number, v_so.id::text);
  END IF;

  -- Um UPDATE também não pode apagar/sucatear um crédito de defeito que já foi
  -- consumido por reenvio. Sem esta projeção, aumentar qty_defect_scrapped depois
  -- do despacho deixaria mais pares enviados do que a OS autoriza.
  SELECT COALESCE(sum(d.qty_dispatched), 0)::bigint
    INTO v_explicit_dispatch
    FROM public.service_order_dispatches d
   WHERE d.service_order_id = NEW.service_order_id;

  SELECT
    COALESCE(sum(GREATEST(0, r.qty_defect - COALESCE(r.qty_defect_scrapped, 0))), 0)::bigint
      + GREATEST(0, NEW.qty_defect - COALESCE(NEW.qty_defect_scrapped, 0))::bigint
    INTO v_projected_rework_credit
    FROM public.service_order_returns r
   WHERE r.service_order_id = NEW.service_order_id
     AND (TG_OP <> 'UPDATE' OR r.id <> NEW.id);

  v_explicit_limit := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false)
      THEN v_so.quantity::bigint + v_projected_rework_credit
    ELSE v_projected_rework_credit
  END;
  IF v_explicit_dispatch > v_explicit_limit THEN
    RAISE EXCEPTION
      'Alteração do retorno removeria crédito de retrabalho já despachado: % enviados, limite projetado % (OS %)',
      v_explicit_dispatch,
      v_explicit_limit,
      COALESCE(v_so.order_number, v_so.id::text);
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- Fechamento: defeito não sucateado mantém a OS aberta até consumir seu crédito
-- de reenvio e voltar como bom/perda/sucata. DELETE usa OLD corretamente.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_apply_service_order_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_os_id uuid := COALESCE(NEW.service_order_id, OLD.service_order_id);
  v_so public.service_orders%ROWTYPE;
  v_good bigint := 0;
  v_defect bigint := 0;
  v_loss bigint := 0;
  v_scrapped bigint := 0;
  v_explicit_dispatch bigint := 0;
  v_gross_dispatch bigint := 0;
  v_rework_credit bigint := 0;
  v_rework_to_dispatch bigint := 0;
  v_last timestamptz;
BEGIN
  IF v_os_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT * INTO v_so FROM public.service_orders WHERE id = v_os_id;
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT
    COALESCE(sum(r.qty_good), 0)::bigint,
    COALESCE(sum(r.qty_defect), 0)::bigint,
    COALESCE(sum(r.qty_loss), 0)::bigint,
    COALESCE(sum(r.qty_defect_scrapped), 0)::bigint,
    max(r.returned_at)
  INTO v_good, v_defect, v_loss, v_scrapped, v_last
  FROM public.service_order_returns r
  WHERE r.service_order_id = v_os_id;

  SELECT COALESCE(sum(d.qty_dispatched), 0)::bigint
    INTO v_explicit_dispatch
    FROM public.service_order_dispatches d
   WHERE d.service_order_id = v_os_id;

  v_gross_dispatch := CASE
    WHEN COALESCE(v_so.dispatch_tracked, false) THEN v_explicit_dispatch
    ELSE v_so.quantity::bigint + v_explicit_dispatch
  END;
  v_rework_credit := GREATEST(0::bigint, v_defect - v_scrapped);
  v_rework_to_dispatch := GREATEST(
    0::bigint,
    v_so.quantity::bigint + v_rework_credit - v_gross_dispatch
  );

  IF v_so.quantity > 0
     AND v_good + v_loss + v_scrapped >= v_so.quantity
     AND v_rework_to_dispatch = 0 THEN
    UPDATE public.service_orders
       SET status = 'Concluído', delivered_at = v_last, updated_at = now()
     WHERE id = v_os_id
       AND public.normalize_service_order_status(status) NOT IN ('Concluído', 'Cancelado');
  ELSE
    UPDATE public.service_orders
       SET status = 'Em Andamento', updated_at = now()
     WHERE id = v_os_id
       AND public.normalize_service_order_status(status) NOT IN ('Concluído', 'Cancelado')
       AND status IS DISTINCT FROM 'Em Andamento';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ----------------------------------------------------------------------------
-- Saldo canônico por OS.
--
-- Mantém ordem/nome/tipo das 13 colunas existentes. qty_sent continua sendo a
-- quantidade contratada (compatibilidade); qty_dispatched é o despacho bruto.
-- ----------------------------------------------------------------------------
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
    COALESCE(sum(qty_good), 0)::bigint AS good,
    COALESCE(sum(qty_defect), 0)::bigint AS defect,
    COALESCE(sum(qty_loss), 0)::bigint AS loss,
    COALESCE(sum(qty_defect_scrapped), 0)::bigint AS scrapped,
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
    ELSE GREATEST(0::bigint, b.gross_dispatch - (b.good + b.defect + b.loss))
  END AS qty_in_field,
  b.last_return_at,
  b.dispatch_tracked,
  b.gross_dispatch AS qty_dispatched,
  CASE
    WHEN public.normalize_service_order_status(b.status) IN ('Concluído', 'Cancelado') THEN 0::bigint
    ELSE GREATEST(
      0::bigint,
      b.quantity::bigint + GREATEST(0::bigint, b.defect - b.scrapped) - b.gross_dispatch
    )
  END AS qty_to_dispatch,
  GREATEST(
    0::bigint,
    (b.defect - b.scrapped) - GREATEST(0::bigint, b.gross_dispatch - b.quantity::bigint)
  ) AS qty_defect_pending_rework,
  b.loss + b.scrapped AS qty_short
FROM b;

COMMENT ON VIEW public.v_service_order_balance IS
  'Saldo físico canônico da OS. Terminal zera qty_in_field/qty_to_dispatch. O despacho bruto '
  'inclui reenvios; cada defeito não sucateado abre um único crédito, consumido pelo reenvio. '
  'OS legada (dispatch_tracked=false) mantém quantity como despacho inicial implícito.';

GRANT SELECT ON public.v_service_order_balance TO authenticated, service_role;

-- Saldo por prestador com a mesma regra. A linha-base materializa o despacho
-- implícito das OS legadas no prestador do cabeçalho.
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
    0::bigint,
    0::bigint,
    0::bigint
  FROM public.service_order_dispatches d
  JOIN public.service_orders so ON so.id = d.service_order_id

  UNION ALL

  SELECT
    r.service_order_id,
    COALESCE(r.contractor_id, so.contractor_id),
    0::bigint,
    r.qty_good::bigint,
    r.qty_defect::bigint,
    r.qty_loss::bigint
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
    )
  END AS qty_in_field
FROM movements m
JOIN public.service_orders so ON so.id = m.service_order_id
GROUP BY m.service_order_id, m.contractor_id, so.status;

GRANT SELECT ON public.v_service_order_contractor_balance TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Fonte canônica de AP da OS, agora com o prestador efetivo no fim da view.
-- Coluna adicionada no FINAL para preservar consumidores existentes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_service_order_payables
WITH (security_invoker = true) AS
SELECT
  ap.id AS accounts_payable_id,
  ap.reference_type,
  so.id AS service_order_id,
  ap.status,
  ap.amount,
  ap.amount_paid,
  ap.due_date,
  ap.payment_date,
  ap.payment_method,
  ap.supplier_id,
  so.contractor_id AS contractor_id
FROM public.accounts_payable ap
JOIN public.service_orders so ON so.id = ap.reference_id
WHERE ap.reference_type = 'service_order'

UNION ALL

SELECT
  ap.id AS accounts_payable_id,
  ap.reference_type,
  r.service_order_id,
  ap.status,
  ap.amount,
  ap.amount_paid,
  ap.due_date,
  ap.payment_date,
  ap.payment_method,
  ap.supplier_id,
  COALESCE(r.contractor_id, so.contractor_id) AS contractor_id
FROM public.accounts_payable ap
JOIN public.service_order_returns r ON r.id = ap.reference_id
JOIN public.service_orders so ON so.id = r.service_order_id
WHERE ap.reference_type = 'service_order_return';

COMMENT ON VIEW public.v_service_order_payables IS
  'Fonte única das contas a pagar de OS pelos dois vínculos: service_order e '
  'service_order_return. contractor_id é o prestador efetivo do retorno, com '
  'fallback para o cabeçalho da OS.';

GRANT SELECT ON public.v_service_order_payables TO authenticated, service_role;

-- O resumo da tela precisa do SALDO em aberto, não do valor original das APs.
-- payable_amount mantém o contrato histórico (valor bruto); a coluna nova vai
-- no fim para não quebrar consumidores da view.
CREATE OR REPLACE VIEW public.v_service_order_overview
WITH (security_invoker = true) AS
SELECT
  so.id AS service_order_id,
  ap.accounts_payable_id,
  ap.payment_status,
  ap.payable_amount,
  ap.payment_due_date,
  ap.payment_date,
  COALESCE(ap.n_payables, 0) > 0 AS has_payable,
  COALESCE(ap.all_paid, false) AS is_paid,
  bal.qty_sent,
  bal.qty_returned_good,
  bal.qty_returned_defect,
  bal.qty_loss,
  bal.qty_in_field,
  bal.last_return_at,
  bal.qty_defect_pending_rework,
  bal.qty_short,
  bal.qty_dispatched,
  ap.payable_open_amount
FROM public.service_orders so
LEFT JOIN LATERAL (
  SELECT
    count(*) AS n_payables,
    CASE WHEN count(*) = 1 THEN (array_agg(p.accounts_payable_id))[1] END AS accounts_payable_id,
    CASE
      WHEN count(*) FILTER (
        WHERE lower(btrim(COALESCE(p.status, ''))) IN ('paid', 'pago', 'quitado')
      ) = count(*) THEN 'paid'
      ELSE 'pending'
    END AS payment_status,
    sum(p.amount) AS payable_amount,
    sum(
      CASE
        WHEN lower(btrim(COALESCE(p.status, ''))) IN ('paid', 'pago', 'quitado') THEN 0::numeric
        ELSE GREATEST(0::numeric, p.amount - COALESCE(p.amount_paid, 0::numeric))
      END
    ) AS payable_open_amount,
    COALESCE(
      min(p.due_date) FILTER (
        WHERE lower(btrim(COALESCE(p.status, ''))) NOT IN ('paid', 'pago', 'quitado')
      ),
      min(p.due_date)
    ) AS payment_due_date,
    max(p.payment_date) AS payment_date,
    count(*) FILTER (
      WHERE lower(btrim(COALESCE(p.status, ''))) IN ('paid', 'pago', 'quitado')
    ) = count(*) AS all_paid
  FROM public.v_service_order_payables p
  WHERE p.service_order_id = so.id
    AND lower(btrim(COALESCE(p.status, ''))) NOT IN (
      'cancelled', 'cancelado', 'cancelada', 'estornado'
    )
  HAVING count(*) > 0
) ap ON true
LEFT JOIN public.v_service_order_balance bal ON bal.service_order_id = so.id;

COMMENT ON VIEW public.v_service_order_overview IS
  'Visão por OS: saldo físico e AP direta/por retorno. qty_dispatched é o envio '
  'real; payable_amount é bruto e payable_open_amount desconta pagamentos parciais.';

GRANT SELECT ON public.v_service_order_overview TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Métricas por prestador.
--
-- Contagem/valor contratado continuam pertencendo ao prestador do cabeçalho da
-- OS (não duplicam uma OS dividida). Qualidade e dinheiro usam o prestador REAL
-- do retorno/AP. O financeiro lê exclusivamente v_service_order_payables.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_contractor_metrics
WITH (security_invoker = true) AS
SELECT
  c.id AS contractor_id,
  COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, ''), '—') AS contractor_name,
  c.service_type,
  c.active,
  count(so.id) AS total_orders,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) = 'Concluído'
  ) AS completed_orders,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) = 'Cancelado'
  ) AS cancelled_orders,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) NOT IN ('Concluído', 'Cancelado')
  ) AS open_orders,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) = 'Concluído'
      AND so.quoted_deadline IS NOT NULL
      AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) <= so.quoted_deadline
  ) AS on_time_count,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) = 'Concluído'
      AND so.quoted_deadline IS NOT NULL
      AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline
  ) AS late_count,
  count(so.id) FILTER (
    WHERE public.normalize_service_order_status(so.status) NOT IN ('Concluído', 'Cancelado')
      AND so.quoted_deadline IS NOT NULL
      AND so.quoted_deadline < CURRENT_DATE
  ) AS open_overdue_count,
  COALESCE(avg(
    CASE
      WHEN public.normalize_service_order_status(so.status) = 'Concluído'
       AND so.quoted_deadline IS NOT NULL
       AND COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline
      THEN COALESCE(so.delivered_at::date, so.receipt_generated_at::date, so.updated_at::date) - so.quoted_deadline
      ELSE NULL::integer
    END
  ), 0::numeric)::numeric(10,1) AS avg_late_days,
  COALESCE(sum(
    CASE WHEN public.normalize_service_order_status(so.status) <> 'Cancelado'
      THEN so.total_value ELSE 0::numeric END
  ), 0::numeric) AS total_value_all,
  COALESCE(max(fin.paid_amount), 0::numeric) AS total_value_paid,
  COALESCE(sum(
    CASE WHEN public.normalize_service_order_status(so.status) NOT IN ('Concluído', 'Cancelado')
      THEN so.total_value ELSE 0::numeric END
  ), 0::numeric) AS total_value_open,
  COALESCE(sum(
    CASE WHEN public.normalize_service_order_status(so.status) <> 'Cancelado'
      THEN so.quantity ELSE 0 END
  ), 0::bigint) AS total_quantity,
  max(so.created_at) AS last_order_at,
  COALESCE(max(ret.qty_good), 0::bigint) AS total_returned_good,
  COALESCE(max(ret.qty_defect), 0::bigint) AS total_returned_defect,
  COALESCE(max(ret.qty_loss), 0::bigint) AS total_returned_loss,
  CASE
    WHEN COALESCE(max(ret.qty_good), 0::bigint) + COALESCE(max(ret.qty_defect), 0::bigint) > 0
    THEN round(
      100.0 * COALESCE(max(ret.qty_defect), 0::bigint)::numeric
        / (COALESCE(max(ret.qty_good), 0::bigint) + COALESCE(max(ret.qty_defect), 0::bigint))::numeric,
      1
    )
    ELSE NULL::numeric
  END AS defect_pct,
  COALESCE(sum(
    CASE WHEN public.normalize_service_order_status(so.status) = 'Concluído'
      THEN so.total_value ELSE 0::numeric END
  ), 0::numeric) AS total_value_completed,
  COALESCE(max(fin.unpaid_amount), 0::numeric) AS total_value_unpaid
FROM public.contractors c
LEFT JOIN public.service_orders so ON so.contractor_id = c.id
LEFT JOIN (
  SELECT
    COALESCE(r.contractor_id, so2.contractor_id) AS contractor_id,
    sum(r.qty_good)::bigint AS qty_good,
    sum(r.qty_defect)::bigint AS qty_defect,
    sum(r.qty_loss)::bigint AS qty_loss
  FROM public.service_order_returns r
  JOIN public.service_orders so2 ON so2.id = r.service_order_id
  GROUP BY COALESCE(r.contractor_id, so2.contractor_id)
) ret ON ret.contractor_id = c.id
LEFT JOIN (
  SELECT
    p.contractor_id,
    sum(
      CASE
        WHEN lower(btrim(COALESCE(p.status, ''))) IN ('cancelled', 'cancelado', 'cancelada', 'estornado') THEN 0::numeric
        WHEN lower(btrim(COALESCE(p.status, ''))) IN ('paid', 'pago', 'quitado')
          THEN COALESCE(NULLIF(p.amount_paid, 0::numeric), p.amount)
        ELSE COALESCE(p.amount_paid, 0::numeric)
      END
    ) AS paid_amount,
    sum(
      CASE
        WHEN lower(btrim(COALESCE(p.status, ''))) IN (
          'paid', 'pago', 'quitado', 'cancelled', 'cancelado', 'cancelada', 'estornado'
        ) THEN 0::numeric
        ELSE GREATEST(0::numeric, p.amount - COALESCE(p.amount_paid, 0::numeric))
      END
    ) AS unpaid_amount
  FROM public.v_service_order_payables p
  GROUP BY p.contractor_id
) fin ON fin.contractor_id = c.id
GROUP BY c.id, c.trade_name, c.name, c.service_type, c.active;

COMMENT ON VIEW public.v_contractor_metrics IS
  'Métricas all-time por prestador. Status usa normalize_service_order_status; qualidade '
  'e financeiro pertencem ao prestador real do retorno. total_value_paid/unpaid leem '
  'v_service_order_payables e incluem AP direta da OS, AP por retorno e pagamento parcial.';

GRANT SELECT ON public.v_contractor_metrics TO authenticated, service_role;
