-- =============================================================================
-- "Restante" virou cópia de "Pares" — o conserto anterior trocou um número
-- inflado 8x por um número que nunca varia.
--
-- `remaining_pairs_net` = quantidade − processado da ÚLTIMA etapa da rota. Está
-- semanticamente CERTO ("pares que ainda não saíram da fábrica") e é inútil como
-- progresso: a última etapa só é apontada no fim, então ele é igual ao total da
-- OP em 100% das linhas. Medido em 07/08/2026: 34 de 34 com net = quantity, e
-- ZERO linhas com net < quantity. A OP-2026-01191 tem 180 dos 288 pares cortados
-- e a tela mostrava "Pares 288 / Restante 288", lado a lado.
--
-- ⚠ Não existe UM número que seja ao mesmo tempo simples e informativo num fluxo
-- de 9 a 11 setores: "pares prontos" só muda no fim, e "pares·setor" conta o
-- mesmo par várias vezes (era o bug original). Por isso a coluna nova é um
-- PERCENTUAL DE AVANÇO — quanto da rota já foi executada —, que varia de
-- verdade: medido, 6 valores distintos entre 0% e 22% nas 34 OPs da fila.
--
-- `remaining_pairs_net` FICA: continua correto pra "quanto ainda não embarcou".
-- O que muda é a tela, que para de exibi-lo ao lado de `quantity` como se
-- fossem coisas diferentes.
--
-- ⚠ CREATE OR REPLACE em vez de DROP+CREATE — mas ele NÃO é suficiente sozinho.
--
-- Foi um DROP+CREATE na `20261214120000` que apagou em silêncio o
-- `security_invoker` e o ACL da `v_production_overloads`, deixando-a legível SEM
-- LOGIN (ver `20261219120000`). O `CREATE OR REPLACE` daqui aceita colunas novas
-- no FIM e PRESERVA O ACL (verificado: `anon` continuou negado depois de rodar).
--
-- ⚠ MAS ELE TAMBÉM PERDE O `reloptions`: medido logo após aplicar esta
-- migration, `security_invoker` tinha sumido de novo. Por isso o ALTER VIEW
-- explícito no fim. A regra completa é: depois de QUALQUER recriação de view,
-- confira `pg_class.reloptions` e `has_table_privilege('anon', ...)` — não
-- confie em nenhuma das duas formas preservar sozinha.
--
-- ⚠ E só a `v_production_overloads` leva `security_invoker`, porque era o estado
-- ORIGINAL dela. A `v_production_queue_detail` sempre foi SECURITY DEFINER de
-- propósito (é uma das 13 da `20261122120000`, protegidas pelo REVOKE, não pelo
-- invoker): pôr invoker nela mudaria o que um usuário logado enxerga, sem
-- necessidade e sem verificação.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_production_queue_detail AS
 WITH sched AS (
         SELECT production_schedule.order_id,
            max(production_schedule.date) AS projected_completion,
            min(production_schedule.date) AS next_scheduled_date,
            bool_or((production_schedule.capacity_source = 'ficha_override'::text)) AS has_ficha_override,
            (sum(production_schedule.carryover_pairs))::integer AS carryover_total,
            (max(production_schedule.carryover_pairs))::integer AS carryover_peak
           FROM production_schedule
          WHERE (production_schedule.date >= br_today())
          GROUP BY production_schedule.order_id
        ), stg AS (
         SELECT order_stages.order_id,
            (sum(GREATEST(0, (order_stages.quantity_total - COALESCE(order_stages.quantity_processed, 0)))))::integer AS remaining_pairs
           FROM order_stages
          WHERE (order_stages.status <> 'concluido'::text)
          GROUP BY order_stages.order_id
        ), last_stage AS (
         SELECT DISTINCT ON (os.order_id)
            os.order_id,
            COALESCE(os.quantity_processed, 0) AS last_processed
           FROM order_stages os
          ORDER BY os.order_id, os.stage_order DESC
        ), rota AS (
         SELECT os.order_id,
            sum(COALESCE(os.quantity_processed, 0))::numeric AS feito,
            sum(COALESCE(os.quantity_total, 0))::numeric AS total_rota
           FROM order_stages os
          GROUP BY os.order_id
        )
 SELECT q.order_id,
    o.order_number,
    o.reference_id,
    ts.name AS reference_name,
    ts.image_url AS reference_photo_url,
    o.color,
    o.quantity,
    o.status AS order_status,
    o.sale_order_id,
    so.order_number AS sale_order_number,
    c.razao_social AS client_name,
    q.due_date,
    q.pinned_position,
    q.pinned_by,
    q.pinned_at,
    q.status AS queue_status,
    s.projected_completion,
    s.next_scheduled_date,
    COALESCE(s.has_ficha_override, false) AS has_ficha_override,
    COALESCE(s.carryover_total, 0) AS carryover_total,
    COALESCE(st.remaining_pairs, 0) AS remaining_pairs,
        CASE
            WHEN ((q.due_date IS NOT NULL) AND (s.projected_completion > q.due_date)) THEN (s.projected_completion - q.due_date)
            ELSE 0
        END AS late_days,
    (row_number() OVER (ORDER BY (q.pinned_position IS NULL), q.pinned_position, q.due_date, o.created_at, o.id))::integer AS queue_position,
    c.nome_fantasia AS client_fantasia,
    eg.name AS client_group_name,
    GREATEST(0, (o.quantity - COALESCE(ls.last_processed, 0)))::integer AS remaining_pairs_net,
    COALESCE(s.carryover_peak, 0) AS carryover_peak,
    -- Quanto da ROTA já foi executada. Único dos três que varia com o trabalho
    -- do dia; é o número que responde "essa OP andou?".
    COALESCE(round((100 * r.feito) / NULLIF(r.total_rota, 0)), 0)::integer AS route_progress_pct
   FROM ((((((((public.production_queue q
     JOIN public.orders o ON (((o.id = q.order_id) AND (o.deleted_at IS NULL))))
     LEFT JOIN public.technical_sheets ts ON ((ts.id = o.reference_id)))
     LEFT JOIN public.sale_orders so ON ((so.id = o.sale_order_id)))
     LEFT JOIN public.clients c ON ((c.id = so.client_id)))
     LEFT JOIN public.economic_groups eg ON ((eg.id = c.economic_group_id)))
     LEFT JOIN sched s ON ((s.order_id = q.order_id)))
     LEFT JOIN stg st ON ((st.order_id = q.order_id)))
     LEFT JOIN last_stage ls ON ((ls.order_id = q.order_id)))
     LEFT JOIN rota r ON ((r.order_id = q.order_id));

CREATE OR REPLACE VIEW public.v_production_overloads AS
 SELECT 'late_op'::text AS kind,
    d.order_id, d.order_number, d.reference_name, d.color, d.quantity,
    d.sale_order_id, d.sale_order_number, d.client_name, d.due_date,
    d.projected_completion, d.late_days, d.carryover_total, d.remaining_pairs,
    d.remaining_pairs_net, d.carryover_peak, d.route_progress_pct
   FROM public.v_production_queue_detail d
  WHERE ((d.late_days > 0) AND (NOT (EXISTS ( SELECT 1
           FROM public.overload_acknowledgements a
          WHERE (a.scope_key = ('late:'::text || d.order_id))))))
UNION ALL
 SELECT 'no_due'::text AS kind,
    d.order_id, d.order_number, d.reference_name, d.color, d.quantity,
    d.sale_order_id, d.sale_order_number, d.client_name, d.due_date,
    d.projected_completion, 0 AS late_days, d.carryover_total, d.remaining_pairs,
    d.remaining_pairs_net, d.carryover_peak, d.route_progress_pct
   FROM public.v_production_queue_detail d
  WHERE ((d.due_date IS NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.overload_acknowledgements a
          WHERE (a.scope_key = ('nodue:'::text || d.order_id))))))
UNION ALL
 SELECT 'sem_agenda'::text AS kind,
    d.order_id, d.order_number, d.reference_name, d.color, d.quantity,
    d.sale_order_id, d.sale_order_number, d.client_name, d.due_date,
    d.projected_completion, 0 AS late_days, d.carryover_total, d.remaining_pairs,
    d.remaining_pairs_net, d.carryover_peak, d.route_progress_pct
   FROM public.v_production_queue_detail d
  WHERE ((d.remaining_pairs > 0) AND (d.projected_completion IS NULL) AND (d.due_date IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.overload_acknowledgements a
          WHERE (a.scope_key = ('noagenda:'::text || d.order_id))))));

-- Restaura o estado de segurança ORIGINAL da view de estouros — o
-- `CREATE OR REPLACE` acima preserva o ACL mas descarta o `reloptions`.
ALTER VIEW public.v_production_overloads SET (security_invoker = on);
