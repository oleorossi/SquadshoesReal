-- =============================================================================
-- Auditoria do motor de produção / kanban (docs/AUDITORIA_MOTOR_KANBAN_2026-08-06.md)
--
-- Fecha dois buracos medidos contra os pedidos reais:
--
--   1. CANCELAMENTO DE PV NÃO CASCATEIA PRA OP. O faturamento já cascateia
--      (`finalize_orders_on_sale_order_billed`), o cancelamento não — e o único
--      PV cancelado do banco vazou 9 de 9 OPs, que seguiram na fila do motor
--      consumindo capacidade até 17/08. Ordenada por prazo, a fila coloca esse
--      pedido morto no TOPO, empurrando pedido vivo pra depois.
--
--   2. "RESTAM N PARES" E "N ROLADOS" CONTAM O MESMO PAR VÁRIAS VEZES.
--      `remaining_pairs` soma o saldo de TODAS as etapas abertas; como o par
--      atravessa 9 a 11 setores, ele é contado uma vez por setor. A fila tem
--      9.380 pares reais e as telas mostram 75.332 (fator 8,03x, em 50 das 54
--      OPs) — ao lado do botão "Gerar OS de terceirização". Mesma mecânica em
--      `carryover_total`: 96 "rolados" numa OP de 24 pares.
--
--      As colunas antigas FICAM: são medida de CARGA (pares·setor), que é o que
--      o motor precisa pra dimensionar fila. O que faltava era o número físico
--      ao lado, com nome próprio. Renomear/alterar as antigas quebraria
--      `SectorWorkloadAggregated` e o dimensionamento do motor.
-- =============================================================================

-- ── 1. Cancelamento de PV cascateia pras OPs ────────────────────────────────
--
-- Espelha `tg_cancel_service_orders_on_pv_cancel` (que já faz isso pras ordens
-- de SERVIÇO/terceirização) no mesmo casamento de status, tolerante a grafia.
--
-- Toda a limpeza a jusante já é automática assim que `orders.status` vira
-- 'Cancelada' — não repetir nada disto aqui:
--   • `tg_orders_sync_production_queue`            → tira da fila do motor
--   • `cancel_mrp_suggestions_on_order_cancel`     → cancela sugestões de MRP
--   • `auto_release_reservations_on_op_cancel`     → devolve a reserva ao estoque
--
-- ⚠ OP já FINALIZADA não volta atrás: mercadoria pronta (ou faturada) não é
-- desfeita por cancelamento de pedido — isso é decisão de expedição/estoque,
-- não de gatilho. Mesmo recorte que o faturamento usa.
CREATE OR REPLACE FUNCTION public.tg_cancel_orders_on_pv_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(btrim(COALESCE(NEW.status, ''))) IN ('cancelado', 'cancelada', 'cancelled')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.orders
       SET status = 'Cancelada', updated_at = now()
     WHERE sale_order_id = NEW.id
       AND deleted_at IS NULL
       AND lower(btrim(COALESCE(status, ''))) NOT IN
           ('finalizado', 'cancelada', 'cancelado', 'cancelled', 'faturado', 'concluído', 'concluido');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_orders_on_pv_cancel ON public.sale_orders;
CREATE TRIGGER trg_cancel_orders_on_pv_cancel
  AFTER UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.tg_cancel_orders_on_pv_cancel();

COMMENT ON FUNCTION public.tg_cancel_orders_on_pv_cancel() IS
  'Cancelar PV cancela as OPs de produção abertas dele. Espelha a cascata que o '
  'faturamento já tinha; sem ela, OP de pedido morto seguia na fila do motor '
  'consumindo capacidade e, por ser a mais atrasada, ocupando o topo.';

-- ⚠ SEM BACKFILL DE PROPÓSITO. Este gatilho só vale daqui pra frente. As OPs
-- que já vazaram (240 pares de PV-2026-00089 e PV-2026-00094) NÃO são limpas
-- aqui: decidir entre cancelar e produzir é do dono, e um UPDATE escondido numa
-- migration é exatamente o tipo de coisa que este repositório já documentou
-- como erro (ver a nota de `waste_factor` no CLAUDE.md).

-- ── 2. Números físicos ao lado dos números de carga ─────────────────────────
--
-- `remaining_pairs_net`  = pares que ainda têm de SAIR da fábrica.
--                          Base: quantidade da OP menos o que a ÚLTIMA etapa da
--                          rota já entregou. Um par só está pronto quando sai do
--                          último setor — contá-lo em cada setor é o bug.
-- `carryover_peak`       = maior saldo rolado num ÚNICO setor, em vez da soma
--                          entre setores. Por setor o cálculo já estava certo
--                          (0 violações medidas); o erro era só somar.
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
    COALESCE(s.carryover_peak, 0) AS carryover_peak
   FROM (((((((public.production_queue q
     JOIN public.orders o ON (((o.id = q.order_id) AND (o.deleted_at IS NULL))))
     LEFT JOIN public.technical_sheets ts ON ((ts.id = o.reference_id)))
     LEFT JOIN public.sale_orders so ON ((so.id = o.sale_order_id)))
     LEFT JOIN public.clients c ON ((c.id = so.client_id)))
     LEFT JOIN public.economic_groups eg ON ((eg.id = c.economic_group_id)))
     LEFT JOIN sched s ON ((s.order_id = q.order_id)))
     LEFT JOIN stg st ON ((st.order_id = q.order_id)))
     LEFT JOIN last_stage ls ON ((ls.order_id = q.order_id));

COMMENT ON VIEW public.v_production_queue_detail IS
  'Fila do motor de produção. ⚠ DOIS pares de números, não confundir: '
  '`remaining_pairs`/`carryover_total` são CARGA (pares·setor — o mesmo par conta '
  'uma vez por setor, é o que o motor usa pra dimensionar fila) e '
  '`remaining_pairs_net`/`carryover_peak` são PARES FÍSICOS (o que a fábrica ainda '
  'tem de produzir). Tela pra humano usa os físicos; motor usa os de carga.';

-- `v_production_overloads` precisa dos dois números novos. Recriada (não é
-- CREATE OR REPLACE porque a lista de colunas muda no meio dos UNIONs).
DROP VIEW IF EXISTS public.v_production_overloads;
CREATE VIEW public.v_production_overloads AS
 SELECT 'late_op'::text AS kind,
    d.order_id, d.order_number, d.reference_name, d.color, d.quantity,
    d.sale_order_id, d.sale_order_number, d.client_name, d.due_date,
    d.projected_completion, d.late_days, d.carryover_total, d.remaining_pairs,
    d.remaining_pairs_net, d.carryover_peak
   FROM public.v_production_queue_detail d
  WHERE ((d.late_days > 0) AND (NOT (EXISTS ( SELECT 1
           FROM public.overload_acknowledgements a
          WHERE (a.scope_key = ('late:'::text || d.order_id))))))
UNION ALL
 SELECT 'no_due'::text AS kind,
    d.order_id, d.order_number, d.reference_name, d.color, d.quantity,
    d.sale_order_id, d.sale_order_number, d.client_name, d.due_date,
    d.projected_completion, 0 AS late_days, d.carryover_total, d.remaining_pairs,
    d.remaining_pairs_net, d.carryover_peak
   FROM public.v_production_queue_detail d
  WHERE ((d.due_date IS NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.overload_acknowledgements a
          WHERE (a.scope_key = ('nodue:'::text || d.order_id))))))
UNION ALL
 SELECT 'sem_agenda'::text AS kind,
    d.order_id, d.order_number, d.reference_name, d.color, d.quantity,
    d.sale_order_id, d.sale_order_number, d.client_name, d.due_date,
    d.projected_completion, 0 AS late_days, d.carryover_total, d.remaining_pairs,
    d.remaining_pairs_net, d.carryover_peak
   FROM public.v_production_queue_detail d
  WHERE ((d.remaining_pairs > 0) AND (d.projected_completion IS NULL) AND (d.due_date IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.overload_acknowledgements a
          WHERE (a.scope_key = ('noagenda:'::text || d.order_id))))));
