-- Busca do Kanban: nome fantasia + grupo econômico
--
-- A fila do quadro só expunha `clients.razao_social` (como `client_name`), então
-- a busca da Central de Produção era cega pro nome que a fábrica realmente usa
-- pra falar do cliente e pro grupo econômico que amarra as lojas.
--
-- Medido em 01/08/2026 (27 clientes com OP no quadro, 22 deles em grupo):
--   · "raquel"          →  8 de 27 lojas do grupo Raquel Calçados
--   · "vivian ferreira" →  0 de 4 lojas do grupo VIVIAN FERREIRA
--   · "agito"           →  2 de 4 lojas
--   · "nalin"           →  0 OPs (LNG 10 CONFECCOES LTDA tem fantasia LOJAS NALIN)
-- 13 dos 27 clientes do quadro têm fantasia diferente da razão social.
--
-- ⚠ CREATE OR REPLACE com dependente (`v_production_overloads` lê desta view):
--   as colunas novas entram no FIM e nenhuma existente muda de nome, tipo ou
--   posição. Reordenar aqui quebraria o replace.

CREATE OR REPLACE VIEW v_production_queue_detail AS
 WITH sched AS (
         SELECT production_schedule.order_id,
            max(production_schedule.date) AS projected_completion,
            min(production_schedule.date) AS next_scheduled_date,
            bool_or(production_schedule.capacity_source = 'ficha_override'::text) AS has_ficha_override,
            sum(production_schedule.carryover_pairs)::integer AS carryover_total
           FROM production_schedule
          WHERE production_schedule.date >= br_today()
          GROUP BY production_schedule.order_id
        ), stg AS (
         SELECT order_stages.order_id,
            sum(GREATEST(0, order_stages.quantity_total - COALESCE(order_stages.quantity_processed, 0)))::integer AS remaining_pairs
           FROM order_stages
          WHERE order_stages.status <> 'concluido'::text
          GROUP BY order_stages.order_id
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
            WHEN q.due_date IS NOT NULL AND s.projected_completion > q.due_date THEN s.projected_completion - q.due_date
            ELSE 0
        END AS late_days,
    row_number() OVER (ORDER BY (q.pinned_position IS NULL), q.pinned_position, q.due_date, o.created_at, o.id)::integer AS queue_position,
    -- ── colunas NOVAS (só append; ver aviso no cabeçalho) ────────────────────
    c.nome_fantasia AS client_fantasia,
    eg.name AS client_group_name
   FROM production_queue q
     JOIN orders o ON o.id = q.order_id AND o.deleted_at IS NULL
     LEFT JOIN technical_sheets ts ON ts.id = o.reference_id
     LEFT JOIN sale_orders so ON so.id = o.sale_order_id
     LEFT JOIN clients c ON c.id = so.client_id
     LEFT JOIN economic_groups eg ON eg.id = c.economic_group_id
     LEFT JOIN sched s ON s.order_id = q.order_id
     LEFT JOIN stg st ON st.order_id = q.order_id;
